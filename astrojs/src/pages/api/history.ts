/**
 * GET /api/history?type=steps&days=30&date=YYYY-MM-DD
 * Daily aggregations for N days (7|30|90).
 *
 * - rollup types -> dailyRollUp (14-day limit for heart-rate, active-minutes,
 *   total-calories, calories-in-heart-rate-zone — clamped automatically);
 * - daily-* types -> list with a date range filter.
 *
 * Response: { type, days, points: [{date, sum?, avg?, min?, max?}] }
 */
import type { APIRoute } from 'astro';
import { json, jsonError, queryDate } from '@lib/api-utils';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import {
  civilFromUtc,
  extractAggregates,
  extractZoneArray,
  kebabToCamel,
  pointDate,
  toNumber,
} from '@lib/extract';
import { addDays, buildRangeFilter, nextDay, todayLocal } from '@lib/filters';
import { ghDailyRollUp, ghListAll } from '@lib/gh-client';
import {
  DAILY_TYPES,
  ROLLUP_14DAY_TYPES,
  ROLLUP_TYPES,
} from '@lib/gh-types';

const ALLOWED_DAYS = [7, 30, 90];

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const daysRaw = Number(url.searchParams.get('days') ?? '30');
  const date = queryDate(url, todayLocal());
  if (date instanceof Response) return date;

  const days = ALLOWED_DAYS.includes(daysRaw) ? daysRaw : 30;

  try {
    if (ROLLUP_TYPES.includes(type)) {
      // API limit: 14 days for some types
      const effDays = ROLLUP_14DAY_TYPES.includes(type)
        ? Math.min(days, 14)
        : days;
      const start = addDays(date, -(effDays - 1));
      const end = nextDay(date);
      const points = await apiCache.orFetch(
        `${CACHE_PREFIXES.history}${type}:${start}:${end}`,
        async () => {
          const resp = await ghDailyRollUp(type, {
            startDate: start,
            endDate: end,
            windowSizeDays: 1,
          });
          const field = kebabToCamel(type);
          // Zone types: preserve per-zone structure
          const ZONE_TYPES = ['time-in-heart-rate-zone', 'calories-in-heart-rate-zone'];
          return (resp.rollupDataPoints ?? [])
            .map((p) => {
              const base = { date: pointDate(p as Record<string, unknown>) };
              if (ZONE_TYPES.includes(type)) {
                return { ...base, zones: extractZoneArray(p[field]) };
              }
              return { ...base, ...extractAggregates(p[field]) };
            })
            .filter((p) => p.date);
        },
      );
      return json({ type, days: effDays, points });
    }

    if ((DAILY_TYPES as readonly string[]).includes(type)) {
      const start = addDays(date, -(days - 1));
      const end = nextDay(date);
      const points = await apiCache.orFetch(
        `${CACHE_PREFIXES.history}${type}:${start}:${end}`,
        async () => {
          const allPoints = await ghListAll(type, buildRangeFilter(type, start, end), 1000);
          const field = kebabToCamel(type);
          return allPoints
            .map((p) => {
              const fieldObj = p[field] as Record<string, unknown> | undefined;
              return {
                // date may be at the top level OR inside the data field
                // (daily_heart_rate_zones.date etc.)
                date: pointDate(p) || pointDate(fieldObj ?? {}),
                ...extractAggregates(fieldObj),
              };
            })
            .filter((p) => p.date)
            .sort((a, b) => a.date.localeCompare(b.date));
        },
      );
      return json({ type, days, points });
    }

    // ── Session types: normalized sleep/exercise sessions ──
    if (type === 'sleep' || type === 'exercise') {
      const start = addDays(date, -(days - 1));
      const end = nextDay(date);
      const sessions = await apiCache.orFetch(
        `${CACHE_PREFIXES.history}${type}:${start}:${end}`,
        async () => {
          // API cap for session types (sleep/exercise) is 25 per page
          const allPoints = await ghListAll(type, buildRangeFilter(type, start, end), 25);
          if (type === 'sleep') {
            return allPoints
              .map((p) => {
                const s = (p.sleep ?? {}) as Record<string, unknown>;
                const iv = (s.interval ?? {}) as Record<string, unknown>;
                const summary = (s.summary ?? {}) as Record<string, unknown>;
                const st = civilFromUtc(iv.startTime as string, iv.startUtcOffset as string);
                const en = civilFromUtc(iv.endTime as string, iv.endUtcOffset as string);
                const sec =
                  iv.startTime && iv.endTime
                    ? Math.round(
                        (new Date(iv.endTime as string).getTime() -
                          new Date(iv.startTime as string).getTime()) /
                          1000,
                      )
                    : null;
                return {
                  date: en?.date ?? '',
                  start: (iv.startTime as string) ?? null,
                  end: (iv.endTime as string) ?? null,
                  startUtcOffset: (iv.startUtcOffset as string) ?? null,
                  endUtcOffset: (iv.endUtcOffset as string) ?? null,
                  /** local bedtime HH:MM */
                  bedTime: st?.time ?? null,
                  /** bedtime as fractional hours (for charting) */
                  bedHours: st ? (st.hours < 12 ? st.hours + 24 : st.hours) : null,
                  seconds: sec,
                  type: (s.type as string) ?? null,
                  asleepMinutes: toNumber(summary.minutesAsleep) ?? null,
                  awakeMinutes: toNumber(summary.minutesAwake) ?? null,
                  minutesAfterWakeUp: toNumber(summary.minutesAfterWakeUp) ?? null,
                  minutesInSleepPeriod: toNumber(summary.minutesInSleepPeriod) ?? null,
                  minutesToFallAsleep: toNumber(summary.minutesToFallAsleep) ?? null,
                  stagesSummary: summary.stagesSummary ?? null,
                  hasStages: Array.isArray(s.stages) && (s.stages as unknown[]).length > 0,
                  stages: s.stages ?? null,
                  metadata: s.metadata ?? null,
                };
              })
              .filter((s) => s.date)
              .sort((a, b) => a.date.localeCompare(b.date));
          }
          return allPoints
            .map((p) => {
              const e = (p.exercise ?? {}) as Record<string, unknown>;
              const iv = (e.interval ?? {}) as Record<string, unknown>;
              const st = civilFromUtc(iv.startTime as string, iv.startUtcOffset as string);
              const sec =
                iv.startTime && iv.endTime
                  ? Math.round(
                      (new Date(iv.endTime as string).getTime() -
                        new Date(iv.startTime as string).getTime()) /
                        1000,
                    )
                  : null;
              return {
                date: st?.date ?? '',
                start: (iv.startTime as string) ?? null,
                end: (iv.endTime as string) ?? null,
                startUtcOffset: (iv.startUtcOffset as string) ?? null,
                endUtcOffset: (iv.endUtcOffset as string) ?? null,
                seconds: sec,
                activeDuration: (e.activeDuration as string) ?? null,
                type: (e.exerciseType as string) ?? null,
                name: (e.displayName as string) ?? (e.title as string) ?? null,
                metrics: e.metricsSummary ?? null,
                metadata: e.exerciseMetadata ?? null,
                dataSource: p.dataSource ?? null,
              };
            })
            .filter((s) => s.date)
            .sort((a, b) => a.date.localeCompare(b.date));
        },
      );
      return json({ type, days, sessions });
    }

    return json(
      { error: `Type ${type} does not support history (needs rollup or daily type)` },
      400,
    );
  } catch (e) {
    return jsonError(e);
  }
};
