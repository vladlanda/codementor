import * as vscode from 'vscode';

import type { ProviderService } from '../providers/ProviderService';
import type { SettingsService } from '../services/SettingsService';
import { WorkspaceContext } from '../context/WorkspaceContext';
import { ToolRegistry } from '../tools/registry';
import type { ApprovalRequest, ToolContext } from '../tools/types';
import { VsCodeFileSink, runShellCommand, collectDiagnostics } from './vscodeHost';
import { Orchestrator, type AgentEvent } from '../agent/Orchestrator';
import { buildSystemPrompt } from '../agent/prompts';
import { parseTeachingArtifacts, buildProfileSnapshot } from '../agent/teaching';
import { LearningProfile } from '../learning/LearningProfile';
import type { LearningProfileData } from '../messaging/protocol';

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
    private readonly _settings: SettingsService,
    private readonly _profile?: LearningProfile
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

  private _newCheckId(): string {
    return `check_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Record a concept / knowledge-check outcome against the learning profile. */
  public recordCheckOutcome(concept: string, demonstrated: boolean): void {
    this._profile?.recordCheckOutcome(concept, demonstrated);
  }

  /**
   * Record that the user engaged with a knowledge check on a concept. Without a
   * grading step this conservatively sets the concept to `introduced` — we never
   * claim mastery from exposure alone (spec §5.3).
   */
  public recordEngagement(concept: string): void {
    this._profile?.recordEngagement(concept);
  }

  /** Load the current learning profile (empty when no profile is configured). */
  public getProfile(): LearningProfileData {
    return this._profile?.load() ?? { concepts: [], updatedAt: 0 };
  }

  public setProfileExperienceLevel(level: string): LearningProfileData {
    return this._profile?.setExperienceLevel(level) ?? this.getProfile();
  }

  public setProfileNotes(notes: string): LearningProfileData {
    return this._profile?.setNotes(notes) ?? this.getProfile();
  }

  /** Run one task, streaming events through onEvent. Resolves when the task ends. */
  public async run(userTask: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    const provider = await this._providerService.create();
    const settings = this._settings.getAgent();
    const teachingEnabled = settings.teaching.enabled;
    const profileSnapshot = teachingEnabled ? buildProfileSnapshot(this._profile?.load()) : '';

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
      teachingEnabled,
      profileSnapshot,
    });

    // Parse teaching artifacts out of the final answer, emit them as structured
    // events (filtered by the individual teaching toggles), and return the clean
    // visible text.
    const transformFinalAnswer = (text: string): string => {
      const parsed = parseTeachingArtifacts(text);
      if (teachingEnabled) {
        for (const cp of parsed.checkpoints) {
          onEvent({ type: 'checkpoint', checkpoint: cp });
        }
        if (settings.teaching.knowledgeChecks) {
          for (const { concept, check } of parsed.checks) {
            onEvent({ type: 'knowledgeCheck', checkId: this._newCheckId(), concept, check });
          }
        }
        if (settings.teaching.followUps && parsed.followUps.length) {
          onEvent({ type: 'followUps', suggestions: parsed.followUps });
        }
      }
      return parsed.visibleText;
    };

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
      transformFinalAnswer,
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
