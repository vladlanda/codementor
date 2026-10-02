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
 * OpenAI-compatible adapter. Works with OpenAI, Azure (with adjustments), and any
 * `/v1/chat/completions` endpoint. Streaming uses SSE (one JSON object per line).
 *
 * We intentionally do NOT assume every compatible server supports tool calling or
 * `response_format`; the orchestrator checks `capabilities()` and degrades.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  public readonly kind = 'openai' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs = 120_000
  ) {}

  private get base(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  public capabilities(): ProviderCapabilities {
    return { supportsStreaming: true, supportsToolCalling: true, supportsStructuredOutput: true };
  }

  public async ping(signal?: AbortSignal): Promise<boolean> {
    try {
      await request<unknown>(`${this.base}/models`, { signal, headers: this.authHeaders(), timeoutMs: Math.min(5000, this.timeoutMs) });
      return true;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    const data = await request<{ data?: Array<{ id: string }> }>(`${this.base}/models`, {
      headers: this.authHeaders(),
      timeoutMs: this.timeoutMs,
    });
    return (data.data ?? []).map((m) => ({ id: m.id }));
  }

  private toOpenAiMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      const out: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      if (m.role === 'tool') {
        out.tool_call_id = m.toolCallId;
      }
      return out;
    });
  }

  private toOpenAiTools(tools: ToolSpec[] | undefined): unknown[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }
    return tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  public async chat(req: ChatRequest): Promise<ChatResult> {
    const body = {
      model: req.model ?? this.defaultModel,
      messages: this.toOpenAiMessages(req.messages),
      tools: this.toOpenAiTools(req.tools),
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens,
      stream: false,
    };

    const data = await request<{
      choices?: Array<{
        message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(`${this.base}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: this.authHeaders(),
      signal: req.signal,
      timeoutMs: this.timeoutMs,
    });

    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => {
      const name = tc.function?.name ?? '';
      let args: Record<string, unknown> = {};
      const raw = tc.function?.arguments;
      if (typeof raw === 'string' && raw.trim().length > 0) {
        try {
          args = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new ProviderError(`Model returned non-JSON tool arguments for ${name}`, 'bad_tool_args', false, raw);
        }
      }
      return { id: tc.id ?? `call_${i}`, name, arguments: args };
    });

    const fr = choice?.finish_reason;
    return {
      text: msg?.content ?? '',
      toolCalls,
      stopReason: fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end_turn',
      usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens },
    };
  }

  public async *chatStream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const body = {
      model: req.model ?? this.defaultModel,
      messages: this.toOpenAiMessages(req.messages),
      tools: this.toOpenAiTools(req.tools),
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens,
      stream: true,
      stream_options: { include_usage: false },
    };

    for await (const line of streamNdjson(`${this.base}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: this.authHeaders(),
      signal: req.signal,
      timeoutMs: this.timeoutMs,
      parseLine: (l: string) => JSON.parse(l),
    })) {
      const frame = line as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
      const delta = frame.choices?.[0]?.delta;
      if (delta?.content) {
        yield { delta: delta.content };
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          yield {
            toolCallDelta: {
              index: tc.index ?? 0,
              id: tc.id,
              name: tc.function?.name,
              argumentFragment: tc.function?.arguments,
            },
          };
        }
      }
    }
  }
}
