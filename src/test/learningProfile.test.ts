import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LearningProfile, InMemoryProfileStore } from '../learning/LearningProfile';

function freshProfile(): LearningProfile {
  return new LearningProfile(new InMemoryProfileStore());
}

test('load: returns an empty profile on first read', () => {
  const p = freshProfile().load();
  assert.deepEqual(p.concepts, []);
  assert.equal(p.experienceLevel, undefined);
  assert.equal(p.notes, undefined);
});

test('recordConcept: adds a new concept and updates it on repeat', () => {
  const p = freshProfile();
  p.recordConcept('Closures', 'introduced');
  assert.equal(p.load().concepts.length, 1);

  p.recordConcept('CLOSURES', 'needs_review');
  const concepts = p.load().concepts;
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].concept, 'Closures');
  assert.equal(concepts[0].status, 'needs_review');
});

test('recordConcept: demonstrated is sticky until explicitly demoted to needs_review', () => {
  const p = freshProfile();
  p.recordConcept('Generics', 'introduced');
  p.recordConcept('Generics', 'demonstrated');
  assert.equal(p.load().concepts[0].status, 'demonstrated');

  // A later `introduced` should not downgrade a demonstrated concept.
  p.recordConcept('Generics', 'introduced');
  assert.equal(p.load().concepts[0].status, 'demonstrated');

  // An explicit `needs_review` demotes it.
  p.recordConcept('Generics', 'needs_review');
  assert.equal(p.load().concepts[0].status, 'needs_review');
});

test('recordConcept: preserves evidence, allowing it to be overridden', () => {
  const p = freshProfile();
  p.recordConcept('Closures', 'introduced', 'first engagement');
  p.recordConcept('Closures', 'needs_review', 'struggled');
  assert.equal(p.load().concepts[0].evidence, 'struggled');

  // Calling without a new evidence keeps the previous one.
  p.recordConcept('Closures', 'needs_review');
  assert.equal(p.load().concepts[0].evidence, 'struggled');
});

test('recordEngagement: no-op for empty concept, otherwise sets introduced', () => {
  const p = freshProfile();
  const before = p.load().concepts.length;
  p.recordEngagement('');
  assert.equal(p.load().concepts.length, before);

  p.recordEngagement('Decorators');
  const c = p.load().concepts[0];
  assert.equal(c.concept, 'Decorators');
  assert.equal(c.status, 'introduced');
});

test('recordCheckOutcome: demonstrated on positive, needs_review on negative', () => {
  const p = freshProfile();
  p.recordCheckOutcome('Closures', true);
  assert.equal(p.load().concepts[0].status, 'demonstrated');
  assert.match(p.load().concepts[0].evidence ?? '', /correctly/i);

  p.recordCheckOutcome('Closures', false);
  assert.equal(p.load().concepts[0].status, 'needs_review');
  assert.match(p.load().concepts[0].evidence ?? '', /struggled/i);
});

test('recordCheckOutcome: no-op for empty concept', () => {
  const p = freshProfile();
  p.recordCheckOutcome('', true);
  assert.equal(p.load().concepts.length, 0);
});

test('setExperienceLevel and setNotes: persist to the store', () => {
  const p = freshProfile();
  p.setExperienceLevel('  intermediate ');
  p.setNotes('  Focused on TypeScript ');
  const profile = p.load();
  assert.equal(profile.experienceLevel, 'intermediate');
  assert.equal(profile.notes, 'Focused on TypeScript');
});

test('clear: removes the profile from the store', () => {
  const p = freshProfile();
  p.recordConcept('Closures', 'demonstrated');
  p.clear();
  assert.equal(p.load().concepts.length, 0);
});

test('profile round-trips through a shared store (simulating restart)', () => {
  const store = new InMemoryProfileStore();
  const a = new LearningProfile(store);
  a.recordConcept('Closures', 'demonstrated');
  a.setExperienceLevel('beginner');
  a.setNotes('hello');

  const b = new LearningProfile(store);
  const profile = b.load();
  assert.equal(profile.concepts.length, 1);
  assert.equal(profile.concepts[0].status, 'demonstrated');
  assert.equal(profile.experienceLevel, 'beginner');
  assert.equal(profile.notes, 'hello');
});
