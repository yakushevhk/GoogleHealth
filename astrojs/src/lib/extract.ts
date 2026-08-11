/**
 * Normalization of "raw" Google Health API values into numeric series.
 *
 * Aggregation fields are heterogeneous: steps -> {countSum: "975"} (string!),
 * heartRate -> {beatsPerMinuteAvg, beatsPerMinuteMin, beatsPerMinuteMax},
 * dailyRestingHeartRate -> {beatsPerMinute: "62"}, etc.
 * Everything here is reduced to {sum?, avg?, min?, max?} of numbers.
 */

export interface NumericAggregate {
  sum?: number;
  avg?: number;
  min?: number;
  max?: number;
  /** Per-zone breakdown: {FAT_BURN: 4, CARDIO: 0, PEAK: 0} */
  zones?: Record<string, number>;
  /** RollupBy array: {LIGHT: 24, MODERATE: 8, VIGOROUS: 3} */
  rollupBy?: Record<string, number>;
}

export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** kebab-case to camelCase: heart-rate -> heartRate (field name in rollup response). */
export function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** First numeric value in an object (recursive search). */
export function firstNumber(obj: unknown): number | undefined {
  const n = toNumber(obj);
  if (n !== undefined) return n;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const r = firstNumber(v);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

/**
 * Extract sum/avg/min/max from an aggregation field.
 *
 * Rules:
 * - keys `*Sum` -> sum, `*Avg` -> avg, `*Min` -> min, `*Max` -> max;
 * - `sumIn*Zone` (activeZoneMinutes) -> zones: {FAT_BURN: N, CARDIO: N, ...};
 * - rollup-by-level arrays (activeMinutesRollupByActivityLevel,
 *   timeInHeartRateZoneRollupByHeartRateZone, ...) preserve per-item
 *   structure: {LIGHT: N, MODERATE: N, ...};
 * - a single numeric value (beatsPerMinute, percentage, ...) -> avg.
 */
export function extractAggregates(obj: unknown): NumericAggregate {
  const out: NumericAggregate = {};
  if (obj === null || obj === undefined) return out;

  const n = toNumber(obj);
  if (n !== undefined) return { avg: n };
  if (typeof obj !== 'object') return out;

  if (Array.isArray(obj)) {
    const sum = sumNumericLeaves(obj);
    if (sum !== undefined) out.sum = sum;
    return out;
  }

  // Candidates for avg when there is no explicit *Avg key. JSON key order is
  // not guaranteed, so "first numeric value" is used only as a last resort:
  // otherwise adding/reordering fields (count, entropy, ...) would silently
  // show the wrong metric on the dashboard.
  let avgFromAverage: number | undefined; // keys containing "Average" (averageHeartRateVariabilityMilliseconds)
  let avgFromMetric: number | undefined; // recognizable metrics (BeatsPerMinute, Milliseconds, Percent)
  let avgFirstNumeric: number | undefined; // first numeric value in traversal order

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const num = toNumber(value);
    if (num !== undefined) {
      if (/Sum$/.test(key)) out.sum = num;
      else if (/Avg$/.test(key)) out.avg = num;
      else if (/Min$/.test(key)) out.min = num;
      else if (/Max$/.test(key)) out.max = num;
      // sumIn*Zone (activeZoneMinutes: sumInFatBurnHeartZone, ...)
      else if (/^sumIn/.test(key) && /Zone$/.test(key)) {
        if (!out.zones) out.zones = {};
        // sumInFatBurnHeartZone → FAT_BURN
        const zoneKey = key
          .replace(/^sumIn/, '')
          .replace(/HeartZone$/, '')
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .toUpperCase();
        out.zones[zoneKey] = num;
      } else {
        avgFirstNumeric ??= num;
        if (/Average/i.test(key)) avgFromAverage ??= num;
        else if (/BeatsPerMinute|Milliseconds|PerMinute|Percent/i.test(key)) avgFromMetric ??= num;
      }
      continue;
    }
    // RollupBy arrays: preserve per-item structure instead of collapsing
    if (Array.isArray(value) && /RollupBy/.test(key)) {
      out.rollupBy = extractRollupByArray(value);
      continue;
    }
  }
  if (out.avg === undefined) {
    out.avg = avgFromAverage ?? avgFromMetric ?? avgFirstNumeric;
  }
  return out;
}

