import type { Tool, ToolContext, ToolResult } from './types';
import { listFilesTool, readFileTool, searchTool, diagnosticsTool } from './readTools';
import { createFileTool, editFileTool } from './writeTools';
import { runCommandTool } from './terminalTool';

export class InvalidToolArgsError extends Error {
  constructor(public readonly tool: string, public readonly issues: string) {
    super(`Invalid arguments for tool '${tool}': ${issues}`);
    this.name = 'InvalidToolArgsError';
  }
}

/**
 * Holds the set of available tools and dispatches validated calls.
 * All model-produced arguments pass through each tool's zod schema before `run`,
 * satisfying the "validate all model-produced arguments at runtime" requirement.
 */
export class ToolRegistry {
  private readonly _tools: Map<string, Tool<any>> = new Map();

  constructor(tools: Tool<any>[] = defaultTools()) {
    for (const t of tools) {
      this._tools.set(t.name, t);
    }
  }

  public all(): Tool<any>[] {
    return [...this._tools.values()];
  }

  public get(name: string): Tool<any> | undefined {
    return this._tools.get(name);
  }

  public names(): string[] {
    return [...this._tools.keys()];
  }

  /** Validate args against the tool schema; throws InvalidToolArgsError on failure. */
  public validateArgs<A>(name: string, raw: unknown): A {
    const tool = this._tools.get(name);
    if (!tool) {
      throw new InvalidToolArgsError(name, `unknown tool`);
    }
    const parsed = tool.argsSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new InvalidToolArgsError(name, issues);
    }
    return parsed.data as A;
  }

  /** Validate then run. Returns a structured result; validation errors are surfaced as a failed result. */
  public async invoke<A = unknown>(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this._tools.get(name);
    if (!tool) {
      return { ok: false, data: null, summary: `Unknown tool: ${name}` };
    }
    let args: A;
    try {
      args = this.validateArgs<A>(name, rawArgs);
    } catch (e) {
      const err = e as InvalidToolArgsError;
      return { ok: false, data: null, summary: err.message };
    }
    return tool.run(args, ctx);
  }
}

export function defaultTools(): Tool<any>[] {
  return [listFilesTool, readFileTool, searchTool, diagnosticsTool, createFileTool, editFileTool, runCommandTool];
}
