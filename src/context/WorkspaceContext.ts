import * as vscode from 'vscode';

import { createPathGuard, PathGuard, PathValidationError } from './pathGuard';

export interface ListedFile {
  relPath: string;
  sizeBytes: number;
}

export interface ReadResult {
  relPath: string;
  content: string;
  truncated: boolean;
}

export interface SearchMatch {
  relPath: string;
  line: number; // 1-based
  text: string;
}

export interface SearchOptions {
  maxFiles?: number;
  maxMatches?: number;
  caseSensitive?: boolean;
  regex?: boolean;
}

/**
 * Read-only workspace inspection: safe listing, reading, and text search.
 * Every path is routed through the {@link PathGuard}; sensitive and excluded
 * files are never returned.
 */
export class WorkspaceContext {
  private _guard: PathGuard;

  constructor(private readonly _root: vscode.Uri, guard?: PathGuard) {
    this._guard = guard ?? createPathGuard(this._root.fsPath);
  }

  public get guard(): PathGuard {
    return this._guard;
  }

  /**
   * Recursively list files, skipping excluded directories and capping the result.
   * @param maxFiles hard cap on returned entries.
   */
  public async listFiles(maxFiles = 2000): Promise<ListedFile[]> {
    const results: ListedFile[] = [];
    await this._walk(this._root, '', results, maxFiles);
    return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  private async _walk(dir: vscode.Uri, relDir: string, acc: ListedFile[], maxFiles: number): Promise<void> {
    if (acc.length >= maxFiles) {
      return;
    }
    let entries: Array<[string, vscode.FileType]>;
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return; // unreadable — skip silently (permissions, etc.)
    }
    for (const [name, type] of entries) {
      if (acc.length >= maxFiles) {
        return;
      }
      const rel = relDir === '' ? name : relDir + '/' + name;
      if (type === vscode.FileType.Directory) {
        if (this._guard.isExcluded(rel)) {
          continue;
        }
        await this._walk(vscode.Uri.joinPath(dir, name), rel, acc, maxFiles);
      } else if (type === vscode.FileType.File) {
        if (this._guard.isExcluded(rel) || this._guard.isSensitive(rel)) {
          continue;
        }
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, name));
          acc.push({ relPath: rel, sizeBytes: stat.size });
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Read a file's text, enforcing path + sensitivity rules and a size cap. */
  public async readFile(relPath: string, maxChars = 120_000): Promise<ReadResult> {
    let rel: string;
    try {
      rel = this._guard.resolve(relPath);
    } catch (e) {
      throw e instanceof PathValidationError ? e : new Error(String(e));
    }
    if (this._guard.isSensitive(rel)) {
      throw new PathValidationError(`Refusing to read sensitive file: ${relPath}`);
    }
    const uri = vscode.Uri.file(this._guard.absolute(rel));
    const buf = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(buf).toString('utf8');
    const truncated = content.length > maxChars;
    return {
      relPath: rel,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
    };
  }

  /** Search across workspace files (bounded). */
  public async search(query: string, opts: SearchOptions = {}): Promise<SearchMatch[]> {
    const maxFiles = opts.maxFiles ?? 400;
    const maxMatches = opts.maxMatches ?? 80;
    const files = await this.listFiles(maxFiles);
    const useRegex = opts.regex ?? false;
    let pattern: RegExp;
    try {
      pattern = useRegex
        ? new RegExp(query, opts.caseSensitive ? '' : 'i')
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g' + (opts.caseSensitive ? '' : 'i'));
    } catch {
      throw new Error(`Invalid search pattern: ${query}`);
    }

    const matches: SearchMatch[] = [];
    for (const f of files) {
      if (matches.length >= maxMatches) {
        break;
      }
      if (f.sizeBytes > 500_000) {
        continue; // skip large/binary-ish files
      }
      let content: string;
      try {
        content = (await this.readFile(f.relPath, 300_000)).content;
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
        pattern.lastIndex = 0;
        if (useRegex ? pattern.test(lines[i]) : pattern.test(lines[i])) {
          matches.push({ relPath: f.relPath, line: i + 1, text: lines[i].trim().slice(0, 240) });
        }
      }
    }
    return matches;
  }

  /** Compact textual summary of the workspace for seeding agent context. */
  public async describe(): Promise<string> {
    const files = await this.listFiles(400);
    const lines = files.slice(0, 200).map((f) => `${f.relPath} (${f.sizeBytes}b)`);
    return `Workspace has ${files.length} files (showing ${lines.length}):\n${lines.join('\n')}`;
  }
}
