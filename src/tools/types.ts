import type * as vscode from 'vscode';
import type { z } from 'zod';
import type { ToolSpec } from '../providers/provider';

/** Minimal file-write sink so tool modules stay free of the `vscode` runtime (testable in Node). */
export interface FileSink {
  writeFile(path: string, data: Buffer): Promise<void>;
}

/**
 * A tool is a small, typed, bounded capability the agent may invoke. Each tool
 * declares a JSON-schema {@link spec} (sent to the model) and an async {@link run}.
 * `run` receives already-validated arguments (see ToolRegistry) and returns a
 * structured result plus a human-readable summary for the transcript.
 */
export interface ToolContext {
  /** Workspace root (for resolving absolute file URIs). */
  root: vscode.Uri;
  /** Workspace-relative file access (safe). */
  workspace: import('../context/WorkspaceContext').WorkspaceContext;
  /** Approval callback for consequential operations. Resolves false if denied. */
  requestApproval: (req: ApprovalRequest) => Promise<boolean>;
  /** Whether file writes currently require approval (from settings/autonomy). */
  approvalFileChanges: boolean;
  /** Diagnostics provider (backed by VS Code). */
  getDiagnostics?: (relPath?: string) => Promise<string>;
  /** Run a terminal command with bounded output. */
  runTerminal?: (cmd: string, opts: { cwd?: string; timeoutMs?: number }) => Promise<TerminalResult>;
  /** Whether terminal commands currently require approval (from settings/autonomy). */
  approvalTerminalCommands: boolean;
  /** File-write sink (backed by VS Code in the extension host; a stub in tests). */
  fileSink: FileSink;
  /** Signal that the current task was cancelled. */
  isCancelled?: () => boolean;
}

export interface ApprovalRequest {
  kind: 'file' | 'terminal' | 'plan';
  title: string;
  description: string;
  risky: boolean;
  diff?: Array<{ filePath: string; diff: string; isNew: boolean }>;
  command?: string;
}

export interface TerminalResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Machine-readable payload fed back to the model. */
  data: unknown;
  /** Short human summary for the transcript. */
  summary: string;
}

export interface Tool<A = unknown> {
  name: string;
  spec: ToolSpec;
  /** Runtime validator for model-produced arguments. */
  argsSchema: z.ZodType<A>;
  run(args: A, ctx: ToolContext): Promise<ToolResult>;
}
