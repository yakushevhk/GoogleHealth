import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  GhError,
  HTTP_STATUS,
  UpstreamError,
  ValidationError,
  messageOf,
  statusOf,
} from '@lib/errors';

describe('statusOf', () => {
  it('maps ValidationError → 400', () => {
    expect(statusOf(new ValidationError('bad date'))).toBe(400);
  });
  it('maps ConfigError → 502 (upstream auth, not a client fault)', () => {
    expect(statusOf(new ConfigError('no client id'))).toBe(502);
  });
  it('maps UpstreamError → its own status (default 502)', () => {
    expect(statusOf(new UpstreamError('rate limited', 429))).toBe(429);
    expect(statusOf(new UpstreamError('down'))).toBe(502);
  });
  it('maps GhError 401/403/5xx → 502, other GhError → itself', () => {
    expect(statusOf(new GhError('x', 401))).toBe(502);
    expect(statusOf(new GhError('x', 500))).toBe(502);
    expect(statusOf(new GhError('x', 404))).toBe(404);
    expect(statusOf(new GhError('x'))).toBe(502);
  });
  it('maps unknown → 500', () => {
    expect(statusOf(new Error('boom'))).toBe(500);
    expect(statusOf('string')).toBe(500);
  });
});

describe('messageOf', () => {
  it('uses Error.message', () => {
    expect(messageOf(new Error('hello'))).toBe('hello');
  });
  it('falls back for non-Error', () => {
    expect(messageOf({})).toBe('Unexpected error');
    expect(messageOf(undefined)).toBe('Unexpected error');
  });
});

describe('HTTP_STATUS', () => {
  it('has the expected codes', () => {
    expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
    expect(HTTP_STATUS.BAD_GATEWAY).toBe(502);
  });
});
