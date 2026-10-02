import { z } from 'zod';

import { Tool, ToolResult } from './types';

/**
 * Classify a shell command into risk categories so the approval prompt can warn the
 * user about installs, deletions, config changes, or network access. Heuristic only —
 * the approval policy itself is the real guardrail.
 */
export function classifyCommand(cmd: string): { risky: boolean; tags: string[] } {
  const c = cmd.toLowerCase();
  const tags: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/(rm\s+-[a-z]*r|\bdel\s|remove-item|shutil\.rmtree|rd\s+\/s)/, 'delete'],
    [/(npm\s+(install|i|ci|add)|pnpm\s+(install|add)|yarn\s+(add|install)|pip\s+install|cargo\s+add|gem\s+install)/, 'install'],
    [/(git\s+push|git\s+reset|git\s+clean|git\s+rebase)/, 'git-destructive'],
    [/(curl|wget|fetch|nc\b|ssh\b|scp\b)/, 'network'],
    [/(chmod|chown|sudo|setx|reg\s+add|write-hostconfig)/, 'config'],
    [/(drop\s+(table|database)|truncate\s+table)/, 'db-destructive'],
  ];
  for (const [re, tag] of patterns) {
    if (re.test(c)) {
      tags.push(tag);
    }
  }
  return { risky: tags.length > 0, tags };
}

const RunCommandArgs = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
});

export const runCommandTool: Tool<z.infer<typeof RunCommandArgs>> = {
  name: 'run_command',
  argsSchema: RunCommandArgs,
  spec: {
    name: 'run_command',
    description:
      'Run a terminal command in the workspace. Requires approval. Risky operations (installs, deletions, network, config) are flagged.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run.' },
        cwd: { type: 'string', description: 'Optional workspace-relative working directory.' },
        timeoutMs: { type: 'number', description: 'Optional timeout in ms (default from settings).' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!ctx.runTerminal) {
      return { ok: false, data: null, summary: 'Terminal execution is not available in this context.' };
    }
    const { risky, tags } = classifyCommand(args.command);

    if (ctx.approvalTerminalCommands) {
      const approved = await ctx.requestApproval({
        kind: 'terminal',
        title: `Run command`,
        description: `Execute: ${args.command}${tags.length ? ` (risk: ${tags.join(', ')})` : ''}`,
        risky,
        command: args.command,
      });
      if (!approved) {
        return { ok: false, data: null, summary: 'Command was not approved.' };
      }
    }

    const res = await ctx.runTerminal(args.command, {
      cwd: args.cwd,
      timeoutMs: args.timeoutMs,
    });
    const ok = res.exitCode === 0;
    return {
      ok,
      data: { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, timedOut: res.timedOut },
      summary: ok ? `Command succeeded (exit 0).` : `Command failed (exit ${res.exitCode ?? 'n/a'}).`,
    };
  },
};
