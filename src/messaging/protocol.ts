/**
 * Shared, typed message protocol between the extension host and the chat webview.
 *
 * Every message is a discriminated union keyed on `type`. Keeping the contract
 * in a single module guarantees the host and UI never drift out of sync.
 */

export type AutonomyMode = 'guided' | 'balanced' | 'autonomous';
export type ExplanationDepth = 'concise' | 'standard' | 'deep';
export type ProviderType = 'ollama' | 'openai';

/** Explicit task lifecycle. We never rely on free-form text to track state. */
export type TaskState =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'explaining'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ConnectionInfo {
  provider: ProviderType;
  model: string;
  baseUrl: string;
  connected: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

export interface ToolEventInfo {
  tool: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  summary: string;
}

export interface DiffInfo {
  filePath: string;
  /** Unified diff text, may be truncated by the host. */
  diff: string;
  isNew: boolean;
}

export interface LearningCheckpoint {
  concept: string;
  explanation: string;
  question?: string;
  optional: boolean;
}

export interface KnowledgeCheck {
  question: string;
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* UI -> Host                                                          */
/* ------------------------------------------------------------------ */

export interface UserMessageMsg {
  type: 'userMessage';
  taskId: string;
  text: string;
}

export interface ApprovalResponseMsg {
  type: 'approvalResponse';
  requestId: string;
  approved: boolean;
  /** For file approvals, optionally the user-edited content to apply instead. */
  editedContent?: string;
}

export interface CancelTaskMsg {
  type: 'cancelTask';
  taskId: string;
}

export interface RequestStateMsg {
  type: 'requestState';
}

export interface ConnectionTestMsg {
  type: 'connectionTest';
  provider: ProviderType;
}

export interface NewChatMsg {
  type: 'newChat';
}

export type UiToHostMessage =
  | UserMessageMsg
  | ApprovalResponseMsg
  | CancelTaskMsg
  | RequestStateMsg
  | ConnectionTestMsg
  | NewChatMsg;

/* ------------------------------------------------------------------ */
/* Host -> UI                                                          */
/* ------------------------------------------------------------------ */

export interface StreamStartMsg {
  type: 'streamStart';
  taskId: string;
  messageId: string;
}

export interface StreamChunkMsg {
  type: 'streamChunk';
  taskId: string;
  messageId: string;
  delta: string;
}

export interface StreamEndMsg {
  type: 'streamEnd';
  taskId: string;
  messageId: string;
}

export interface TaskStateMsg {
  type: 'taskState';
  taskId: string;
  state: TaskState;
  detail?: string;
}

export interface ApprovalRequestMsg {
  type: 'approvalRequest';
  requestId: string;
  taskId: string;
  kind: 'file' | 'terminal' | 'plan';
  title: string;
  description: string;
  diff?: DiffInfo[];
  command?: string;
  /** True when the operation may be destructive / consequential. */
  risky: boolean;
}

export interface ToolEventMsg {
  type: 'toolEvent';
  taskId: string;
  event: ToolEventInfo;
}

export interface LearningCheckpointMsg {
  type: 'learningCheckpoint';
  taskId: string;
  checkpoint: LearningCheckpoint;
}

export interface KnowledgeCheckMsg {
  type: 'knowledgeCheck';
  taskId: string;
  check: KnowledgeCheck;
}

export interface ConnectionInfoMsg {
  type: 'connectionInfo';
  info: ConnectionInfo;
}

export interface ErrorMsg {
  type: 'error';
  taskId?: string;
  code: string;
  message: string;
}

/** Full snapshot so a reopened webview can restore the conversation. */
export interface StateSnapshotMsg {
  type: 'stateSnapshot';
  messages: UiMessage[];
  activeTaskId: string | null;
  activeTaskState: TaskState;
  connection: ConnectionInfo;
}

/* ------------------------------------------------------------------ */
/* UI-visible message model (what the transcript renders)             */
/* ------------------------------------------------------------------ */

export type UiMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; state?: 'streaming' | 'done' }
  | { id: string; role: 'tool'; tool: string; status: string; summary: string }
  | { id: string; role: 'approval'; kind: string; title: string; description: string; outcome?: 'approved' | 'denied' }
  | { id: string; role: 'checkpoint'; concept: string; explanation: string; question?: string }
  | { id: string; role: 'error'; code: string; message: string };

export type HostToUiMessage =
  | StreamStartMsg
  | StreamChunkMsg
  | StreamEndMsg
  | TaskStateMsg
  | ApprovalRequestMsg
  | ToolEventMsg
  | LearningCheckpointMsg
  | KnowledgeCheckMsg
  | ConnectionInfoMsg
  | ErrorMsg
  | StateSnapshotMsg;

export type AnyMessage = UiToHostMessage | HostToUiMessage;
