/**
 * Export helpers — build normalized tabular rows from the dashboard's series
 * and serialize them to CSV / JSON. Isomorphic, covered by tests.
 *
 * The dashboard data comes in heterogeneous shapes (rollup points, history
 * series, sessions). `toRows()` flattens any of them into a generic
 * `Array<Record<string, unknown>>` keyed by date, which the formatters below
 * turn into a CSV string (RFC-4180-ish: quoted fields, CRLF row separators) or
 * a JSON string.
 */

export interface DatePoint {
  date: string;
  [key: string]: unknown;
}

/** Flatten a list of date-keyed points into stable-column rows. */
export function toRows<T extends Record<string, unknown>>(
  rows: T[],
  opts: { sort?: boolean } = {},
): DatePoint[] {
  const sorted = opts.sort === false ? [...rows] : [...rows].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  return sorted.filter(
    (r) => r !== null && typeof r === 'object' && r !== undefined && 'date' in r,
  ) as unknown as DatePoint[];
}

/** Escape a single CSV field (quotes doubled, RFC-4180), no other transform. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Wrap in quotes if it contains a comma, quote, newline, or CR.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize rows to CSV. Column order = order of the first non-empty row
 * (`date` first), then any keys of later rows appended. Value rendering:
 * numbers/strings plain, objects/arrays compact-JSON.
 */
export function toCsv(rows: DatePoint[]): string {
  if (rows.length === 0) return '';
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  // Ensure a stable date-first column.
  const dateIdx = cols.indexOf('date');
  if (dateIdx > 0) {
    cols.splice(dateIdx, 1);
    cols.unshift('date');
  }
  const cell = (r: DatePoint, col: string): string => {
    const v = r[col];
    if (v !== null && typeof v === 'object') return csvField(JSON.stringify(v));
    return csvField(v);
  };
  const header = cols.map(csvField).join(',');
  const body = rows.map((r) => cols.map((c) => cell(r, c)).join(',')).join('\r\n');
  return header + '\r\n' + body + '\r\n';
}

/** Serialize rows to pretty-printed JSON. */
export function toJson(rows: DatePoint[], pretty = true): string {
  return JSON.stringify(rows, null, pretty ? 2 : 0);
}

/** Suggest a filename-safe stem from a metric type + date (no extension). */
export function exportStem(type: string, date: string): string {
  return `googlehealth-${type}-${date}`;
}

/** Content-Type / disposition for the common export formats. */
export function downloadMeta(format: 'csv' | 'json'): {
  type: string;
  ext: string;
} {
  return format === 'csv'
    ? { type: 'text/csv; charset=utf-8', ext: 'csv' }
    : { type: 'application/json; charset=utf-8', ext: 'json' };
}

/**
 * Trigger a browser download for a text/blob payload (client-side helper).
 * Accepts a Blob-able string and filename; returns true if it could start.
 */
export function triggerDownload(data: string, filename: string, type: string): boolean {
  try {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
