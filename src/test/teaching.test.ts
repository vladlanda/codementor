import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTeachingArtifacts, buildTeachingInstructions, buildProfileSnapshot } from '../agent/teaching';
import type { LearningProfileData } from '../messaging/protocol';

test('parseTeachingArtifacts: returns text unchanged when no block is present', () => {
  const text = 'Here is the answer you asked for.\n\nNo artifacts here.';
  const out = parseTeachingArtifacts(text);
  assert.equal(out.visibleText, text.trim());
  assert.equal(out.checkpoints.length, 0);
  assert.equal(out.checks.length, 0);
  assert.equal(out.followUps.length, 0);
});

test('parseTeachingArtifacts: returns empty for empty input', () => {
  const out = parseTeachingArtifacts('');
  assert.equal(out.visibleText, '');
  assert.equal(out.checkpoints.length, 0);
});

test('parseTeachingArtifacts: parses a well-formed block and strips it', () => {
  const text = [
    'Prose explanation here.',
    '',
    '[[CODEMENTOR_TEACHING',
    'checkpoint: Closures | false | A function that keeps its lexical scope.',
    'check: Closures | What does a closure capture? | Look at the outer function.',
    'followup: Deeper | Explain garbage collection with closures.',
    'followup: Example | Write a counter using a closure.',
    ']]',
    '',
    'Trailing note after the block.',
  ].join('\n');

  const out = parseTeachingArtifacts(text);

  assert.equal(out.checkpoints.length, 1);
  assert.equal(out.checkpoints[0].concept, 'Closures');
  assert.equal(out.checkpoints[0].optional, false);
  assert.match(out.checkpoints[0].explanation, /lexical scope/i);

  assert.equal(out.checks.length, 1);
  assert.equal(out.checks[0].concept, 'Closures');
  assert.match(out.checks[0].check.question, /capture/i);
  assert.match(out.checks[0].check.hint ?? '', /outer function/i);

  assert.equal(out.followUps.length, 2);
  assert.equal(out.followUps[0].label, 'Deeper');
  assert.match(out.followUps[0].prompt, /garbage collection/i);

  // Both leading prose and trailing note must be preserved; the block itself is gone.
  assert.match(out.visibleText, /Prose explanation here\./);
  assert.match(out.visibleText, /Trailing note after the block\./);
  assert.doesNotMatch(out.visibleText, /CODEMENTOR_TEACHING/);
});

test('parseTeachingArtifacts: tolerates stray pipes inside the free-text fields', () => {
  const text = [
    '[[CODEMENTOR_TEACHING',
    'checkpoint: Pipes | false | Linux pipes connect stdout to stdin; they are like | data buses | in a CPU.',
    ']]',
  ].join('\n');
  const out = parseTeachingArtifacts(text);
  assert.equal(out.checkpoints.length, 1);
  assert.equal(out.checkpoints[0].concept, 'Pipes');
  // The overflow was rejoined into the explanation field, so the text is preserved.
  assert.match(out.checkpoints[0].explanation, /data buses/);
  assert.match(out.checkpoints[0].explanation, /stdin/);
});

test('parseTeachingArtifacts: tolerates optional `optional: true` and empty hint', () => {
  const text = [
    '[[CODEMENTOR_TEACHING',
    'checkpoint: Trivia | true | A light fact.',
    'check: Trivia | Question only?',
    ']]',
  ].join('\n');
  const out = parseTeachingArtifacts(text);
  assert.equal(out.checkpoints.length, 1);
  assert.equal(out.checkpoints[0].optional, true);
  assert.equal(out.checks.length, 1);
  assert.equal(out.checks[0].check.question, 'Question only?');
  assert.equal(out.checks[0].check.hint, undefined);
});

test('parseTeachingArtifacts: ignores an unterminated block', () => {
  const text = '[[CODEMENTOR_TEACHING\ncheckpoint: X | false | Y';
  const out = parseTeachingArtifacts(text);
  assert.equal(out.checkpoints.length, 0);
  assert.equal(out.visibleText, text.trim());
});

test('buildTeachingInstructions: is empty when disabled and non-empty when enabled', () => {
  assert.equal(buildTeachingInstructions(false), '');
  assert.match(buildTeachingInstructions(true), /CODEMENTOR_TEACHING/);
});

test('buildProfileSnapshot: empty for an empty profile', () => {
  assert.equal(buildProfileSnapshot(undefined), '');
  assert.equal(buildProfileSnapshot({ concepts: [], updatedAt: 0 }), '');
});

test('buildProfileSnapshot: renders experience level, concepts, and notes', () => {
  const profile: LearningProfileData = {
    experienceLevel: 'intermediate',
    notes: 'Focused on TypeScript.',
    updatedAt: 1,
    concepts: [
      { concept: 'Generics', status: 'demonstrated', evidence: 'passed a check', updatedAt: 1 },
      { concept: 'Decorators', status: 'introduced', updatedAt: 1 },
    ],
  };
  const out = buildProfileSnapshot(profile);
  assert.match(out, /Experience level: intermediate/);
  assert.match(out, /Generics \(demonstrated: passed a check\)/);
  assert.match(out, /Decorators \(introduced\)/);
  assert.match(out, /Notes: Focused on TypeScript\./);
});

test('buildProfileSnapshot: caps the concept list when it exceeds maxConcepts', () => {
  const profile: LearningProfileData = {
    updatedAt: 1,
    concepts: Array.from({ length: 30 }, (_, i) => ({ concept: `C${i}`, status: 'introduced' as const, updatedAt: 1 })),
  };
  const out = buildProfileSnapshot(profile, 5);
  assert.match(out, /C0 \(introduced\)/);
  assert.match(out, /C4 \(introduced\)/);
  assert.doesNotMatch(out, /C5 \(introduced\)/);
  assert.match(out, /…and 25 more/);
});
