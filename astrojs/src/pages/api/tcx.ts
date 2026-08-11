import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { ghExportTcx, ghList } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

/** Data point ID: digits/letters/dash/underscore (protection from path and header forgery). */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const exerciseId = url.searchParams.get('id');
  const dataType = url.searchParams.get('dataType') || 'exercise';
  if (!isDataType(dataType)) {
    return json({ error: `Unknown data type: ${dataType}` }, 400);
  }

  try {
    // Resolve the data point ID: either provided directly, or fetch the latest exercise
    let dataPointId = exerciseId;
    if (dataPointId && !SAFE_ID.test(dataPointId)) {
      return json({ error: 'id must contain only letters, digits, "-" or "_"' }, 400);
    }
    if (!dataPointId) {
      // No ID provided — list recent exercises and take the first one
      const list = await ghList(dataType, { pageSize: 1 });
      const points = (list as { dataPoints?: Array<{ name?: string }> }).dataPoints;
      if (!points?.length) {
        return json({ error: `No ${dataType} data points found` }, 404);
      }
      // Extract numeric ID from full resource name: users/me/dataTypes/exercise/dataPoints/12345
      const fullName = points[0].name ?? '';
      dataPointId = fullName.split('/').pop() ?? fullName;
    }

    const tcxXml = await ghExportTcx(dataPointId);

    return new Response(tcxXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.garmin.tcx+xml',
        'Content-Disposition': `attachment; filename="exercise_${dataPointId}.tcx"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
};
