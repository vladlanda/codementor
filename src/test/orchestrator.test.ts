import test from 'node:test';
import assert from 'node:assert/strict';

import { Orchestrator, type AgentEvent } from '../agent/Orchestrator';
import { ToolRegistry } from '../tools/registry';
import { readFileTool, listFilesTool } from '../tools/readTools';
import { createFileTool } from '../tools/writeTools';
import { makeFakeContext } from './fakeContext';
import type { LLMProvider, ChatResult, ChatChunk, ChatRequest, ModelInfo, ProviderCapabilities } from '../providers/provider';

/** Scripted provider: returns a queue of ChatResults, one per provider call. */
class FakeProvider implements LLMProvider {
  kind = 'openai' as const;
  constructor(private readonly script: ChatResult[]) {}

  private next(): ChatResult {
    const r = this.script.shift();
    if (!r) throw new Error('FakeProvider exhausted');
    return r;
  }

  async chat(_req: ChatRequest): Promise<ChatResult> {
    return this.next();
  }

  async *chatStream(_req: ChatRequest): AsyncGenerator<ChatChunk> {
    const r = this.next();
    if (r.text) yield { delta: r.text };
    for (const tc of r.toolCalls) {
      yield { toolCallDelta: { index: 0, id: tc.id, name: tc.name, argumentFragment: JSON.stringify(tc.arguments) } };
    }
    yield { delta: '' };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  capabilities(): ProviderCapabilities {
    return { supportsStreaming: false, supportsToolCalling: true, supportsStructuredOutput: false };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

const text = (t: string): ChatResult => ({ text: t, toolCalls: [], stopReason: 'end_turn' });
const calls = (arr: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): ChatResult => ({
  text: '',
  toolCalls: arr,
  stopReason: 'tool_use',
});

test('no tool call: completes and emits assistant text', async () => {
  const provider = new FakeProvider([text('Sure, let me help.')]);
  const registry = new ToolRegistry([]);
  const { ctx } = makeFakeContext({ approvalFileChanges: false, approvalTerminalCommands: false });
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
    onEvent: (e) => events.push(e),
  });
  await orch.run('hello');
  assert.equal(orch.state, 'completed');
  const assistant = events.find((e) => e.type === 'assistant') ?? events.find((e) => e.type === 'text');
  assert.ok(assistant, 'expected an assistant/text event');
});

test('tool call: runs the tool and feeds the result back', async () => {
  const provider = new FakeProvider([
    calls([{ id: 'c1', name: 'read_file', arguments: { path: 'README.md' } }]),
    text('I read the README for you.'),
  ]);
  const registry = new ToolRegistry([readFileTool]);
  const { ctx } = makeFakeContext({ files: { 'README.md': 'Hello README' }, approvalFileChanges: false });
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
    onEvent: (e) => events.push(e),
  });
  await orch.run('read readme');
  assert.equal(orch.state, 'completed');
  const toolEvents = events.filter((e) => e.type === 'tool');
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].type === 'tool' ? toolEvents[0].result.summary : '', 'Read README.md.');
});

test('approval denied: the write is not applied', async () => {
  const provider = new FakeProvider([
    calls([{ id: 'c1', name: 'create_file', arguments: { path: 'new.txt', content: 'x' } }]),
    text('The write was skipped because you declined approval.'),
  ]);
  const registry = new ToolRegistry([createFileTool]);
  const { ctx, sink } = makeFakeContext({
    approvalFileChanges: true,
    approval: async () => false,
  });
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
  });
  await orch.run('create a file');
  assert.equal(sink.files.size, 0, 'file must not be written when approval is denied');
});

test('approval granted: the write is applied', async () => {
  const provider = new FakeProvider([
    calls([{ id: 'c1', name: 'create_file', arguments: { path: 'new.txt', content: 'hello' } }]),
    text('Created new.txt.'),
  ]);
  const registry = new ToolRegistry([createFileTool]);
  const { ctx, sink } = makeFakeContext({
    approvalFileChanges: true,
    approval: async () => true,
  });
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
  });
  await orch.run('create a file');
  assert.equal(sink.files.size, 1, 'file must be written when approval is granted');
});

test('cancellation: run resolves and state is cancelled', async () => {
  const provider = new FakeProvider([text('starting'), text('more')]);
  const registry = new ToolRegistry([listFilesTool]);
  const { ctx } = makeFakeContext({ approvalFileChanges: false });
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
  });
  const p = orch.run('do work');
  orch.cancel();
  await p;
  assert.equal(orch.state, 'cancelled');
});

test('iteration limit: repeated tool calls without an answer fail', async () => {
  const script: ChatResult[] = [];
  for (let i = 0; i < 10; i++) {
    script.push(calls([{ id: `c${i}`, name: 'list_files', arguments: {} }]));
  }
  const provider = new FakeProvider(script);
  const registry = new ToolRegistry([listFilesTool]);
  const { ctx } = makeFakeContext({ fileTree: [{ path: 'a.txt' }], approvalFileChanges: false });
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
    maxIterations: 3,
    onEvent: (e) => events.push(e),
  });
  await orch.run('loop forever');
  assert.equal(orch.state, 'failed');
  assert.ok(events.some((e) => e.type === 'error' && e.code === 'iteration_limit'));
});

test('bad tool arguments: reported as a tool error, task still completes', async () => {
  const provider = new FakeProvider([
    calls([{ id: 'c1', name: 'read_file', arguments: {} }]), // missing required path
    text('That read failed because the path was missing.'),
  ]);
  const registry = new ToolRegistry([readFileTool]);
  const { ctx } = makeFakeContext({ approvalFileChanges: false });
  const orch = new Orchestrator({
    provider,
    tools: registry,
    makeToolContext: () => ctx,
    systemPrompt: 'sys',
  });
  await orch.run('read');
  assert.equal(orch.state, 'completed');
});
