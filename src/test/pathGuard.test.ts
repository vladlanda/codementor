import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPathGuard,
  isExcludedDir,
  isSensitive,
  PathValidationError,
  resolveWithinWorkspace,
} from '../context/pathGuard';

const ROOT = '/workspace/project';

test('resolveWithinWorkspace keeps relative paths inside root', () => {
  assert.equal(resolveWithinWorkspace(ROOT, 'src/index.ts'), 'src/index.ts');
  assert.equal(resolveWithinWorkspace(ROOT, './a/b.ts'), 'a/b.ts');
  assert.equal(resolveWithinWorkspace(ROOT, 'a/../b.ts'), 'b.ts');
});

test('resolveWithinWorkspace rejects escapes', () => {
  assert.throws(() => resolveWithinWorkspace(ROOT, '../outside.ts'), PathValidationError);
  assert.throws(() => resolveWithinWorkspace(ROOT, 'a/../../x.ts'), PathValidationError);
  assert.throws(() => resolveWithinWorkspace(ROOT, '/etc/passwd'), PathValidationError);
});

test('resolveWithinWorkspace accepts absolute paths within root', () => {
  assert.equal(resolveWithinWorkspace(ROOT, '/workspace/project/src/app.ts'), 'src/app.ts');
});

test('resolveWithinWorkspace rejects empty', () => {
  assert.throws(() => resolveWithinWorkspace(ROOT, ''), PathValidationError);
});

test('isSensitive detects secret files by basename', () => {
  assert.equal(isSensitive('.env'), true);
  assert.equal(isSensitive('config/.env.local'), true);
  assert.equal(isSensitive('secrets/id_rsa'), true);
  assert.equal(isSensitive('src/app.ts'), false);
});

test('isSensitive supports glob suffix patterns', () => {
  assert.equal(isSensitive('certs/server.pem', { sensitiveBasenamePatterns: ['*.pem'] }), true);
  assert.equal(isSensitive('notes.txt', { sensitiveBasenamePatterns: ['*.pem'] }), false);
});

test('isExcludedDir filters generated/dependency dirs', () => {
  assert.equal(isExcludedDir('node_modules/lodash/index.js'), true);
  assert.equal(isExcludedDir('src/node_modules/x.js'), true);
  assert.equal(isExcludedDir('src/app.ts'), false);
});

test('createPathGuard wires resolve + absolute', () => {
  const g = createPathGuard(ROOT);
  assert.equal(g.resolve('lib/x.ts'), 'lib/x.ts');
  assert.equal(g.absolute('lib/x.ts'), '/workspace/project/lib/x.ts');
  assert.equal(g.isSensitive('.env'), true);
  assert.throws(() => g.resolve('../../x'), PathValidationError);
});
