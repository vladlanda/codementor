import type { LLMProvider, ChatMessage, ChatResult, ToolCall } from '../providers/provider';
import { ProviderError } from '../providers/provider';
import type { ToolRegistry } from '../tools/registry';
import type { ApprovalRequest, ToolContext, ToolResult } from '../tools/types';
import type {
  AutonomyMode,
  ExplanationDepth,
  FollowUpSuggestion,
  KnowledgeCheck,
  LearningCheckpoint,
  TaskState,
} from '../messaging/protocol';
import { TaskStateMachine } from './TaskStateMachine';

/**
 * Events the orchestrator emits. Decoupled from VS Code so the whole agent loop
 * can run under the plain Node test runner. The host maps these to webview messages.
 *
 * The `checkpoint`, `knowledgeCheck`, and `followUps` variants are not produced by
 * the loop itself; they are injected by the host glue (AgentRunner) when it parses
 * teaching artifacts out of the final answer. They are declared here so the event
 * type has a single source of truth.
 */
export type AgentEvent =
  | { type: 'state'; from: TaskState; to: TaskState }
  | { type: 'text'; delta: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool'; name: string; args: unknown; result: ToolResult }
  | { type: 'approval'; request: ApprovalRequest & { requestId: string } }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'done'; text: string; iterations: number }
  | { type: 'checkpoint'; checkpoint: LearningCheckpoint }
  | { type: 'knowledgeCheck'; checkId: string; concept?: string; check: KnowledgeCheck }
  | { type: 'followUps'; suggestions: FollowUpSuggestion[] };

export interface OrchestratorOptions {
  provider: LLMProvider;
  tools: ToolRegistry;
  /** Build a tool context bound to the live approval handler. */
  makeToolContext: (requestApproval: (req: ApprovalRequest) => Promise<boolean>) => ToolContext;
  systemPrompt: string;
  onEvent?: (e: AgentEvent) => void;
  autonomy?: AutonomyMode;
  explanationDepth?: ExplanationDepth;
  maxIterations?: number;
  maxOutputChars?: number;
  timeoutMs?: number;
  /** Seed conversation (previous turns) for follow-ups. */
  history?: ChatMessage[];
  /**
   * Optional hook to transform the final answer before it completes: strip
   * structured artifacts, report them via onEvent, and return the text that
   * should be surfaced as the assistant message. Returns the (possibly trimmed)
   * visible text.
   */
  transformFinalAnswer?: (text: string) => string;
}

/**
 * The Agent Orchestrator: drives one bounded task through the provider's
 * tool-call loop, enforcing state transitions, iteration limits, cancellation,
 * and argument/result validation. It does not render UI — it emits typed events.
 */
export class Orchestrator {
  private readonly _sm = new TaskStateMachine();
  private readonly _opts: OrchestratorOptions;
  private _abort = new AbortController();
  private _approvals = new Map<string, { resolve: (v: boolean) => void }>();

  constructor(opts: OrchestratorOptions) {
    this._opts = { ...opts, onEvent: opts.onEvent ?? (() => {}) };
    this._sm.onChange((from, to) => this._emit({ type: 'state', from, to }));
  }

  private _emit(e: AgentEvent): void {
    this._opts.onEvent?.(e);
  }

  /** Move to a state, ignoring no-op self-transitions that would be illegal. */
  private _go(state: TaskState): void {
    if (this._sm.state === state) {
      return;
    }
    this._sm.transition(state);
  }

  public get state(): TaskState {
    return this._sm.state;
  }

