/**
 * Provider-agnostic contract. Every LLM backend implements this so the orchestrator
 * never has to know whether it is talking to Ollama or an OpenAI-compatible API.
 *
 * Design notes:
 * - `chat` is an async iterable so callers can stream chunks and cancel via AbortSignal.
 * - `capabilities()` lets the orchestrator degrade gracefully (e.g. fall back to
 *   JSON-in-text tool parsing when the model has no native tool calling).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present when role === 'assistant' and the model issued a tool call. */
  toolCalls?: ToolCall[];
  /** Present when role === 'tool' — the id of the tool call this result answers. */
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw argument object exactly as the provider returned it (unvalidated). */
  arguments: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON-Schema-style description of the arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** One streamed unit of model output. */
export interface ChatChunk {
  /** Incremental text. */
  delta?: string;
  /** Partial tool call being accumulated (provider dependent). */
  toolCallDelta?: { index: number; id?: string; name?: string; argumentFragment?: string };
}

export interface ChatResult {
  /** Final concatenated assistant text. */
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'aborted' | 'error';
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface ModelInfo {
  id: string;
  family?: string;
  sizeBytes?: number;
}

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  maxContextTokens?: number;
}

export interface LLMProvider {
  readonly kind: 'ollama' | 'openai';
  chat(req: ChatRequest): Promise<ChatResult>;
  chatStream(req: ChatRequest): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
  capabilities(): ProviderCapabilities;
  /** Lightweight connectivity check used by the "test connection" action. */
  ping(signal?: AbortSignal): Promise<boolean>;
}

export class ProviderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public override readonly cause?: unknown;

  constructor(message: string, code: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
    this.name = 'ProviderError';
  }
}
