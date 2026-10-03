import * as vscode from 'vscode';
import type { LearningProfileData } from '../messaging/protocol';

/** The profile API the panel needs, so it does not depend on the runner directly. */
export interface ProfileApi {
  getProfile(): LearningProfileData;
  setExperienceLevel(level: string): LearningProfileData;
  setNotes(notes: string): LearningProfileData;
}

/**
 * A simple, inspectable learning-profile panel (spec §5.3: "Make the profile
 * inspectable and editable"). It renders the current profile and lets the user
 * tweak experience level / notes. Concept status is shown read-only in the MVP —
 * status changes come from evidence (knowledge checks), not manual editing.
 */
export class LearningProfilePanel {
  private static _instance: LearningProfilePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _api: ProfileApi;

  private constructor(api: ProfileApi) {
    this._api = api;
    this._panel = vscode.window.createWebviewPanel(
      'codementor.learningProfile',
      'CodeMentor Learning Profile',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this._panel.webview.html = this._buildHtml(this._panel.webview);
    this._panel.webview.onDidReceiveMessage((msg) => void this._onMessage(msg));
    this._panel.onDidDispose(() => {
      if (LearningProfilePanel._instance === this) {
        LearningProfilePanel._instance = undefined;
      }
    });
    this._push();
  }

  /** Open (or reveal) the profile panel bound to the given profile API. */
  public static show(api: ProfileApi): void {
    if (LearningProfilePanel._instance) {
      LearningProfilePanel._instance._api = api;
      LearningProfilePanel._instance._panel.reveal();
      LearningProfilePanel._instance._push();
      return;
    }
    LearningProfilePanel._instance = new LearningProfilePanel(api);
  }

  private _push(): void {
    void this._panel?.webview.postMessage({ type: 'profile', profile: this._api.getProfile() });
  }

  private async _onMessage(msg: { type?: string; value?: string }): Promise<void> {
    if (msg.type === 'setExperienceLevel') {
      this._api.setExperienceLevel(msg.value ?? '');
      this._push();
    } else if (msg.type === 'setNotes') {
      this._api.setNotes(msg.value ?? '');
      this._push();
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = this._makeNonce();
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 16px; color: var(--vscode-foreground); }
  h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 8px; }
  h2 { font-size: 0.95rem; margin: 20px 0 8px; }
  .muted { opacity: 0.7; font-size: 0.85rem; }
  .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
  select, textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; border-radius: 4px; }
  .concept { padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin: 6px 0; }
  .concept .name { font-weight: 600; }
  .status { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 0.75rem; margin-left: 8px; }
  .status.introduced { background: #3a3a3a; }
  .status.demonstrated { background: #2ea04380; }
  .status.needs_review { background: #b8860b66; }
  .empty { opacity: 0.6; font-style: italic; }
  .evidence { opacity: 0.7; font-size: 0.8rem; margin-top: 2px; }
</style>
</head>
<body>
  <h1>Learning profile</h1>
  <div class="muted">A lightweight record of concepts and evidence. CodeMentor never claims mastery from exposure alone.</div>

  <h2>Experience level</h2>
  <div class="row">
    <select id="exp">
      <option value="">—</option>
      <option value="beginner">Beginner</option>
      <option value="intermediate">Intermediate</option>
      <option value="advanced">Advanced</option>
    </select>
  </div>

  <h2>Notes</h2>
  <div class="row"><textarea id="notes" rows="3" placeholder="Project-specific learning notes…"></textarea></div>

  <h2>Concepts</h2>
  <div id="concepts"><div class="empty">No concepts recorded yet.</div></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const STATUS_LABEL = { introduced: 'introduced', demonstrated: 'demonstrated', needs_review: 'needs review' };
    function render(profile) {
      document.getElementById('exp').value = profile.experienceLevel || '';
      document.getElementById('notes').value = profile.notes || '';
      const box = document.getElementById('concepts');
      const concepts = profile.concepts || [];
      if (!concepts.length) {
        box.innerHTML = '<div class="empty">No concepts recorded yet. Complete a task or answer a knowledge check to see concepts here.</div>';
        return;
      }
      box.innerHTML = '';
      for (const c of concepts) {
        const div = document.createElement('div');
        div.className = 'concept';
        const name = document.createElement('div');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = c.concept;
        const statusSpan = document.createElement('span');
        statusSpan.className = 'status ' + (c.status || 'introduced');
        statusSpan.textContent = STATUS_LABEL[c.status] || c.status;
        name.appendChild(nameSpan);
        name.appendChild(statusSpan);
        div.appendChild(name);
        if (c.evidence) {
          const ev = document.createElement('div');
          ev.className = 'evidence';
          ev.textContent = c.evidence;
          div.appendChild(ev);
        }
        box.appendChild(div);
      }
    }
    vscode.onDidReceiveMessage((msg) => { if (msg.type === 'profile') render(msg.profile); });
    document.getElementById('exp').addEventListener('change', (e) => vscode.postMessage({ type: 'setExperienceLevel', value: e.target.value }));
    document.getElementById('notes').addEventListener('change', (e) => vscode.postMessage({ type: 'setNotes', value: e.target.value }));
  </script>
</body>
</html>`;
  }

  private _makeNonce(): string {
    const bytes = new Uint8Array(16);
    const g = globalThis as { crypto?: { getRandomValues?: (arr: Uint8Array) => void } };
    const getRandom = g.crypto?.getRandomValues;
    if (getRandom) {
      getRandom(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}
