import type { APIRoute } from 'astro';
import { invalidateReadCache, json, jsonError, readJson } from '@lib/api-utils';
import { ghDelete } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await readJson<{ dataType?: string; dataPointId?: string }>(request);
    const { dataType, dataPointId } = payload;
    if (!dataType || !dataPointId) {
      return json({ error: 'Missing dataType or dataPointId' }, 400);
    }
    if (!isDataType(dataType)) {
      return json({ error: `Unknown data type: ${dataType}` }, 400);
    }
    const res = await ghDelete(dataType, dataPointId);
    invalidateReadCache();
    return json({ success: true, response: res });
  } catch (e) {
    return jsonError(e);
  }
};
