import { describe, expect, it } from 'vitest';
import { json, jsonError, queryDate, readJson } from '@lib/api-utils';
import { GhError } from '@lib/gh-client';

describe('readJson', () => {
  const req = (body: string) =>
    new Request('http://localhost/api', { method: 'POST', body });

  it('returns parsed object', async () => {
    await expect(readJson(req('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it('broken JSON → GhError 400 (not 500)', async () => {
    try {
      await readJson(req('{bad'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GhError);
      expect((e as GhError).status).toBe(400);
    }
  });

  it('non-objects (null, array, number) → GhError 400', async () => {
    for (const body of ['null', '[1,2]', '42', '"str"']) {
      try {
        await readJson(req(body));
        expect.unreachable();
      } catch (e) {
        expect((e as GhError).status).toBe(400);
      }
    }
  });
});

describe('json', () => {
  it('returns 200 with JSON body', async () => {
    const res = json({ steps: 9750 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ steps: 9750 });
  });

  it('returns custom status code', () => {
    const res = json({ error: 'not found' }, 404);
    expect(res.status).toBe(404);
  });

  it('sets no-store cache header', () => {
    const res = json({ ok: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sets application/json content type', () => {
    const res = json({ ok: true });
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  });

  it('serializes arrays and primitives', async () => {
    expect(await json([1, 2, 3]).json()).toEqual([1, 2, 3]);
    expect(await json('hello').json()).toBe('hello');
    expect(await json(null).json()).toBeNull();
  });
});

describe('jsonError', () => {
  it('maps GhError 400 to 400', () => {
    const res = jsonError(new GhError('bad request', 400));
    expect(res.status).toBe(400);
  });

  it('maps GhError 404 to 404', () => {
    const res = jsonError(new GhError('not found', 404));
    expect(res.status).toBe(404);
  });

  it('maps GhError 500 to 502', () => {
    const res = jsonError(new GhError('internal', 500));
    expect(res.status).toBe(502);
  });

  it('maps GhError 401 to 502', () => {
    const res = jsonError(new GhError('unauthorized', 401));
    expect(res.status).toBe(502);
  });

  it('maps GhError 403 to 502', () => {
    const res = jsonError(new GhError('forbidden', 403));
    expect(res.status).toBe(502);
  });

  it('maps GhError 429 to 429 (not remapped)', () => {
    const res = jsonError(new GhError('rate limited', 429));
    expect(res.status).toBe(429);
  });

  it('maps non-GhError to 500', () => {
    const res = jsonError(new Error('something broke'));
    expect(res.status).toBe(500);
  });

  it('maps non-Error throwables to 500', () => {
    const res = jsonError('string failure');
    expect(res.status).toBe(500);
  });

  it('includes error message in body', async () => {
    const res = jsonError(new GhError('quota exceeded', 429));
    const body = await res.json();
    expect(body).toEqual({ error: 'quota exceeded' });
  });

  it('includes Error message for non-GhError', async () => {
    const res = jsonError(new TypeError('bad type'));
    const body = await res.json();
    expect(body).toEqual({ error: 'bad type' });
  });

  it('stringifies non-Error values', async () => {
    const res = jsonError(42);
    const body = await res.json();
    expect(body).toEqual({ error: '42' });
  });
});

describe('queryDate', () => {
  it('returns date from query param', () => {
    const url = new URL('http://localhost/api?date=2026-07-22');
    expect(queryDate(url, '2026-01-01')).toBe('2026-07-22');
  });

  it('returns default when no param', () => {
    const url = new URL('http://localhost/api');
    expect(queryDate(url, '2026-01-01')).toBe('2026-01-01');
  });

  it('returns 400 Response for invalid date', () => {
    const url = new URL('http://localhost/api?date=22.07.2026');
    const result = queryDate(url, '2026-01-01');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('returns 400 for partial date', () => {
    const url = new URL('http://localhost/api?date=2026-7-2');
    const result = queryDate(url, '2026-01-01');
    expect(result).toBeInstanceOf(Response);
  });

  it('returns 400 for empty string param', () => {
    const url = new URL('http://localhost/api?date=');
    const result = queryDate(url, '2026-01-01');
    // empty string is falsy but ?? only catches null/undefined;
    // searchParams.get('date') returns '' which passes ??, then fails regex
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('accepts valid date in YYYY-MM-DD format', () => {
    const url = new URL('http://localhost/api?date=2028-02-29');
    expect(queryDate(url, '2026-01-01')).toBe('2028-02-29');
  });

  it('400 body contains error message', async () => {
    const url = new URL('http://localhost/api?date=nope');
    const result = queryDate(url, '2026-01-01') as Response;
    const body = await result.json();
    expect(body.error).toBe('date must be a valid YYYY-MM-DD date');
  });

  it('rejects impossible calendar dates (2026-02-30, 2026-13-01)', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10']) {
      const url = new URL(`http://localhost/api?date=${bad}`);
      const result = queryDate(url, '2026-01-01');
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    }
  });
});
