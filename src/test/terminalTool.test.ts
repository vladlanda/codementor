import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyCommand } from '../tools/terminalTool';

test('classifies package installs as risky', () => {
  const r = classifyCommand('npm install express');
  assert.equal(r.risky, true);
  assert.ok(r.tags.includes('install'));
});

test('classifies destructive deletes as risky', () => {
  const r = classifyCommand('rm -rf ./build');
  assert.equal(r.risky, true);
  assert.ok(r.tags.includes('delete'));
});

test('flags network access', () => {
  const r = classifyCommand('curl https://example.com/download');
  assert.equal(r.risky, true);
  assert.ok(r.tags.includes('network'));
});

test('benign commands are not risky', () => {
  const r = classifyCommand('node --version');
  assert.equal(r.risky, false);
  assert.equal(r.tags.length, 0);
});

test('flags db destructive operations', () => {
  const r = classifyCommand('drop table users');
  assert.equal(r.risky, true);
  assert.ok(r.tags.includes('db-destructive'));
});
