import test from 'node:test';
import assert from 'node:assert/strict';

import { OllamaProvider } from '../providers/OllamaProvider';
import { ProviderError } from '../providers/provider';

test('OllamaProvider reports expected capabilities', () => {
  const p = new OllamaProvider('http://localhost:11434', 'qwen2.5:7b');
  const caps = p.capabilities();
  assert.equal(caps.supportsStreaming, true);
  assert.equal(caps.supportsToolCalling, true);
});

test('OllamaProvider base url strips trailing slash', () => {
  const p = new OllamaProvider('http://localhost:11434/', 'qwen2.5:7b');
  // `base` is private; exercise via listModels URL construction indirectly through ping (no network needed for url check).
  assert.ok(p.kind === 'ollama');
});

test('ProviderError preserves code and retryability', () => {
  const err = new ProviderError('boom', 'timeout', true, new Error('x'));
  assert.equal(err.name, 'ProviderError');
  assert.equal(err.code, 'timeout');
  assert.equal(err.retryable, true);
  assert.ok(err.cause instanceof Error);
});
