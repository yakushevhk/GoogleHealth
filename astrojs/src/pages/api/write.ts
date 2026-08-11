import type { APIRoute } from 'astro';
import { invalidateReadCache, json, jsonError, readJson } from '@lib/api-utils';
import { ghCreate } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

/** Valid RFC3339 date (client sends the result of toISOString). */
const validIso = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && !Number.isNaN(new Date(v).getTime());

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await readJson<{
      action?: string;
      dataType?: string;
      body?: unknown;
      weightKg?: unknown;
      startTime?: string;
      endTime?: string;
      exerciseType?: string;
      mealType?: string;
      timestamp?: string;
      utcOffset?: string;
    }>(request);
    const { action, dataType, body, weightKg, startTime, endTime, exerciseType, mealType, timestamp, utcOffset } = payload;

    const offset = utcOffset || '0s';

    if (action === 'raw_create') {
      if (!dataType || !body) {
        return json({ error: 'Missing dataType or body' }, 400);
      }
      if (!isDataType(dataType)) {
        return json({ error: `Unknown data type: ${dataType}` }, 400);
      }
      const res = await ghCreate(dataType, body);
      invalidateReadCache();
      return json({ success: true, response: res });
    }

    if (action === 'add_weight') {
      if (!weightKg) return json({ error: 'Missing weightKg' }, 400);
      const kg = Number(weightKg);
      if (!Number.isFinite(kg) || kg <= 0 || kg > 500) {
        return json({ error: 'weightKg must be a number between 0 and 500' }, 400);
      }
      if (timestamp !== undefined && !validIso(timestamp)) {
        return json({ error: 'timestamp must be a valid date' }, 400);
      }
      const time = timestamp || new Date().toISOString();
      const createBody = {
        weight: {
          sampleTime: { physicalTime: time, utcOffset: offset },
          weightGrams: Math.round(kg * 1000)
        }
      };
      const res = await ghCreate('weight', createBody);
      invalidateReadCache();
      return json({ success: true, response: res });
    }

    if (action === 'add_hydration') {
      if (startTime !== undefined && startTime !== '' && !validIso(startTime)) {
        return json({ error: 'startTime must be a valid date' }, 400);
      }
      if (endTime !== undefined && endTime !== '' && !validIso(endTime)) {
        return json({ error: 'endTime must be a valid date' }, 400);
      }
      const start = startTime || new Date().toISOString();
      let end = endTime || start;
      if (start === end) {
        end = new Date(new Date(start).getTime() + 300000).toISOString();
      }
      if (new Date(start) >= new Date(end)) {
        return json({ error: 'endTime must be after startTime' }, 400);
      }
      const createBody = {
        hydrationLog: {
          interval: { startTime: start, startUtcOffset: offset, endTime: end, endUtcOffset: offset }
        }
      };
      const res = await ghCreate('hydration-log', createBody);
      invalidateReadCache();
      return json({ success: true, response: res, note: 'Google Health API v4 does not store volume — only the hydration event time is recorded.' });
    }

    if (action === 'add_sleep') {
      if (!startTime || !endTime) return json({ error: 'Missing startTime or endTime' }, 400);
      if (!validIso(startTime) || !validIso(endTime)) {
        return json({ error: 'startTime/endTime must be valid dates' }, 400);
      }
      if (new Date(startTime) >= new Date(endTime)) {
        return json({ error: 'endTime must be after startTime' }, 400);
      }
      // Note: the API rejects a `title` field on sleep — intentionally not sent.
      const sleepObj: Record<string, unknown> = {
        interval: { startTime, startUtcOffset: offset, endTime, endUtcOffset: offset }
      };
      const res = await ghCreate('sleep', { sleep: sleepObj });
      invalidateReadCache();
      return json({ success: true, response: res });
    }

    if (action === 'add_exercise') {
      if (!exerciseType || !startTime || !endTime) return json({ error: 'Missing exerciseType, startTime or endTime' }, 400);
      if (!validIso(startTime) || !validIso(endTime)) {
        return json({ error: 'startTime/endTime must be valid dates' }, 400);
      }
      if (new Date(startTime) >= new Date(endTime)) {
        return json({ error: 'endTime must be after startTime' }, 400);
      }
      // Note: the API rejects a `title` field on exercise — intentionally not sent.
      const exerciseObj: Record<string, unknown> = {
        exerciseType: String(exerciseType).toUpperCase(),
        interval: { startTime, startUtcOffset: offset, endTime, endUtcOffset: offset }
      };
      const res = await ghCreate('exercise', { exercise: exerciseObj });
      invalidateReadCache();
      return json({ success: true, response: res });
    }

    if (action === 'add_nutrition') {
      const validMeals = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
      // String(): a non-string mealType (number/object) must not cause a 500 error.
      const meal = String(mealType || '').toUpperCase();
      if (!validMeals.includes(meal)) {
        return json({ error: 'mealType must be BREAKFAST, LUNCH, DINNER, or SNACK' }, 400);
      }
      if (startTime !== undefined && startTime !== '' && !validIso(startTime)) {
        return json({ error: 'startTime must be a valid date' }, 400);
      }
      if (endTime !== undefined && endTime !== '' && !validIso(endTime)) {
        return json({ error: 'endTime must be a valid date' }, 400);
      }
      const start = startTime || new Date().toISOString();
      let end = endTime || start;
      if (start === end) {
        end = new Date(new Date(start).getTime() + 300000).toISOString();
      }
      if (new Date(start) >= new Date(end)) {
        return json({ error: 'endTime must be after startTime' }, 400);
      }
      const createBody = {
        nutritionLog: {
          interval: { startTime: start, startUtcOffset: offset, endTime: end, endUtcOffset: offset },
          mealType: meal
        }
      };
      const res = await ghCreate('nutrition-log', createBody);
      invalidateReadCache();
      return json({ success: true, response: res });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return jsonError(e);
  }
};
