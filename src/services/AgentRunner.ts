import * as vscode from 'vscode';

import type { ProviderService } from '../providers/ProviderService';
import type { SettingsService } from '../services/SettingsService';
import { WorkspaceContext } from '../context/WorkspaceContext';
import { ToolRegistry } from '../tools/registry';
import type { ApprovalRequest, ToolContext } from '../tools/types';
import { VsCodeFileSink, runShellCommand, collectDiagnostics } from './vscodeHost';
import { Orchestrator, type AgentEvent } from '../agent/Orchestrator';
import { buildSystemPrompt } from '../agent/prompts';

/**
 * Host-side glue that turns a user task into an Orchestrator run. Owns the live
 * Orchestrator instance so the UI can cancel it and resolve approvals. Keeping
 * this separate from the webview provider keeps both files focused.
 */
export class AgentRunner {
  private _orchestrator: Orchestrator | undefined;
  private _history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(
    private readonly _providerService: ProviderService,
    private readonly _settings: SettingsService
  ) {}

  public get active(): boolean {
    return this._orchestrator !== undefined;
  }

  public cancel(): void {
    this._orchestrator?.cancel();
  }

  public resolveApproval(requestId: string, approved: boolean): void {
    this._orchestrator?.resolveApproval(requestId, approved);
  }

  public clearHistory(): void {
    this._history = [];
  }

  /** Run one task, streaming events through onEvent. Resolves when the task ends. */
  public async run(userTask: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    const provider = await this._providerService.create();
    const settings = this._settings.getAgent();

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      throw new Error('CodeMentor needs a folder open in VS Code to work with the workspace.');
    }

    const workspace = new WorkspaceContext(root);
    const workspaceDescription = await this._describeSafely(workspace);

    const registry = new ToolRegistry();
    const fileSink = new VsCodeFileSink();
    const makeToolContext = (requestApproval: (req: ApprovalRequest) => Promise<boolean>): ToolContext => ({
      root,
      workspace,
      requestApproval,
      approvalFileChanges: settings.approvalFileChanges,
      approvalTerminalCommands: settings.approvalTerminalCommands,
      fileSink,
      runTerminal: (command, opts) => runShellCommand(command, opts, root.fsPath),
      getDiagnostics: (relPath) => collectDiagnostics(relPath),
    });

    const systemPrompt = buildSystemPrompt({
      autonomy: settings.autonomy,
      explanationDepth: settings.explanationDepth,
      workspaceDescription,
    });

    const orchestrator = new Orchestrator({
      provider,
      tools: registry,
      makeToolContext,
      systemPrompt,
      onEvent,
      maxIterations: settings.maxToolIterations,
      maxOutputChars: settings.maxOutputChars,
      timeoutMs: settings.timeoutMs,
      history: this._history,
    });
    this._orchestrator = orchestrator;
    try {
      await orchestrator.run(userTask);
      this._appendHistory(userTask, orchestrator);
    } finally {
      this._orchestrator = undefined;
    }
  }

  private _appendHistory(userTask: string, orch: Orchestrator): void {
    this._history.push({ role: 'user', content: userTask });
    this._history.push({ role: 'assistant', content: `[task completed with state: ${orch.state}]` });
    // Keep the rolling window small to respect context budgets.
    if (this._history.length > 12) {
      this._history = this._history.slice(-12);
    }
  }

  private async _describeSafely(workspace: WorkspaceContext): Promise<string | undefined> {
    try {
      return await workspace.describe();
    } catch {
      return undefined;
    }
  }
}
