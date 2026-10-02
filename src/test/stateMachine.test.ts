import test from 'node:test';
import assert from 'node:assert/strict';

import { TaskStateMachine, IllegalStateTransitionError } from '../agent/TaskStateMachine';
import type { TaskState } from '../messaging/protocol';

test('starts idle and can enter planning', () => {
  const sm = new TaskStateMachine();
  assert.equal(sm.state, 'idle');
  sm.transition('planning');
  assert.equal(sm.state, 'planning');
});

test('follows the happy path to completed', () => {
  const sm = new TaskStateMachine();
  const path: TaskState[] = ['planning', 'executing', 'explaining', 'completed'];
  for (const s of path) {
    sm.transition(s);
  }
  assert.equal(sm.state, 'completed');
});

test('approval round trip: executing -> awaiting_approval -> executing', () => {
  const sm = new TaskStateMachine();
  sm.transition('planning');
  sm.transition('executing');
  sm.transition('awaiting_approval');
  sm.transition('executing');
  assert.equal(sm.state, 'executing');
});

test('cancellation is allowed from any active state', () => {
  // Each active state reached via a valid path from idle, then cancelled.
  const paths: TaskState[][] = [
    ['planning'],
    ['planning', 'executing'],
    ['planning', 'executing', 'awaiting_approval'],
    ['planning', 'executing', 'explaining'],
    ['planning', 'executing', 'validating'],
  ];
  for (const path of paths) {
    const sm = new TaskStateMachine();
    for (const s of path) {
      sm.transition(s);
    }
    sm.transition('cancelled');
    assert.equal(sm.state, 'cancelled');
  }
});

test('rejects illegal transitions', () => {
  const sm = new TaskStateMachine();
  sm.transition('planning');
  assert.throws(() => sm.transition('completed'), IllegalStateTransitionError);
});

test('emits change events', () => {
  const sm = new TaskStateMachine();
  const seen: Array<[TaskState, TaskState]> = [];
  sm.onChange((from, to) => seen.push([from, to]));
  sm.transition('planning');
  assert.deepEqual(seen, [['idle', 'planning']]);
});

test('validTransitions reports allowed targets', () => {
  assert.ok(TaskStateMachine.validTransitions('idle').includes('planning'));
  assert.ok(TaskStateMachine.validTransitions('executing').includes('cancelled'));
});
