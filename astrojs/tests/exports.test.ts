import { describe, expect, it } from 'vitest';
import {
  csvField,
  downloadMeta,
  exportStem,
  toCsv,
  toJson,
  toRows,
} from '@lib/exports';

describe('csvField', () => {
  it('renders null/undefined as empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
  it('passes through plain values', () => {
    expect(csvField('abc')).toBe('abc');
    expect(csvField(42)).toBe('42');
  });
  it('quotes fields with comma, quote, newline, CR', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('he "said"')).toBe('"he ""said"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
  });
});

describe('toCsv', () => {
  it('produces a header + rows with date first', () => {
    const csv = toCsv([
      { date: '2026-08-01', steps: 100 },
      { date: '2026-08-02', steps: 150 },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('date,steps');
    expect(lines[1]).toBe('2026-08-01,100');
    expect(lines[2]).toBe('2026-08-02,150');
  });
  it('returns empty for empty rows', () => {
    expect(toCsv([])).toBe('');
  });
  it('appends late columns and JSON-encodes object cells', () => {
    const csv = toCsv([
      { date: 'd1', zones: { LIGHT: 1, DEEP: 2 } },
      { date: 'd2', zones: { REM: 3 }, extra: 'x' },
    ]);
    // Object cells are JSON-encoded, then CSV-quoted with doubled quotes (RFC-4180).
    expect(csv).toContain('"{""LIGHT"":1,""DEEP"":2}"');
    // second row shows the late "extra" column
    expect(csv).toContain('d2,"{""REM"":3}",x');
  });
});

describe('toRows / toJson / helpers', () => {
  it('sorts by date by default and filters non-objects', () => {
    const rows = toRows([
      { date: 'b' },
      { date: 'a' },
    ] as { date: string; [k: string]: unknown }[]);
    expect(rows.map((r) => r.date)).toEqual(['a', 'b']);
  });
  it('pretty-prints JSON', () => {
    expect(toJson([{ date: 'd' }])).toContain('\n');
    expect(JSON.parse(toJson([{ date: 'd' }]))).toEqual([{ date: 'd' }]);
  });
  it('exportStem and downloadMeta', () => {
    expect(exportStem('steps', '2026-08-01')).toBe('googlehealth-steps-2026-08-01');
    expect(downloadMeta('csv').ext).toBe('csv');
    expect(downloadMeta('json').type).toContain('application/json');
  });
});
