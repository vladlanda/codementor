import { z } from 'zod';

import { Tool, ToolResult } from './types';

/* ------------------------------------------------------------------ */
/* list_files                                                          */
/* ------------------------------------------------------------------ */

const ListFilesArgs = z.object({
  maxFiles: z.number().int().min(1).max(5000).optional(),
});

export const listFilesTool: Tool<z.infer<typeof ListFilesArgs>> = {
  name: 'list_files',
  argsSchema: ListFilesArgs,
  spec: {
    name: 'list_files',
    description: 'List workspace files (respecting ignore rules). Returns workspace-relative paths and sizes.',
    parameters: {
      type: 'object',
      properties: { maxFiles: { type: 'number', description: 'Maximum number of files to return (default 1000).' } },
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    const files = await ctx.workspace.listFiles(args.maxFiles ?? 1000);
    return {
      ok: true,
      data: files,
      summary: `Listed ${files.length} files.`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* read_file                                                           */
/* ------------------------------------------------------------------ */

const ReadFileArgs = z.object({
  path: z.string().min(1),
  maxChars: z.number().int().min(100).max(500_000).optional(),
});

export const readFileTool: Tool<z.infer<typeof ReadFileArgs>> = {
  name: 'read_file',
  argsSchema: ReadFileArgs,
  spec: {
    name: 'read_file',
    description: 'Read a workspace file as text. Refuses sensitive files (e.g. .env, private keys).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        maxChars: { type: 'number', description: 'Optional cap on characters returned.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    const res = await ctx.workspace.readFile(args.path, args.maxChars ?? 120_000);
    return { ok: true, data: { path: res.relPath, truncated: res.truncated, content: res.content }, summary: `Read ${res.relPath}${res.truncated ? ' (truncated)' : ''}.` };
  },
};

/* ------------------------------------------------------------------ */
/* search_workspace                                                    */
/* ------------------------------------------------------------------ */

const SearchArgs = z.object({
  query: z.string().min(1),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  maxMatches: z.number().int().min(1).max(500).optional(),
});

export const searchTool: Tool<z.infer<typeof SearchArgs>> = {
  name: 'search_workspace',
  argsSchema: SearchArgs,
  spec: {
    name: 'search_workspace',
    description: 'Search workspace file contents for a string or regex. Returns matching file/line/text.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring (default) or regex.' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression.' },
        caseSensitive: { type: 'boolean', description: 'Match case exactly.' },
        maxMatches: { type: 'number', description: 'Maximum matches (default 80).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    const matches = await ctx.workspace.search(args.query, {
      regex: args.regex ?? false,
      caseSensitive: args.caseSensitive ?? false,
      maxMatches: args.maxMatches ?? 80,
    });
    return { ok: true, data: matches, summary: `Found ${matches.length} match(es) for "${args.query}".` };
  },
};

/* ------------------------------------------------------------------ */
/* get_diagnostics                                                     */
/* ------------------------------------------------------------------ */

const DiagnosticsArgs = z.object({
  path: z.string().optional(),
});

export const diagnosticsTool: Tool<z.infer<typeof DiagnosticsArgs>> = {
  name: 'get_diagnostics',
  argsSchema: DiagnosticsArgs,
  spec: {
    name: 'get_diagnostics',
    description: 'Return current language/compile diagnostics, optionally for a single file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional workspace-relative file path.' } },
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!ctx.getDiagnostics) {
      return { ok: false, data: null, summary: 'Diagnostics provider is not available in this context.' };
    }
    const text = await ctx.getDiagnostics(args.path);
    const empty = text.trim().length === 0;
    return { ok: true, data: { text }, summary: empty ? 'No diagnostics reported.' : 'Diagnostics retrieved.' };
  },
};
