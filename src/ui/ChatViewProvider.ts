import * as vscode from 'vscode';

import type {
  ConnectionInfoMsg,
  HostToUiMessage,
  UiToHostMessage,
} from '../messaging/protocol';
import { ConnectionManager } from '../providers/ConnectionManager';
import { SettingsService } from '../services/SettingsService';

/**
 * Owns the sidebar webview: lifecycle, HTML, and the typed message bridge to the
 * extension host. It deliberately does little logic itself — orchestration lives
 * in higher-level services so this file stays focused on the UI boundary.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codementor.chatView';

  private _view: vscode.WebviewView | undefined;
  private _disposed = false;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _settings: SettingsService,
    private readonly _connection: ConnectionManager
  ) {}

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
      messages: [],
      activeTaskId: null,
      activeTaskState: 'idle',
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
    // Full conversation store lands in M5/M7. For now ask the UI to clear its transcript.
    this.post({ type: 'stateSnapshot', messages: [], activeTaskId: null, activeTaskState: 'idle', connection: this._connection.getSnapshot() });
  }

  public async explainSelection(uri?: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('CodeMentor: select some code first.');
      return;
    }
    const file = uri ? vscode.workspace.fs.readFile(uri) : undefined;
    const selected = editor.document.getText(editor.selection);
    const docUri = editor.document.uri;
    const payload = JSON.stringify({
      uri: docUri.toString(),
      language: editor.document.languageId,
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
      selected,
      wholeDocument: file === undefined ? undefined : Buffer.from(await file).toString('utf8'),
    });
    // A later milestone routes this to the orchestrator as a task.
    void vscode.window.showInformationMessage(`CodeMentor: prepared Explain Selection for ${docUri.path}`);
    void payload;
  }

  public cancelActiveTask(): void {
    // Orchestrator wiring in M5.
    void vscode.window.showInformationMessage('CodeMentor: no active task to cancel yet.');
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
    // Learning profile view lands in M6.
    void vscode.window.showInformationMessage('CodeMentor: learning profile is coming in a later milestone.');
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
        // Full orchestration lands in M5. For now acknowledge the bridge works.
        const ack: HostToUiMessage = {
          type: 'error',
          taskId: msg.taskId,
          code: 'not_implemented',
          message:
            'The message bridge is wired. Agent orchestration arrives in Milestone 5 — ' +
            'providers, tools, and the state machine are next. Try adjusting settings meanwhile.',
        };
        this.post(ack);
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
