/**
 * Pure, dependency-free path validation. Keeping this free of the `vscode` module
 * means it can be unit-tested in plain Node without an extension host.
 *
 * Guarantees:
 *  - Resolved paths cannot escape the workspace root.
 *  - Sensitive files (.env, private keys, credentials) are rejected by default.
 *  - Generated / dependency directories can be excluded from listing.
 */

export interface PathGuardOptions {
  /** Sensitive file name basenames (case-insensitive) that must never be read/written. */
  sensitiveBasenamePatterns?: string[];
  /** Directory basenames excluded from recursive listing. */
  excludeDirs?: string[];
}

const DEFAULT_SENSITIVE: string[] = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  '.netrc',
  'credentials.json',
  'service-account.json',
  '.pgpass',
];

const DEFAULT_EXCLUDE_DIRS: string[] = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.cache',
  'coverage',
];

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/** Normalize a mix of slashes into a forward-slash relative or absolute path. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function toPosix(p: string): string {
  return normalizePath(p);
}

function isWithin(root: string, target: string): boolean {
  const r = toPosix(root).replace(/\/+$/, '');
  const t = toPosix(target).replace(/\/+$/, '');
  return t === r || t.startsWith(r + '/');
}

/**
 * Resolve a (possibly relative) path against the workspace root and assert it stays
 * inside. Returns the canonical workspace-relative path (forward slashes, no leading '/').
 *
 * @throws PathValidationError on escape, absolute path outside root, or `..` traversal.
 */
export function resolveWithinWorkspace(root: string, candidate: string): string {
  const r = toPosix(root).replace(/\/+$/, '');
  const c = toPosix(candidate).trim();

  if (c.length === 0) {
    throw new PathValidationError('Empty path');
  }

  // Candidate may be absolute (e.g. from a tool) — it must still be within root.
  const absolute = c.startsWith('/') || /^[A-Za-z]:/i.test(c);
  const hadDrive = /^[A-Za-z]:/i.test(c);
  let full: string;
  if (absolute) {
    full = c;
  } else {
    full = r + '/' + c;
  }

  // Collapse `.` and `..` segments lexically (we do not stat, to stay pure/sync).
  const segments: string[] = [];
  for (const seg of full.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      segments.pop();
    } else {
      segments.push(seg);
    }
  }
  // Re-apply the prefix so `isWithin` comparisons match:
  //  - drive path (e.g. d:): leading segment is "d:" and needs a following slash.
  //  - absolute posix path: re-add the leading "/".
  let resolved: string;
  if (hadDrive) {
    resolved = (segments[0] ?? '') + (segments.length > 1 ? '/' + segments.slice(1).join('/') : '');
  } else if (full.startsWith('/')) {
    resolved = '/' + segments.join('/');
  } else {
    resolved = segments.join('/');
  }

  if (!isWithin(r, resolved)) {
    throw new PathValidationError(`Path escapes the workspace: ${candidate}`);
  }

  // Return workspace-relative form.
  const rel = resolved === r ? '' : resolved.slice(r.length + 1);
  return rel;
}

/**
 * True if a relative file path should be treated as sensitive and refused.
 */
export function isSensitive(relPath: string, options: PathGuardOptions = {}): boolean {
  const patterns = options.sensitiveBasenamePatterns ?? DEFAULT_SENSITIVE;
  const parts = toPosix(relPath).split('/');
  const basename = parts[parts.length - 1] ?? '';
  const lower = basename.toLowerCase();

  for (const p of patterns) {
    const lp = p.toLowerCase();
    if (lower === lp) {
      return true;
    }
    // Support glob-like suffix patterns such as "*.pem".
    if (lp.startsWith('*.') && lower.endsWith(lp.slice(1))) {
      return true;
    }
  }
  return false;
}

/** True if any segment of a relative path matches an excluded directory. */
export function isExcludedDir(relPath: string, options: PathGuardOptions = {}): boolean {
  const excluded = options.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;
  const parts = toPosix(relPath).split('/');
  for (const seg of parts) {
    if (excluded.includes(seg)) {
      return true;
    }
  }
  return false;
}

export interface PathGuard {
  root: string;
  resolve(candidate: string): string;
  isSensitive(relPath: string): boolean;
  isExcluded(relPath: string): boolean;
  /** Full absolute path from a workspace-relative path. */
  absolute(relPath: string): string;
}

/** Build a configured guard for a workspace root. */
export function createPathGuard(root: string, options: PathGuardOptions = {}): PathGuard {
  const canonicalRoot = toPosix(root).replace(/\/+$/, '');
  return {
    root: canonicalRoot,
    resolve: (candidate) => resolveWithinWorkspace(canonicalRoot, candidate),
    isSensitive: (rel) => isSensitive(rel, options),
    isExcluded: (rel) => isExcludedDir(rel, options),
    absolute: (rel) => (rel === '' ? canonicalRoot : canonicalRoot + '/' + toPosix(rel).replace(/^\/+/, '')),
  };
}
