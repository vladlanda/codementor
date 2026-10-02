import { createPathGuard } from '../context/pathGuard';
import type { ToolContext, FileSink } from '../tools/types';
import type { ListedFile, ReadResult, SearchMatch } from '../context/WorkspaceContext';

/**
 * A vscode-free ToolContext for orchestrator/tool tests.
 * `root` is normally a vscode.Uri but is not used by the tools under test,
 * so we pass a minimal stand-in.
 */
export interface FakeContextOptions {
  files?: Record<string, string>;
  fileTree?: Array<{ path: string; sizeBytes?: number }>;
  approvalFileChanges?: boolean;
  approvalTerminalCommands?: boolean;
  approval?: (req: unknown) => Promise<boolean>;
  diagnosticsText?: string;
}

export interface FakeContext {
  ctx: ToolContext;
  sink: { files: Map<string, Buffer> };
}

export function makeFakeContext(opts: FakeContextOptions = {}): FakeContext {
  const guard = createPathGuard('d:/Workplace/CodeMentor');
  const files = opts.files ?? {};
  const fileTree = opts.fileTree ?? Object.keys(files).map((p) => ({ path: p, sizeBytes: files[p].length }));

  const sinkFiles = new Map<string, Buffer>();

  const workspace = {
    guard,
    async listFiles(): Promise<ListedFile[]> {
      return fileTree.map((f) => ({ relPath: f.path, sizeBytes: f.sizeBytes ?? 0 }));
    },
    async readFile(relPath: string): Promise<ReadResult> {
      const rel = guard.resolve(relPath);
      if (!(rel in files)) {
        throw new Error(`no such file: ${rel}`);
      }
      return { relPath: rel, content: files[rel], truncated: false };
    },
    async search(): Promise<SearchMatch[]> {
      return [];
    },
  };

  const fileSink: FileSink = {
    async writeFile(path: string, data: Buffer): Promise<void> {
      sinkFiles.set(path, data);
    },
  };

  const defaultApproval = (req: unknown): Promise<boolean> => {
    void req;
    return Promise.resolve(opts.approvalFileChanges ? false : true);
  };

  const ctx: ToolContext = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    root: { fsPath: 'd:/Workplace/CodeMentor' } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workspace: workspace as any,
    requestApproval: opts.approval ?? defaultApproval,
    approvalFileChanges: opts.approvalFileChanges ?? false,
    approvalTerminalCommands: opts.approvalTerminalCommands ?? false,
    fileSink,
    getDiagnostics: opts.diagnosticsText !== undefined
      ? async () => opts.diagnosticsText ?? ''
      : undefined,
  };

  return { ctx, sink: { files: sinkFiles } };
}