/**
 * Specialized extraction for time-in-heart-rate-zone / calories-in-heart-rate-zone.
 * API returns: { timeInHeartRateZones: [{heartRateZone: "LIGHT", duration: "43980s"}, ...] }
 * or: { caloriesInHeartRateZones: [{heartRateZone: "LIGHT", kcal: 1240.7}, ...] }
 */
export function extractZoneArray(obj: unknown): Record<string, number> {
  const zones: Record<string, number> = {};
  if (!obj || typeof obj !== 'object') return zones;
  // Find the zones array (timeInHeartRateZones or caloriesInHeartRateZones)
  const arr = Object.values(obj as Record<string, unknown>).find((v) =>
    Array.isArray(v),
  ) as unknown[] | undefined;
  if (!arr) return zones;
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const zone = (rec.heartRateZone as string) ?? (rec.zone as string);
    if (!zone) continue;
    // Try duration string first ("43980s" → minutes), then numeric
    if (typeof rec.duration === 'string') {
      const sec = durationSeconds(rec.duration);
      if (sec !== null) zones[zone] = Math.round(sec / 60);
    } else {
      const val = firstNumber(
        Object.fromEntries(
          Object.entries(rec).filter(([k]) => k !== 'heartRateZone' && k !== 'zone'),
        ),
      );
      if (val !== undefined) zones[zone] = val;
    }
  }
  return zones;
}

/**
 * Extract per-item structure from a RollupBy array.
 * activeMinutesRollupByActivityLevel: [{activityLevel: "LIGHT", activeMinutesSum: "24"}, ...]
 * -> {LIGHT: 24, MODERATE: 8, VIGOROUS: 3}
 */
function extractRollupByArray(arr: unknown[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    // Find the label key (activityLevel, heartRateZone, etc.)
    const labelKey = Object.keys(rec).find(
      (k) => typeof rec[k] === 'string' && k !== 'type' && !/Sum$|Avg$|Min$|Max$/i.test(k),
    );
    if (!labelKey) continue;
    const label = rec[labelKey] as string;
    // Find the numeric value; some rollupBy entries store duration as a string
    // ("3600s") — firstNumber won't pick it up, so we convert to minutes
    // manually (same as extractZoneArray for HR zones).
    const rest = Object.fromEntries(Object.entries(rec).filter(([k]) => k !== labelKey));
    let val = firstNumber(rest);
    if (val === undefined) {
      for (const v of Object.values(rest)) {
        if (typeof v !== 'string') continue;
        const sec = durationSeconds(v);
        if (sec !== null) {
          val = Math.round(sec / 60);
          break;
        }
      }
    }
    if (val !== undefined && label) result[label] = val;
  }
  return result;
}

function sumNumericLeaves(arr: unknown[]): number | undefined {
  let total = 0;
  let found = false;
  const walk = (v: unknown): void => {
    const n = toNumber(v);
    if (n !== undefined) {
      total += n;
      found = true;
      return;
    }
    if (v && typeof v === 'object') {
      for (const inner of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
        walk(inner);
      }
    }
  };
  for (const item of arr) walk(item);
  return found ? total : undefined;
}

/**
 * Heart rate zones from timeInHeartRateZone / caloriesInHeartRateZone:
 * {OUT_OF_ZONE?, FAT_BURN|LIGHT, CARDIO|MODERATE, PEAK|VIGOROUS} -> numbers.
 * Values are numbers OR duration strings ("22920s" -> minutes).
 *
 * Delegates to extractZoneArray — shared logic, no duplication.
 */
export function extractZones(obj: unknown): Record<string, number> {
  return extractZoneArray(obj);
}

/**
 * Normalize the HR zone name to the canonical rollUp set
 * (OUT_OF_ZONE / FAT_BURN / CARDIO / PEAK).
 *
 * The real API (Fitbit) in time-in-heart-rate-zone / daily-heart-rate-zones
 * sends LIGHT / MODERATE / VIGOROUS / PEAK — a different set of names. Without
 * this normalization the /zones page rendered an empty "Today" card.
 */
