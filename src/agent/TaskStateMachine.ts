import type { TaskState } from '../messaging/protocol';

/**
 * Explicit task lifecycle. Transitions are constrained so we never rely on
 * free-form conversation text to know where execution stands.
 */

// `cancelled` is reachable from any active state — a user may cancel at any time.
// Tool approvals happen from `executing`; after a decision the loop re-enters
// `executing` to run the next step, and a terminal answer flows to
// `explaining` -> `validating` -> `completed`.
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  idle: ['planning', 'cancelled'],
  planning: ['executing', 'cancelled', 'failed'],
  awaiting_approval: ['executing', 'planning', 'cancelled', 'failed'],
  executing: ['awaiting_approval', 'explaining', 'validating', 'completed', 'failed', 'cancelled'],
  explaining: ['validating', 'completed', 'cancelled'],
  validating: ['executing', 'completed', 'failed', 'cancelled'],
  completed: ['idle', 'cancelled'],
  failed: ['idle', 'cancelled'],
  cancelled: ['idle'],
};

export class IllegalStateTransitionError extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`Illegal task state transition: ${from} -> ${to}`);
    this.name = 'IllegalStateTransitionError';
  }
}

export class TaskStateMachine {
  private _state: TaskState = 'idle';
  private readonly _listeners: Array<(from: TaskState, to: TaskState) => void> = [];

  public get state(): TaskState {
    return this._state;
  }

  public canTransition(to: TaskState): boolean {
    return TRANSITIONS[this._state].includes(to);
  }

  public transition(to: TaskState): void {
    if (this._state === to) {
      return;
    }
    if (!this.canTransition(to)) {
      throw new IllegalStateTransitionError(this._state, to);
    }
    const from = this._state;
    this._state = to;
    for (const l of this._listeners) {
      l(from, to);
    }
  }

  /** Reset to idle (allowed from any terminal state). */
  public reset(): void {
    if (this._state !== 'idle') {
      this._state = 'idle';
      for (const l of this._listeners) {
        l(this._state, 'idle');
      }
    }
  }

  public onChange(fn: (from: TaskState, to: TaskState) => void): void {
    this._listeners.push(fn);
  }

  public static validTransitions(from: TaskState): TaskState[] {
    return [...TRANSITIONS[from]];
  }
}
