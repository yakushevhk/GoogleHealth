import { describe, expect, it } from 'vitest';
import { esc, fmt, fmtDateDot, fmtDuration, isConnError } from '@lib/ui';

describe('fmtDateDot', () => {
  it('YYYY-MM-DD → DD.MM.YYYY (digits only — for Doto font)', () => {
    expect(fmtDateDot('2026-07-28')).toBe('28.07.2026');
    expect(fmtDateDot('2026-01-05')).toBe('05.01.2026');
  });
});

describe('fmt', () => {
  it('null/undefined/NaN → dash', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(NaN)).toBe('—');
  });
  it('decimals with digits (ru-RU comma)', () => expect(fmt(3.14159, 2)).toBe('3,14'));
});

describe('isConnError', () => {
  it('recognizes connection failures (token/network/5xx) — shown calmly', () => {
    expect(isConnError('OAuth refresh failed: Token has been expired or revoked.')).toBe(true);
    expect(isConnError('Failed to fetch')).toBe(true);
    expect(isConnError('Google Health API: fetch failed')).toBe(true); // Node/undici network failure
    expect(isConnError('Google Health API: network error')).toBe(true);
    expect(isConnError('networkerror')).toBe(true);
    expect(isConnError('HTTP 503')).toBe(true);
    expect(isConnError('HTTP 500')).toBe(true);
    expect(isConnError('HTTP 401')).toBe(true);
    expect(isConnError('HTTP 403')).toBe(true);
    expect(isConnError('request aborted')).toBe(true);
    expect(isConnError('request timeout')).toBe(true);
  });
  it("doesn't mistake regular data errors for connection failures", () => {
    expect(isConnError('invalid date format')).toBe(false);
    expect(isConnError('HTTP 404')).toBe(false);
    expect(isConnError('HTTP 600')).toBe(false); // above 5xx — not a connection code
    expect(isConnError('')).toBe(false);
    // Key: parsing/data errors with the word "token" must NOT be masked
    // as "no connection" (previously \btoken\b gave false positives).
    expect(isConnError('unexpected token in JSON')).toBe(false);
    expect(isConnError('invalid token format')).toBe(false);
  });
});

describe('fmtDuration', () => {
  it('null → dash', () => expect(fmtDuration(null)).toBe('—'));
  it('minutes', () => expect(fmtDuration(754)).toBe('13 min'));
  it('hours + minutes', () => expect(fmtDuration(25920)).toBe('7 h 12 min'));
  it("rounding doesn't produce '60 min' / '1 h 60 min' (carry to hours)", () => {
    expect(fmtDuration(3599)).toBe('1 h 0 min');
    expect(fmtDuration(7199)).toBe('2 h 0 min');
  });
});

describe('esc', () => {
  it('escapes HTML special chars (protection from stored XSS)', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(esc('a & b "c" \'d\'')).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
  });
  it('coerces non-strings to string', () => {
    expect(esc(42)).toBe('42');
    expect(esc(null)).toBe('null');
  });
});
