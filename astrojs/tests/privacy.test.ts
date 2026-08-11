import { describe, expect, it } from 'vitest';
import {
  hasGoogleUserId,
  looksLikeCredential,
  redact,
  redactGoogleUserId,
  stripCredentials,
} from '@lib/privacy';

describe('redact', () => {
  it('redacts well-known credential patterns', () => {
    const s = 'client_id=abc client_secret="xyz" refresh_token=1//tok apikey=z';
    const out = redact(s);
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('1//tok');
    expect(out).not.toContain('apikey=z');
    expect(out).toContain('[REDACTED]');
  });

  it('keeps plain text intact', () => {
    const s = 'just a summary error';
    expect(redact(s)).toBe(s);
  });
});

describe('looksLikeCredential', () => {
  it('detects refresh/access token and client secret text', () => {
    expect(looksLikeCredential('refresh_token invalid')).toBe(true);
    expect(looksLikeCredential('access token revoked')).toBe(true);
    expect(looksLikeCredential('client_secret is empty')).toBe(true);
    expect(looksLikeCredential('client_id wrong client')).toBe(true);
  });
  it('does not flag ordinary messages', () => {
    expect(looksLikeCredential('no heart rate data')).toBe(false);
    expect(looksLikeCredential('HTTP 404')).toBe(false);
  });
});

describe('stripCredentials', () => {
  it('removes credential keys recursively', () => {
    const obj = {
      name: 'ok',
      refresh_token: 'secret',
      nested: { accessToken: 'x', api_key: 'y', keep: 1 },
    };
    const out = stripCredentials(obj);
    const nested = out.nested as Record<string, unknown>;
    expect(out.name).toBe('ok');
    expect(out).not.toHaveProperty('refresh_token');
    expect(nested).not.toHaveProperty('accessToken');
    expect(nested).not.toHaveProperty('api_key');
    expect(nested.keep).toBe(1);
  });

  it('recurses into objects nested inside arrays', () => {
    const obj = {
      list: [{ refresh_token: 'x', safe: 1 }, { api_key: 'y' }],
    };
    const out = stripCredentials(obj);
    const list = out.list as Record<string, unknown>[];
    expect(list[0].safe).toBe(1);
    expect(list[0]).not.toHaveProperty('refresh_token');
    expect(list[1]).not.toHaveProperty('api_key');
  });
});

describe('google user id', () => {
  it('detects a numeric user id in a resource name', () => {
    expect(hasGoogleUserId('users/123456789/dataTypes/steps/dataPoints/1')).toBe(true);
    expect(hasGoogleUserId('users/me/dataTypes/x')).toBe(false);
  });
  it('redacts numeric id, keeps the me alias', () => {
    expect(redactGoogleUserId('users/123456789/foo')).toBe('users/{user}/foo');
    expect(redactGoogleUserId('users/me/foo')).toBe('users/me/foo');
  });
});
