/**
 * Privacy helpers: keep sensitive data out of logs and out of places it
 * doesn't belong. Isomorphic, covered by tests.
 *
 * Used for:
 * - redacting OAuth credentials from captured errors / url-strings before logging;
 * - validating that a string does not look like a credential (defense-in-depth
 *   when a value is about to be echoed into an error message);
 * - JSON-safe sanitization of values sent to the browser (never include the raw
 *   refresh/access token, never include a numeric Google user id standalone).
 */

const AUTH_PATTERNS = [
  /(client[_-]?secret|client[_-]?id|refresh[_-]?token|access[_-]?token|api[_-]?key)\s*[:=]\s*["']?[^\s"',]+/gi,
];

/** Redact well-known credential patterns from a string (for safe logging). */
export function redact(s: string): string {
  return AUTH_PATTERNS.reduce(
    (acc, re) => acc.replace(re, (_m, key) => `${key}="[REDACTED]"`),
    s,
  );
}

/**
 * Does the value look like a credential? Used before echoing user-influenced
 * text (URLs, upstream error messages) to decide whether to redact it.
 */
export function looksLikeCredential(s: string): boolean {
  return (
    /\b(?:refresh|access)[_-]?\s?token\b/i.test(s) ||
    /\bclient[_-]?\s?(?:secret|id)\b/i.test(s) ||
    /\bapi[_-]?key\b/i.test(s)
  );
}

/**
 * Strip values whose keys look like credentials from an object (recursive,
 * including objects nested inside arrays), returning a copy without them.
 * Used before serializing data.
 */
export function stripCredentials(obj: Record<string, unknown>): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v !== null && typeof v === 'object') return stripCredentials(v as Record<string, unknown>);
    return v;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|client[-_]?(id|secret)|api[-_]?key/i.test(k)) continue;
    out[k] = clean(v);
  }
  return out;
}

/** A standalone GitHub-style 9-digit Google user id (used in error messages). */
export function hasGoogleUserId(s: string): boolean {
  return /users\/(?!me\b)(\d{6,})\b/.test(s);
}

/** Replace a numeric Google user id with a placeholder (for safe logs). */
export function redactGoogleUserId(s: string): string {
  return s.replace(/users\/(?!me\b)\d{6,}/g, (m) => m.replace(/\d+/, '{user}'));
}