const ZONE_CANON: Record<string, string> = {
  LIGHT: 'FAT_BURN',
  MODERATE: 'CARDIO',
  VIGOROUS: 'PEAK',
  FAT_BURN: 'FAT_BURN',
  CARDIO: 'CARDIO',
  PEAK: 'PEAK',
  OUT_OF_ZONE: 'OUT_OF_ZONE',
};

export function canonicalZone(z: string): string {
  return ZONE_CANON[z] ?? z;
}

/** Canonicalize zone object keys, collapsing collisions by sum. */
export function canonicalizeZones(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) {
    const c = canonicalZone(k);
    out[c] = (out[c] ?? 0) + v;
  }
  return out;
}

/**
 * Scalar total of an aggregate: prefer sum, otherwise sum of rollupBy/zones
 * values. Covers active-minutes (rollupBy only) and active-zone-minutes
 * (zones only) where there is no scalar *Sum.
 */
export function totalOf(a: NumericAggregate): number | null {
  if (a.sum !== undefined) return a.sum;
  const bag = a.rollupBy ?? a.zones;
  if (!bag) return null;
  const vals = Object.values(bag);
  return vals.length ? vals.reduce((x, y) => x + y, 0) : null;
}

/**
 * Date from a data point / rollup point. Supported forms:
 * - civilStartTime: {date: {year, month, day}} (dailyRollUp);
 * - date: {year, month, day} (daily types);
 * - civilStartTime / startTime: "2026-07-22T00:00:00Z" (rollUp).
 */
export function pointDate(p: Record<string, unknown>): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  const fromCivil = (v: unknown): string => {
    const d = (v as { date?: { year?: number; month?: number; day?: number } })?.date;
    return d?.year && d?.month && d?.day
      ? `${d.year}-${pad(d.month)}-${pad(d.day)}`
      : '';
  };

  const civil = p.civilStartTime;
  if (civil && typeof civil === 'object') {
    const r = fromCivil(civil);
    if (r) return r;
  }
  if (typeof civil === 'string') return civil.slice(0, 10);

  const d = p.date as { year?: number; month?: number; day?: number } | undefined;
  if (d?.year && d?.month && d?.day) {
    return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
  }
  const t = p.startTime as string | undefined;
  return typeof t === 'string' ? t.slice(0, 10) : '';
}

/** RFC3339/duration: "1945s" -> seconds. */
export function durationSeconds(d: string | null | undefined): number | null {
  if (!d) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
  return m ? Math.round(Number(m[1])) : null;
}

/**
 * Raw sample value (HRV, SpO2, ...): first numeric value in the data field
 * AFTER discarding the sampleTime key — otherwise firstNumber returns the year
 * from the nested civilTime date.
 */
export function sampleValue(field: unknown): number | undefined {
  const n = toNumber(field);
  if (n !== undefined) return n;
  if (!field || typeof field !== 'object' || Array.isArray(field)) return undefined;
  const rest = Object.fromEntries(
    Object.entries(field as Record<string, unknown>).filter(([k]) => k !== 'sampleTime'),
  );
  return firstNumber(rest);
}

/** Raw sample time: field.sampleTime.physicalTime (RFC3339). */
export function sampleTimeOf(field: unknown): string {
  if (!field || typeof field !== 'object') return '';
  const st = (field as Record<string, unknown>).sampleTime as
    | Record<string, unknown>
    | undefined;
  return (st?.physicalTime as string) ?? '';
}

/**
 * Civil date/time from a UTC moment with an offset like "3600s"
 * (startUtcOffset/endUtcOffset fields in sleep and exercise records).
 */
export function civilFromUtc(
  iso: string | null | undefined,
  offsetStr?: string | null,
): { date: string; time: string; hours: number } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const m = /^(-?\d+)s$/.exec(offsetStr ?? '');
  const d = new Date(t + (m ? Number(m[1]) * 1000 : 0));
  const pad = (x: number) => String(x).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    hours: d.getUTCHours() + d.getUTCMinutes() / 60,
  };
}
