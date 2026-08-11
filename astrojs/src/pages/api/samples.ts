/**
 * GET /api/samples?type=heart-rate-variability&date=YYYY-MM-DD[&days=30]
 * Raw samples for sample types (HRV, SpO2, weight, ...):
 * - without days — single day (civil day filter);
 * - days=7|14|30 — civil_time range (for night/day slices on /trends).
 *
 * sampleTime for these types is nested inside the data field, so time and
 * value are extracted via sampleTimeOf/sampleValue (see extract.ts).
 *
 * For contextual types (blood-glucose, respiratory-rate-sleep-summary)
 * additional fields are returned.
 *
 * Response: { type, date, days, points: [{time, value, ...context}] }
 */
import type { APIRoute } from 'astro';
import { json, jsonError, queryDate } from '@lib/api-utils';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { extractAggregates, kebabToCamel, sampleTimeOf, sampleValue } from '@lib/extract';
import { addDays, buildDayFilter, buildSampleRangeFilter, nextDay, todayLocal } from '@lib/filters';
import { ghListAll } from '@lib/gh-client';
import { SAMPLE_CIVIL_TYPES, SAMPLE_PHYSICAL_TYPES } from '@lib/gh-types';

const SAMPLE_TYPES: readonly string[] = [
  ...SAMPLE_CIVIL_TYPES,
  ...SAMPLE_PHYSICAL_TYPES,
];

const RANGE_DAYS = [7, 14, 30];

/** Types with additional contextual fields */
const CONTEXT_FIELDS: Record<string, string[]> = {
  'blood-glucose': ['specimenSource', 'mealType', 'relationToMeal', 'temporalRelationToSleep'],
  'respiratory-rate-sleep-summary': ['deepSleepStats', 'lightSleepStats', 'remSleepStats', 'fullSleepStats'],
  'oxygen-saturation': ['supplementalOxygenFlowRate'],
  'core-body-temperature': ['measurementLocation'],
  'weight': [], // dataSource is in parent
};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const date = queryDate(url, todayLocal());
  if (date instanceof Response) return date;

  if (!SAMPLE_TYPES.includes(type)) {
    return json({ error: `Type ${type} is not a sample type` }, 400);
  }

  const daysRaw = Number(url.searchParams.get('days') ?? '1');
  const days = RANGE_DAYS.includes(daysRaw) ? daysRaw : 1;
  if (days > 1 && !(SAMPLE_CIVIL_TYPES as readonly string[]).includes(type)) {
    return json({ error: `Range days is not supported for ${type}` }, 400);
  }

  try {
    const data = await apiCache.orFetch(`${CACHE_PREFIXES.samples}${type}:${date}:${days}`, async () => {
      const filter =
        days === 1
          ? buildDayFilter(type, date)
          : buildSampleRangeFilter(type, addDays(date, -(days - 1)), nextDay(date));
      const allPoints = await ghListAll(type, filter, 1000);
      const field = kebabToCamel(type);
      const contextKeys = CONTEXT_FIELDS[type] ?? [];

      const points = allPoints
        .map((p) => {
          const f = p[field];
          const agg = extractAggregates(
            f && typeof f === 'object'
              ? Object.fromEntries(
                  Object.entries(f as Record<string, unknown>).filter(
                    ([k]) => k !== 'sampleTime',
                  ),
                )
              : f,
          );
          const base: Record<string, unknown> = {
            time: sampleTimeOf(f),
            value: agg.avg ?? sampleValue(f),
          };
          // Add contextual fields
          if (f && typeof f === 'object') {
            for (const key of contextKeys) {
              const val = (f as Record<string, unknown>)[key];
              if (val !== undefined) base[key] = val;
            }
          }
          // Add dataSource for all types
          if (p.dataSource) base.dataSource = p.dataSource;
          return base;
        })
        .filter((p) => p.time && p.value !== undefined)
        .sort((a, b) => (a.time as string).localeCompare(b.time as string));
      return { points };
    });
    return json({ type, date, days, ...data });
  } catch (e) {
    return jsonError(e);
  }
};
