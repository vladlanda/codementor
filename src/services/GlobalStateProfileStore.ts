import type { ProfileStore } from '../learning/LearningProfile';

/**
 * A minimal Memento-shaped interface so the store works with both VS Code's
 * `ExtensionContext.globalState` (the extension host) and plain test doubles,
 * without the core `LearningProfile` depending on `vscode`.
 *
 * Mirrors the subset of `vscode.Memento` that `LearningProfile` actually uses:
 * a `get`/`update` over `string → unknown`. Deletion is implemented by
 * updating the key to `undefined`, which every Memento-compatible store treats
 * as "no value".
 */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<unknown>;
}

/**
 * A `ProfileStore` adapter backed by a `Memento` (spec §8: "persist state in
 * extension storage"). `LearningProfile` treats the store as a single-key map
 * and stores the whole profile object under one key, so this adapter is a thin
 * pass-through.
 */
export class GlobalStateProfileStore implements ProfileStore {
  constructor(private readonly memento: MementoLike) {}

  public get<T>(key: string): T | undefined {
    return this.memento.get<T>(key);
  }

  public set(key: string, value: unknown): void {
    void this.memento.update(key, value);
  }

  public delete(key: string): void {
    void this.memento.update(key, undefined);
  }
}