  /** Run one task to completion, failure, or cancellation. */
  public async run(userTask: string): Promise<void> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this._opts.systemPrompt },
      ...(this._opts.history ?? []),
      { role: 'user', content: userTask },
    ];

    this._sm.transition('planning');

    const maxIters = this._opts.maxIterations ?? 25;
    const maxOutput = this._opts.maxOutputChars ?? 20_000;

    try {
      for (let iter = 0; iter < maxIters; iter++) {
        if (this._isCancelled()) {
          this._finishCancelled();
          return;
        }

        const request = {
          model: undefined,
          messages,
          tools: this._opts.tools.all().map((t) => t.spec),
          temperature: 0.4,
          signal: this._abort.signal,
        };

        let result: ChatResult;
        try {
          result = await this._invokeWithStreaming(request);
        } catch (e) {
          this._handleProviderError(e);
          return;
        }

        if (this._isCancelled()) {
          this._finishCancelled();
          return;
        }

        // Accumulate the assistant turn (text and/or tool calls) into the transcript.
        messages.push({
          role: 'assistant',
          content: result.text,
          toolCalls: result.toolCalls,
        });

        // Terminal answer (no tool calls) → we are done producing output.
        if (result.toolCalls.length === 0) {
          this._go('executing');
          this._sm.transition('explaining');
          const visible = this._opts.transformFinalAnswer ? this._opts.transformFinalAnswer(result.text) : result.text;
          // Authoritative clean text: lets the host replace the streamed text (which
          // may have briefly included structured teaching artifacts).
          this._emit({ type: 'assistant', text: visible });
          this._finishCompleted(visible);
          return;
        }

        // Execute each requested tool with validation + approval.
        this._go('executing');
        for (const call of result.toolCalls) {
          if (this._isCancelled()) {
            this._finishCancelled();
            return;
          }
          const toolResult = await this._runTool(call, maxOutput);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify(this._compactToolResult(toolResult, maxOutput)),
          });
        }
        // Continue loop so the model can react to tool results / explain.
        continue;
      }

      // Iteration budget exhausted.
      this._sm.transition('failed');
      this._emit({
        type: 'error',
        code: 'iteration_limit',
        message: `Stopped after ${maxIters} tool iterations to stay within bounds. Review progress and re-issue the task if more work remains.`,
        retryable: false,
      });
    } catch (e) {
      this._sm.transition('failed');
      this._emit({ type: 'error', code: 'unexpected', message: (e as Error).message, retryable: false });
    }
  }

  /* ------------------------------------------------------------------ */

  private async _invokeWithStreaming(request: Parameters<LLMProvider['chat']>[0]): Promise<ChatResult> {
    // Prefer streaming where supported; otherwise fall back to a single call.
    const caps = this._opts.provider.capabilities();
    if (caps.supportsStreaming) {
      let text = '';
      const toolDeltas = new Map<number, { id?: string; name?: string; args: string }>();
      for await (const chunk of this._opts.provider.chatStream(request)) {
        if (chunk.delta) {
          text += chunk.delta;
          this._emit({ type: 'text', delta: chunk.delta });
        }
        const td = chunk.toolCallDelta;
        if (td) {
          const entry = toolDeltas.get(td.index) ?? { args: '' };
          if (td.name) {
            entry.name = td.name;
          }
          if (td.id) {
            entry.id = td.id;
          }
          if (td.argumentFragment) {
            entry.args += td.argumentFragment;
          }
          toolDeltas.set(td.index, entry);
        }
      }
      const toolCalls: ToolCall[] = [...toolDeltas.entries()].map(([i, v]) => {
        let args: Record<string, unknown> = {};
        if (v.args.trim()) {
          try {
            args = JSON.parse(v.args) as Record<string, unknown>;
          } catch {
            throw new ProviderError(`Model returned non-JSON tool arguments for ${v.name ?? 'tool'} (index ${i})`, 'bad_tool_args', false, v.args);
          }
        }
        return { id: v.id ?? `call_${i}`, name: v.name ?? '', arguments: args };
      });
      return { text, toolCalls, stopReason: toolCalls.length ? 'tool_use' : 'end_turn' };
    }

    const result = await this._opts.provider.chat(request);
    if (result.text) {
      this._emit({ type: 'text', delta: result.text });
    }
    return result;
  }

  private async _runTool(call: ToolCall, maxOutput: number): Promise<ToolResult> {
    const tool = this._opts.tools.get(call.name);
    if (!tool) {
      const r: ToolResult = { ok: false, data: null, summary: `Unknown tool: ${call.name}` };
      this._emit({ type: 'tool', name: call.name, args: call.arguments, result: r });
      return r;
    }

    // Approval is requested inside the tool's run() via the context handler.
    const requestApproval = (req: ApprovalRequest): Promise<boolean> => this._requestApproval(req);
    const ctx = this._opts.makeToolContext(requestApproval);

    let result: ToolResult;
    try {
      result = await this._opts.tools.invoke(call.name, call.arguments, ctx);
    } catch (e) {
      result = { ok: false, data: null, summary: `Tool execution error: ${(e as Error).message}` };
    }

    this._emit({ type: 'tool', name: call.name, args: call.arguments, result });
    // Enforce output-size bound on what we retain/emit.
    if (JSON.stringify(result.data ?? '').length > maxOutput) {
      result = { ...result, summary: `${result.summary} [large output truncated to ${maxOutput} chars]` };
    }
    return result;
  }

  private _requestApproval(req: ApprovalRequest): Promise<boolean> {
    const requestId = `appr_${Math.random().toString(36).slice(2, 10)}`;
    this._sm.transition('awaiting_approval');
    const full = { ...req, requestId };
    this._emit({ type: 'approval', request: full });
    return new Promise<boolean>((resolve) => {
      this._approvals.set(requestId, { resolve });
    });
  }

  /** Resolve a pending approval from the host (user decision). */
  public resolveApproval(requestId: string, approved: boolean): void {
    const pending = this._approvals.get(requestId);
    if (!pending) {
      return;
    }
    this._approvals.delete(requestId);
    pending.resolve(approved);
    // After a decision, the loop moves on to executing (if approved) or tool is skipped.
    if (this._sm.state === 'awaiting_approval') {
      try {
        this._sm.transition('executing');
      } catch {
        /* some transitions are illegal depending on context; the next loop step settles state */
      }
    }
  }

  public cancel(): void {
    this._abort.abort();
    if (this._sm.state !== 'idle') {
      try {
        this._sm.transition('cancelled');
      } catch {
        this._sm.reset();
      }
    }
    // Fail any pending approvals.
    for (const { resolve } of this._approvals.values()) {
      resolve(false);
    }
    this._approvals.clear();
  }

  private _isCancelled(): boolean {
    return this._abort.signal.aborted;
  }

  private _finishCompleted(text: string): void {
    this._sm.transition('completed');
    this._emit({ type: 'done', text, iterations: 0 });
  }

  private _finishCancelled(): void {
    try {
      this._sm.transition('cancelled');
    } catch {
      this._sm.reset();
    }
  }

  private _handleProviderError(e: unknown): void {
    const code = e instanceof ProviderError ? e.code : 'provider_error';
    const message = e instanceof Error ? e.message : String(e);
    const retryable = e instanceof ProviderError ? e.retryable : false;
    this._sm.transition('failed');
    this._emit({ type: 'error', code, message, retryable });
  }

  private _compactToolResult(r: ToolResult, maxOutput: number): unknown {
    const s = JSON.stringify(r.data ?? null);
    if (s.length <= maxOutput) {
      return r.data;
    }
    return { truncated: true, note: `Output truncated to ${maxOutput} chars.`, preview: s.slice(0, maxOutput) };
  }
}
