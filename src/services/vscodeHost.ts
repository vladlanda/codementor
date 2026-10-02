import * as vscode from 'vscode';

import type { FileSink, TerminalResult } from '../tools/types';

/** VS Code-backed file sink used by the write tools. */
export class VsCodeFileSink implements FileSink {
  public async writeFile(path: string, data: Buffer): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.workspace.fs.writeFile(uri, data);
  }
}

/**
 * Runs terminal commands in a hidden terminal, capturing bounded output.
 * Uses a temporary integrated terminal + a child process for reliable exit codes.
 */
export async function runShellCommand(
  command: string,
  opts: { cwd?: string; timeoutMs?: number },
  workspaceRoot: string
): Promise<TerminalResult> {
  const { execFile } = await import('node:child_process');
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell' : 'sh';
  const shellArgs = isWindows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return await new Promise<TerminalResult>((resolve) => {
    const child = execFile(
      shell,
      shellArgs,
      { cwd: opts.cwd ? `${workspaceRoot}/${opts.cwd}` : workspaceRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let exitCode: number | null = null;
        let timedOut = false;
        if (error) {
          const e = error as { code?: string | number; killed?: boolean; signal?: NodeJS.Signals };
          if (typeof e.code === 'number') {
            exitCode = e.code;
          } else if (e.signal === 'SIGTERM' || e.killed) {
            timedOut = true;
          } else {
            exitCode = 1;
          }
        }
        resolve({ exitCode, stdout: cap(stdout, 20_000), stderr: cap(stderr ?? '', 20_000), timedOut });
      }
    );
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', () => clearTimeout(timer));
  });
}

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
}

/** Collect current VS Code diagnostics, optionally scoped to one file. */
export async function collectDiagnostics(relPath?: string): Promise<string> {
  const collect = async (doc: vscode.TextDocument): Promise<string> => {
    const diags = vscode.languages.getDiagnostics(doc.uri);
    if (diags.length === 0) {
      return '';
    }
    const lines = diags.slice(0, 200).map((d) => {
      const sev = ['Error', 'Warning', 'Info', 'Hint'][d.severity] ?? 'Note';
      const loc = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
      return `${sev} @${loc} ${d.source ?? ''} ${d.message}`.trim();
    });
    return lines.join('\n');
  };

  if (relPath) {
    // Best-effort: find the matching open document.
    const base = relPath.replace(/\\/g, '/').toLowerCase();
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.toLowerCase().replace(/\\/g, '/').endsWith(base));
    if (doc) {
      return await collect(doc);
    }
    return `(no open document matched ${relPath})`;
  }

  const parts: string[] = [];
  for (const doc of vscode.workspace.textDocuments) {
    const text = await collect(doc);
    if (text) {
      parts.push(`${doc.uri.fsPath}:\n${text}`);
    }
  }
  return parts.join('\n\n');
}
