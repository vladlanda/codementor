import * as crypto from 'node:crypto';
import { z } from 'zod';

import { Tool, ToolResult } from './types';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Write tools. Safety:
 *  - Paths are validated by the WorkspaceContext guard (no escape / no sensitive files).
 *  - File writes require approval unless the caller has disabled that policy.
 *  - A diff is always produced so the UI can show exactly what changed.
 *  - Concurrent-edit protection: we re-read the file immediately before applying and
 *    abort if its content changed since the agent last read it.
 */

function makeDiff(filePath: string, before: string, after: string, isNew: boolean): string {
  // Minimal unified-style diff (line based). Adequate for review; not a full diff engine.
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  const lines: string[] = [
    `--- ${isNew ? '/dev/null' : filePath}`,
    `+++ ${filePath}`,
  ];
  for (let i = 0; i < max; i++) {
    const av = a[i] ?? '';
    const bv = b[i] ?? '';
    if (av === bv) {
      lines.push(`  ${av}`);
    } else {
      if (av !== '') lines.push(`- ${av}`);
      if (bv !== '') lines.push(`+ ${bv}`);
    }
  }
  return lines.join('\n');
}

async function currentText(relPath: string, workspace: import('../context/WorkspaceContext').WorkspaceContext): Promise<{ text: string; existed: boolean }> {
  try {
    const r = await workspace.readFile(relPath, 5_000_000);
    return { text: r.content, existed: true };
  } catch {
    return { text: '', existed: false };
  }
}

const CreateFileArgs = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const createFileTool: Tool<z.infer<typeof CreateFileArgs>> = {
  name: 'create_file',
  argsSchema: CreateFileArgs,
  spec: {
    name: 'create_file',
    description: 'Create a new file (or overwrite) with the given content. Requires approval. Path must be inside the workspace and not a sensitive file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path of the file to create.' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    const guard = ctx.workspace.guard;
    let rel: string;
    try {
      rel = guard.resolve(args.path);
    } catch (e) {
      return { ok: false, data: null, summary: `Invalid path: ${(e as Error).message}` };
    }
    if (guard.isSensitive(rel)) {
      return { ok: false, data: null, summary: `Refusing to write sensitive file: ${rel}` };
    }

    const before = await currentText(rel, ctx.workspace);
    const diff = makeDiff(rel, before.text, args.content, !before.existed);

    if (ctx.approvalFileChanges) {
      const approved = await ctx.requestApproval({
        kind: 'file',
        title: before.existed ? `Edit ${rel}` : `Create ${rel}`,
        description: before.existed ? 'Apply an edit to an existing file.' : 'Create a new file.',
        risky: before.existed,
        diff: [{ filePath: rel, diff, isNew: !before.existed }],
      });
      if (!approved) {
        return { ok: false, data: null, summary: `Change to ${rel} was not approved.` };
      }
    }

    try {
      await ctx.fileSink.writeFile(guard.absolute(rel), Buffer.from(args.content, 'utf8'));
    } catch (e) {
      return { ok: false, data: null, summary: `Write failed: ${(e as Error).message}` };
    }
    return { ok: true, data: { path: rel, bytes: args.content.length, isNew: !before.existed }, summary: `${before.existed ? 'Edited' : 'Created'} ${rel}.` };
  },
};

const EditFileArgs = z.object({
  path: z.string().min(1),
  /** Exact existing text to find (must be unique in the file). */
  oldText: z.string().min(1),
  newText: z.string(),
  /** Optional sha256 of the file content the agent last read, for concurrent-edit safety. */
  baseSha256: z.string().optional(),
});

export const editFileTool: Tool<z.infer<typeof EditFileArgs>> = {
  name: 'edit_file',
  argsSchema: EditFileArgs,
  spec: {
    name: 'edit_file',
    description:
      'Replace one exact, unique occurrence of oldText with newText in a file. oldText must appear exactly once. Requires approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        oldText: { type: 'string', description: 'Exact text to replace (must be unique in the file).' },
        newText: { type: 'string', description: 'Replacement text.' },
        baseSha256: { type: 'string', description: 'Optional sha256 of the file as last read, to detect concurrent edits.' },
      },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    const guard = ctx.workspace.guard;
    let rel: string;
    try {
      rel = guard.resolve(args.path);
    } catch (e) {
      return { ok: false, data: null, summary: `Invalid path: ${(e as Error).message}` };
    }
    if (guard.isSensitive(rel)) {
      return { ok: false, data: null, summary: `Refusing to edit sensitive file: ${rel}` };
    }

    const { text: before, existed } = await currentText(rel, ctx.workspace);
    if (!existed) {
      return { ok: false, data: null, summary: `File not found: ${rel}` };
    }

    // Concurrent-edit protection: abort if the file changed since the agent read it.
    if (args.baseSha256 && sha256(before) !== args.baseSha256) {
      return { ok: false, data: null, summary: `Concurrent edit detected on ${rel}. Re-read the file before editing.` };
    }

    const count = before.split(args.oldText).length - 1;
    if (count === 0) {
      return { ok: false, data: null, summary: `oldText not found in ${rel}. It must match exactly (whitespace included).` };
    }
    if (count > 1) {
      return { ok: false, data: null, summary: `oldText is ambiguous (${count} occurrences) in ${rel}. Provide more surrounding context.` };
    }

    const after = before.replace(args.oldText, args.newText);
    const diff = makeDiff(rel, before, after, false);

    if (ctx.approvalFileChanges) {
      const approved = await ctx.requestApproval({
        kind: 'file',
        title: `Edit ${rel}`,
        description: 'Apply a targeted edit.',
        risky: true,
        diff: [{ filePath: rel, diff, isNew: false }],
      });
      if (!approved) {
        return { ok: false, data: null, summary: `Edit to ${rel} was not approved.` };
      }
    }

    try {
      await ctx.fileSink.writeFile(guard.absolute(rel), Buffer.from(after, 'utf8'));
    } catch (e) {
      return { ok: false, data: null, summary: `Write failed: ${(e as Error).message}` };
    }
    return { ok: true, data: { path: rel, replacedOccurrences: 1 }, summary: `Edited ${rel} (1 replacement).` };
  },
};
