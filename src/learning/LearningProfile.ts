import type { ConceptRecord, ConceptStatus, LearningProfileData } from '../messaging/protocol';

/**
 * Persistence-agnostic storage adapter. The extension host backs this with VS Code
 * `globalState`; tests back it with an in-memory map. Keeping the profile core
 * free of `vscode` lets it run under the plain Node test runner.
 */
export interface ProfileStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

/** In-memory store for tests. */
export class InMemoryProfileStore implements ProfileStore {
  private readonly _map = new Map<string, unknown>();
  public get<T>(key: string): T | undefined {
    return this._map.get(key) as T | undefined;
  }
  public set(key: string, value: unknown): void {
    this._map.set(key, value);
  }
  public delete(key: string): void {
    this._map.delete(key);
  }
}

const STORE_KEY = 'codementor.learningProfile';

function emptyProfile(): LearningProfileData {
  return { concepts: [], updatedAt: 0 };
}

/**
 * A lightweight, editable learning profile.
 *
 * Design constraint (spec §5.3): we must never infer mastery from merely
 * generating or reading an explanation. A concept starts as `introduced`; it is
 * promoted to `demonstrated` only when there is explicit evidence (a correct
 * knowledge-check answer, a successful independent implementation, or a user
 * self-assessment). `recordConcept` therefore takes a status + evidence pair from
 * the caller, and the caller is responsible for deciding whether evidence exists.
 */
export class LearningProfile {
  private readonly _store: ProfileStore;

  constructor(store: ProfileStore) {
    this._store = store;
  }

  public load(): LearningProfileData {
    const raw = this._store.get<LearningProfileData>(STORE_KEY);
    if (raw && Array.isArray(raw.concepts)) {
      return {
        experienceLevel: raw.experienceLevel,
        notes: raw.notes,
        concepts: raw.concepts,
        updatedAt: raw.updatedAt ?? Date.now(),
      };
    }
    return emptyProfile();
  }

  private _save(profile: LearningProfileData): void {
    this._store.set(STORE_KEY, { ...profile, updatedAt: Date.now() });
  }

  /** Record (or update) a concept with an explicit status and supporting evidence. */
  public recordConcept(concept: string, status: ConceptStatus, evidence?: string): LearningProfileData {
    const profile = this.load();
    const now = Date.now();
    const existing = profile.concepts.find((c) => c.concept.toLowerCase() === concept.toLowerCase());
    if (existing) {
      // `demonstrated` is the strongest claim and, once earned, is sticky unless
      // the caller explicitly demotes it to `needs_review`. A later `introduced`
      // (e.g. from a re-engagement) must not downgrade it.
      if (status === 'demonstrated' || (existing.status === 'demonstrated' && status !== 'needs_review')) {
        existing.status = 'demonstrated';
      } else {
        existing.status = status;
      }
      existing.evidence = evidence ?? existing.evidence;
      existing.updatedAt = now;
    } else {
      const record: ConceptRecord = { concept, status, updatedAt: now };
      if (evidence) {
        record.evidence = evidence;
      }
      profile.concepts.push(record);
    }
    this._save(profile);
    return profile;
  }

  /**
   * Record that the user engaged with a knowledge check on a concept. Without a
   * model-grading step we cannot claim mastery, so engagement conservatively sets
   * the concept to `introduced` (it is at least no longer untracked). This never
   * silently promotes to `demonstrated`.
   */
  public recordEngagement(concept: string): LearningProfileData {
    if (!concept) {
      return this.load();
    }
    return this.recordConcept(concept, 'introduced', 'engaged with a knowledge check');
  }

  /**
   * Record a graded knowledge-check outcome. `demonstrated` is only set on a
   * positive judgement (e.g. a model confirmed the answer is correct); a negative
   * judgement moves the concept to `needs_review`.
   */
  public recordCheckOutcome(concept: string, demonstrated: boolean): LearningProfileData {
    if (!concept) {
      return this.load();
    }
    if (demonstrated) {
      return this.recordConcept(concept, 'demonstrated', 'answered a knowledge check correctly');
    }
    return this.recordConcept(concept, 'needs_review', 'struggled with a knowledge check');
  }

  public setExperienceLevel(level: string): LearningProfileData {
    const profile = this.load();
    profile.experienceLevel = level.trim();
    this._save(profile);
    return profile;
  }

  public setNotes(notes: string): LearningProfileData {
    const profile = this.load();
    profile.notes = notes.trim();
    this._save(profile);
    return profile;
  }

  public clear(): void {
    this._store.delete(STORE_KEY);
  }
}
