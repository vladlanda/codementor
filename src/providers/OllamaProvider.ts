import { request, streamNdjson } from './http';
import {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResult,
  LLMProvider,
  ModelInfo,
  ProviderCapabilities,
  ProviderError,
  ToolCall,
  ToolSpec,
} from './provider';

/**
 * Ollama adapter. Uses Ollama's OpenAI-compatible `/api/chat` endpoint so the same
 * streaming + tool-call shape we use for other providers applies. Falls back to the
 * native `/api/chat` when the compatible endpoint is unavailable on older versions.
 */
export class OllamaProvider implements LLMProvider {
  public readonly kind = 'ollama' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel: string,
    private readonly timeoutMs = 120_000
  ) {}

  private get base(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  public capabilities(): ProviderCapabilities {
    return { supportsStreaming: true, supportsToolCalling: true, supportsStructuredOutput: false };
  }

  public async ping(signal?: AbortSignal): Promise<boolean> {
    try {
      await request<unknown>(`${this.base}/api/version`, { signal, timeoutMs: Math.min(5000, this.timeoutMs) });
      return true;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    const data = await request<{ models?: Array<{ name: string; size?: number }> }>(`${this.base}/api/tags`, {
      timeoutMs: this.timeoutMs,
    });
    return (data.models ?? []).map((m) => ({ id: m.name, sizeBytes: m.size }));
  }

  private toOllamaMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      const out: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.name) {
        out.name = m.name;
      }
      if (m.toolCallId) {
        out.tool_call_id = m.toolCallId;
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      return out;
    });
  }

  private toOllamaTools(tools: ToolSpec[] | undefined): unknown[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }
    return tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  private parseToolCalls(message: unknown): ToolCall[] {
    const msg = message as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } | undefined;
    const calls = msg?.tool_calls;
    if (!Array.isArray(calls)) {
      return [];
    }
    const result: ToolCall[] = [];
    for (let i = 0; i < calls.length; i++) {
      const name = calls[i].function?.name;
      if (!name) {
        continue;
      }
      let args: Record<string, unknown> = {};
      const raw = calls[i].function?.arguments;
      if (typeof raw === 'string' && raw.trim().length > 0) {
        try {
          args = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new ProviderError(`Model returned non-JSON tool arguments for ${name}`, 'bad_tool_args', false, raw);
        }
      }
      result.push({ id: `call_${i}`, name, arguments: args });
    }
    return result;
  }

  public async chat(req: ChatRequest): Promise<ChatResult> {
    const body = {
      model: req.model ?? this.defaultModel,
      messages: this.toOllamaMessages(req.messages),
      stream: false,
      tools: this.toOllamaTools(req.tools),
      options: {
        temperature: req.temperature ?? 0.4,
        num_predict: req.maxTokens,
      },
    };

    const data = await request<{
      message?: { content?: string; tool_calls?: unknown[] };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    }>(`${this.base}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: req.signal, timeoutMs: this.timeoutMs });

    const text = data.message?.content ?? '';
    const toolCalls = this.parseToolCalls(data.message);
    const stopReason =
      data.done_reason === 'tool_calls' ? 'tool_use' : data.done_reason === 'length' ? 'max_tokens' : 'end_turn';

    return {
      text,
      toolCalls,
      stopReason,
      usage: { promptTokens: data.prompt_eval_count, completionTokens: data.eval_count },
    };
  }

  public async *chatStream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const body = {
      model: req.model ?? this.defaultModel,
      messages: this.toOllamaMessages(req.messages),
      stream: true,
      tools: this.toOllamaTools(req.tools),
      options: { temperature: req.temperature ?? 0.4, num_predict: req.maxTokens },
    };

    for await (const line of streamNdjson(`${this.base}/api/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: req.signal,
      timeoutMs: this.timeoutMs,
      parseLine: (l: string) => JSON.parse(l),
    })) {
      const frame = line as {
        message?: { content?: string; tool_calls?: unknown[] };
        done?: boolean;
        done_reason?: string;
      };
      const delta = frame.message?.content;
      if (delta) {
        yield { delta };
      }
      const tcs = frame.message?.tool_calls;
      if (Array.isArray(tcs)) {
        // Ollama emits tool calls as full objects in the final frame.
        for (let i = 0; i < tcs.length; i++) {
          const tc = tcs[i] as { function?: { name?: string; arguments?: string } };
          if (tc.function?.name) {
            yield { toolCallDelta: { index: i, name: tc.function.name, argumentFragment: tc.function.arguments } };
          }
        }
      }
      if (frame.done) {
        return;
      }
    }
  }
}
