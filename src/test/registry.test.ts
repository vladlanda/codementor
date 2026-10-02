import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolRegistry, InvalidToolArgsError, defaultTools } from '../tools/registry';

test('registry exposes the default tool set', () => {
  const r = new ToolRegistry();
  const names = new Set(r.names());
  for (const expected of ['list_files', 'read_file', 'search_workspace', 'get_diagnostics', 'create_file', 'edit_file', 'run_command']) {
    assert.ok(names.has(expected), `missing ${expected}`);
  }
});

test('validateArgs accepts well-formed args', () => {
  const r = new ToolRegistry();
  const args = r.validateArgs<{ path: string }>('read_file', { path: 'src/app.ts' });
  assert.equal(args.path, 'src/app.ts');
});

test('validateArgs rejects unknown tool', () => {
  const r = new ToolRegistry();
  assert.throws(() => r.validateArgs('nope', {}), InvalidToolArgsError);
});

test('validateArgs rejects missing required field', () => {
  const r = new ToolRegistry();
  assert.throws(() => r.validateArgs('read_file', {}), /path/);
});

test('validateArgs rejects wrong types', () => {
  const r = new ToolRegistry();
  assert.throws(() => r.validateArgs('run_command', { command: 42 }), /command/);
});

test('all tools expose a usable argsSchema', () => {
  for (const t of defaultTools()) {
    assert.ok(t.argsSchema, `${t.name} missing argsSchema`);
    assert.ok(typeof t.argsSchema.safeParse === 'function', `${t.name} argsSchema not a zod schema`);
  }
});
