import * as vscode from 'vscode';

import type {
  ConnectionInfoMsg,
  HostToUiMessage,
  UiToHostMessage,
  UiMessage,
  TaskState,
} from '../messaging/protocol';
import { ConnectionManager } from '../providers/ConnectionManager';
import { SettingsService } from '../services/SettingsService';
import { ProviderService } from '../providers/ProviderService';
import { AgentRunner } from '../services/AgentRunner';
import { LearningProfile } from '../learning/LearningProfile';
import { LearningProfilePanel } from './LearningProfilePanel';
import type { AgentEvent } from '../agent/Orchestrator';

/**
 * Owns the sidebar webview: lifecycle, HTML, and the typed message bridge to the
 * extension host. It deliberately does little logic itself — orchestration lives
 * in higher-level services so this file stays focused on the UI boundary.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codementor.chatView';

  private _view: vscode.WebviewView | undefined;
  private _disposed = false;

  private readonly _runner: AgentRunner;
  private readonly _profile?: LearningProfile;
  private _transcript: UiMessage[] = [];
  private _activeTaskId: string | null = null;
  private _activeTaskState: TaskState = 'idle';
  private _streamingAssistantId: string | null = null;
  /** checkId -> concept + transcript message id, so a response can be linked back. */
  private _checks = new Map<string, { concept?: string; msgId: string }>();

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _settings: SettingsService,
    private readonly _connection: ConnectionManager,
    providerService: ProviderService,
    profile?: LearningProfile
  ) {
    this._profile = profile;
    this._runner = new AgentRunner(providerService, this._settings, this._profile);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'resources')],
    };
    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: unknown) => {
      const parsed = this._parseMessage(msg);
      if (parsed) {
        void this._handleUiMessage(parsed);
      }
    });

    webviewView.onDidDispose(() => {
      this._disposed = true;
      this._view = undefined;
    });

    void this.pushConnectionInfo();
  }

  /** Restore the conversation snapshot when the webview (re)loads. */
  public refresh(): void {
    if (!this._view) {
      return;
    }
    const snapshot: HostToUiMessage = {
      type: 'stateSnapshot',
      messages: this._transcript,
      activeTaskId: this._activeTaskId,
      activeTaskState: this._activeTaskState,
      connection: this._connection.getSnapshot(),
    };
    this.post(snapshot);
  }

  public async pushConnectionInfo(): Promise<void> {
    const info: ConnectionInfoMsg = { type: 'connectionInfo', info: this._connection.getSnapshot() };
    this.post(info);
  }

  public async refreshConnection(): Promise<void> {
    await this._connection.refresh();
    await this.pushConnectionInfo();
  }

  /* ------------------------------------------------------------------ */
  /* UI-facing commands                                                  */
  /* ------------------------------------------------------------------ */

  public resetChat(): void {
    if (this._runner.active) {
      this._runner.cancel();
    }
    this._transcript = [];
    this._activeTaskId = null;
    this._activeTaskState = 'idle';
    this._runner.clearHistory();
    if (this._view) {
      this.post({ type: 'stateSnapshot', messages: [], activeTaskId: null, activeTaskState: 'idle', connection: this._connection.getSnapshot() });
    } else {
      void vscode.window.showInformationMessage('CodeMentor: open the chat panel to start a new conversation.');
    }
  }

  public async explainSelection(_uri?: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('CodeMentor: select some code first.');
      return;
    }
    const selected = editor.document.getText(editor.selection);
    const rel = vscode.workspace.asRelativePath(editor.document.uri);
    // Tailor the explanation depth to the learner's profile (spec §5.3).
    const profile = this._runner.getProfile();
    const profileContext = profile.experienceLevel
      ? `The learner's self-reported experience level is ${profile.experienceLevel}. `
      : '';
    const task =
      `Explain the following ${editor.document.languageId} code from ${rel} (lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1}). ` +
      profileContext +
      'Ground your explanation in the actual code, point out the key concepts, and note anything surprising or worth improving.\n\n' +
      '```' + editor.document.languageId + '\n' + selected + '\n```';
    if (!this._view) {
      void vscode.window.showInformationMessage('CodeMentor: open the chat panel to see the explanation.');
      return;
    }
    void this._runTask(this._newTaskId(), task);
  }

  public cancelActiveTask(): void {
    if (!this._runner.active) {
      void vscode.window.showInformationMessage('CodeMentor: no active task to cancel.');
      return;
    }
    this._runner.cancel();
  }

  public async promptProviderConnection(): Promise<void> {
    const current = this._settings.getProvider();
    const model = await vscode.window.showInputBox({
      prompt: `Model for ${current.type === 'openai' ? 'OpenAI-compatible' : 'Ollama'} provider`,
      value: current.model,
      ignoreFocusOut: true,
    });
    if (model === undefined) {
      return;
    }
    const section = current.type === 'openai' ? 'openai' : 'ollama';
    await vscode.workspace.getConfiguration('codementor').update(`${section}.model`, model, vscode.ConfigurationTarget.Global);
    await this.refreshConnection();
  }

  public openLearningProfile(): void {
    LearningProfilePanel.show({
      getProfile: () => this._runner.getProfile(),
      setExperienceLevel: (level) => this._runner.setProfileExperienceLevel(level),
      setNotes: (notes) => this._runner.setProfileNotes(notes),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Message bridge                                                      */
  /* ------------------------------------------------------------------ */

  private post(msg: HostToUiMessage): void {
    void this._view?.webview.postMessage(msg);
  }

  private async _handleUiMessage(msg: UiToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'userMessage': {
        if (this._runner.active) {
          this.post({ type: 'error', taskId: msg.taskId, code: 'busy', message: 'A task is already running. Cancel it first.' });
          return;
        }
        this._appendTranscript({ id: this._newId('user'), role: 'user', text: msg.text });
        void this._runTask(msg.taskId, msg.text);
        break;
      }
      case 'approvalResponse': {
        this._runner.resolveApproval(msg.requestId, msg.approved);
        break;
      }
      case 'cancelTask': {
        this._runner.cancel();
        break;
      }
      case 'newChat': {
        this.resetChat();
        break;
      }
      case 'knowledgeCheckResponse': {
        if (msg.answer.trim().length === 0) {
          break;
        }
        // Conservative: an answered check is evidence of engagement, not mastery.
        this._runner.recordEngagement(msg.concept ?? '');
        this._markCheckAnswered(msg.checkId, msg.answer);
        break;
      }
      case 'followUp': {
        if (this._runner.active) {
          this.post({ type: 'error', taskId: msg.taskId, code: 'busy', message: 'A task is already running. Cancel it first.' });
          return;
        }
        this._appendTranscript({ id: this._newId('user'), role: 'user', text: msg.prompt });
        void this._runTask(msg.taskId, msg.prompt);
        break;
      }
      case 'learningProfileRequest': {
        this.post({ type: 'learningProfile', profile: this._runner.getProfile() });
        break;
      }
      case 'connectionTest':
        await this._connection.refresh();
        await this.pushConnectionInfo();
        break;
      case 'requestState':
        this.refresh();
        break;
      default:
        break;
    }
  }

  /** Kick off an orchestrator run for a task id, streaming events to the webview. */
  private async _runTask(taskId: string, text: string): Promise<void> {
    this._activeTaskId = taskId;
    this._activeTaskState = 'planning';
    this._streamingAssistantId = null;

    const onEvent = (e: AgentEvent): void => {
      switch (e.type) {
        case 'state': {
          this._activeTaskState = e.to;
          this.post({ type: 'taskState', taskId, state: e.to });
          break;
        }
        case 'text': {
          if (!this._streamingAssistantId) {
            this._streamingAssistantId = this._newId('assistant');
            this._appendTranscript({ id: this._streamingAssistantId, role: 'assistant', text: '', state: 'streaming' });
            this.post({ type: 'streamStart', taskId, messageId: this._streamingAssistantId });
          }
          this._appendAssistantDelta(e.delta);
          this.post({ type: 'streamChunk', taskId, messageId: this._streamingAssistantId, delta: e.delta });
          break;
        }
        case 'tool': {
          const status = e.result.ok ? 'succeeded' : 'failed';
          this._appendTranscript({
            id: this._newId('tool'),
            role: 'tool',
            tool: e.name,
            status,
            summary: e.result.summary,
          });
          this.post({ type: 'toolEvent', taskId, event: { tool: e.name, status, summary: e.result.summary } });
          break;
        }
        case 'approval': {
          const { requestId, ...req } = e.request;
          this._appendTranscript({
            id: this._newId('approval'),
            role: 'approval',
            kind: req.kind,
            title: req.title,
            description: req.description,
          });
          this.post({
            type: 'approvalRequest',
            taskId,
            requestId,
            kind: req.kind,
            title: req.title,
            description: req.description,
            risky: req.risky,
            command: req.command,
            diff: req.diff,
          });
          break;
        }
        case 'error': {
          this._appendTranscript({ id: this._newId('error'), role: 'error', code: e.code, message: e.message });
          this.post({ type: 'error', taskId, code: e.code, message: e.message });
          break;
        }
        case 'assistant': {
          // Authoritative clean text (artifacts stripped). Replace the streamed text
          // so the transcript never shows the raw teaching-artifact block.
          if (this._streamingAssistantId) {
            const msg = this._transcript.find((m) => m.id === this._streamingAssistantId);
            if (msg && msg.role === 'assistant') {
              msg.text = e.text;
              msg.state = 'done';
            }
            this.post({ type: 'assistantText', taskId, messageId: this._streamingAssistantId, text: e.text });
          }
          break;
        }
        case 'checkpoint': {
          this._appendTranscript({
            id: this._newId('checkpoint'),
            role: 'checkpoint',
            concept: e.checkpoint.concept,
            explanation: e.checkpoint.explanation,
            question: e.checkpoint.question,
          });
          this.post({ type: 'learningCheckpoint', taskId, checkpoint: e.checkpoint });
          break;
        }
        case 'knowledgeCheck': {
          const msgId = this._newId('knowledgeCheck');
          this._appendTranscript({
            id: msgId,
            role: 'knowledgeCheck',
            checkId: e.checkId,
            concept: e.concept,
            question: e.check.question,
            hint: e.check.hint,
          });
          this._checks.set(e.checkId, { concept: e.concept, msgId });
          this.post({ type: 'knowledgeCheck', taskId, checkId: e.checkId, concept: e.concept, check: e.check });
          break;
        }
        case 'followUps': {
          if (e.suggestions.length) {
            this._appendTranscript({ id: this._newId('followUps'), role: 'followUps', suggestions: e.suggestions });
            this.post({ type: 'followUps', taskId, suggestions: e.suggestions });
          }
          break;
        }
        case 'done': {
          if (this._streamingAssistantId) {
            this.post({ type: 'streamEnd', taskId, messageId: this._streamingAssistantId });
            this._streamingAssistantId = null;
          }
          break;
        }
      }
    };

    try {
      await this._runner.run(text, onEvent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._appendTranscript({ id: this._newId('error'), role: 'error', code: 'task_error', message });
      this.post({ type: 'error', taskId, code: 'task_error', message });
    } finally {
      if (this._streamingAssistantId) {
        this._finalizeStreamingAssistant();
      }
      this._activeTaskId = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Transcript helpers                                                  */
  /* ------------------------------------------------------------------ */

  private _appendTranscript(msg: UiMessage): void {
    this._transcript.push(msg);
    // Keep the in-memory transcript bounded.
    if (this._transcript.length > 400) {
      this._transcript = this._transcript.slice(-400);
    }
  }

  /** Mark a knowledge check in the transcript as answered (restored on webview reload). */
  private _markCheckAnswered(checkId: string, answer: string): void {
    const entry = this._checks.get(checkId);
    if (!entry) {
      return;
    }
    const msg = this._transcript.find((m) => m.id === entry.msgId);
    if (msg && msg.role === 'knowledgeCheck') {
      msg.answered = answer;
    }
  }

  private _appendAssistantDelta(delta: string): void {
    if (!this._streamingAssistantId) {
      return;
    }
    const msg = this._transcript.find((m) => m.id === this._streamingAssistantId);
    if (msg && msg.role === 'assistant') {
      msg.text += delta;
    }
  }

  private _finalizeStreamingAssistant(): void {
    const id = this._streamingAssistantId;
    if (id) {
      const msg = this._transcript.find((m) => m.id === id);
      if (msg && msg.role === 'assistant') {
        msg.state = 'done';
      }
    }
    this._streamingAssistantId = null;
  }

  private _newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private _newTaskId(): string {
    return this._newId('task');
  }

  /** Runtime validation of untrusted webview messages before they enter the host. */
  private _parseMessage(msg: unknown): UiToHostMessage | null {
    if (typeof msg !== 'object' || msg === null) {
      return null;
    }
    const candidate = msg as { type?: unknown };
    const valid: ReadonlySet<string> = new Set([
      'userMessage',
      'approvalResponse',
      'cancelTask',
      'requestState',
      'connectionTest',
      'newChat',
      'knowledgeCheckResponse',
      'followUp',
      'learningProfileRequest',
    ]);
    return typeof candidate.type === 'string' && valid.has(candidate.type) ? (msg as UiToHostMessage) : null;
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = this._makeNonce();
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'chat.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'chat.css'));

    return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${css}" />
    <title>CodeMentor</title>
  </head>
  <body>
    <div id="connection-bar" class="connection-bar">
      <span id="connection-status" class="connection-status">Connecting…</span>
      <span id="connection-model" class="connection-model"></span>
    </div>
    <div id="transcript" class="transcript" aria-live="polite">
      <div class="msg assistant">
        <div class="role">CodeMentor</div>
        <div class="body">
          Hello! I'm CodeMentor — an AI agent that builds software <em>and</em> teaches you as we go.<br />
          Describe a project or feature in plain language and I'll inspect your workspace,
          propose a plan, and implement it step by step with explanations.<br />
          <small>Providers, safety approvals, and the agent loop are being wired across milestones.</small>
        </div>
      </div>
    </div>
    <div class="composer">
      <textarea id="input" rows="3" placeholder="e.g. Build me a simple expense tracker with React + TypeScript. I'm a beginner — explain as we go." />
      <div class="composer-actions">
        <span id="autonomy" class="badge">guided</span>
        <span id="depth" class="badge">standard</span>
        <button id="cancel" class="btn secondary" type="button" disabled>Cancel</button>
        <button id="send" class="btn primary" type="button">Send</button>
      </div>
    </div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }

  private _makeNonce(): string {
    const bytes = new Uint8Array(16);
    (globalThis.crypto ?? require('crypto')).getRandomValues?.(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}
