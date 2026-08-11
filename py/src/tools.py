"""All 35 MCP tool handlers — full parity with Rust tools.rs."""

import asyncio
import json
import math
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

from .auth import AuthState, BASE
from .types import DATA_TYPES, find_type, categories

Q = chr(34)  # double quote for filter strings

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _num(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def _round1(f: float) -> float:
    return round(f, 1)


def _round2(f: float) -> float:
    return round(f, 2)


def _simplify_point(obj: dict):
    obj.pop("dataSource", None)
    obj.pop("createTime", None)
    obj.pop("updateTime", None)
    for k in list(obj.keys()):
        if isinstance(obj[k], dict) and len(obj[k]) == 0:
            del obj[k]


def _simplify(v: dict):
    for key in ("dataPoints", "rollupDataPoints"):
        if key in v and isinstance(v[key], list):
            for pt in v[key]:
                if isinstance(pt, dict):
                    _simplify_point(pt)
            return
    _simplify_point(v)


def _pagination_hint(v: dict):
    if "nextPageToken" in v:
        v["_hint"] = "More data available. Pass nextPageToken to fetch the next page."


def _build_filter(data_type: str, since: str, until: str | None = None) -> str:
    snake = data_type.replace("-", "_")
    civil = lambda s: s[:10]

    if data_type == "sleep":
        f = f'sleep.interval.end_time >= "{since}"'
    elif data_type in ("exercise", "hydration-log", "nutrition-log", "irregular-rhythm-notification"):
        f = f'{snake}.interval.civil_start_time >= "{civil(since)}"'
    elif data_type.startswith("daily-"):
        f = f'{snake}.date >= "{civil(since)}"'
    elif data_type in ("heart-rate", "weight", "height", "body-fat", "blood-glucose", "core-body-temperature", "heart-rate-variability", "oxygen-saturation", "respiratory-rate-sleep-summary", "vo2-max", "run-vo2-max"):
        f = f'{snake}.sample_time.physical_time >= "{since}"'
    elif data_type == "electrocardiogram":
        f = f'electrocardiogram.interval.start_time >= "{since}"'
    else:
        f = f'{snake}.interval.start_time >= "{since}"'

    if until:
        if data_type == "sleep":
            f += f' AND sleep.interval.end_time < "{until}"'
        elif data_type in ("exercise", "hydration-log", "nutrition-log", "irregular-rhythm-notification"):
            f += f' AND {snake}.interval.civil_start_time < "{civil(until)}"'
        elif data_type.startswith("daily-"):
            f += f' AND {snake}.date < "{civil(until)}"'
        elif data_type in ("heart-rate", "weight", "height", "body-fat", "blood-glucose", "core-body-temperature", "heart-rate-variability", "oxygen-saturation", "respiratory-rate-sleep-summary", "vo2-max", "run-vo2-max"):
            f += f' AND {snake}.sample_time.physical_time < "{until}"'
        elif data_type != "electrocardiogram":
            f += f' AND {snake}.interval.start_time < "{until}"'
    return f


def _date_obj(d: date) -> dict:
    return {"year": d.year, "month": d.month, "day": d.day}


def _parse_date(s: str) -> date:
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise ValueError(f"Invalid date '{s}': expected YYYY-MM-DD (e.g. 2026-07-25)")


def _date_obj_to_str(d: dict | None) -> str:
    if not d:
        return ""
    return f"{int(d.get('year', 0)):04d}-{int(d.get('month', 0)):02d}-{int(d.get('day', 0)):02d}"


def _snake_to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _json_pointer(obj, path: str):
    current = obj
    for part in path.split("/"):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


# ─── Tool implementations ─────────────────────────────────────────────────────


async def list_data_types(auth: AuthState, args: dict) -> dict:
    cat = (args.get("category") or "").strip().lower()
    matches = [t for t in DATA_TYPES if not cat or t.category == cat]
    if cat and not matches:
        return {"error": f"Unknown category '{cat}'. Valid: {', '.join(categories())}"}
    return {"count": len(matches), "total": len(DATA_TYPES), "categories": categories(),
            "data_types": [{"id": t.id, "filter_name": t.filter_name, "category": t.category, "listable": t.listable, "rollup": t.rollup, "daily_rollup": t.daily_rollup, "writable": t.writable, "reconcilable": t.reconcilable, "time_field": t.time_field, "page_cap": t.page_cap, "rollup_range_days": t.rollup_range_days, "description": t.description, "key_fields": list(t.key_fields), "gotchas": list(t.gotchas)} for t in matches]}


async def describe_data_type(auth: AuthState, args: dict) -> dict:
    info = find_type((args.get("data_type") or "").strip())
    if not info:
        return {"error": f"Unknown data type '{args.get('data_type')}'. Use list_data_types to see all 39 valid kebab-case IDs."}
    suffixes = {"interval_start": "interval.start_time", "interval_civil_start": "interval.civil_start_time", "interval_end": "interval.end_time", "sample_physical": "sample_time.physical_time", "sample_civil": "sample_time.civil_time", "daily": "date"}
    labels = {"interval_start": "interval.start_time (RFC3339)", "interval_civil_start": "interval.civil_start_time (date)", "interval_end": "interval.end_time / civil_end_time", "sample_physical": "sample_time.physical_time (RFC3339)", "sample_civil": "sample_time.civil_time (date)", "daily": "date (YYYY-MM-DD)", "none": "none (no time filter)"}
    suffix = suffixes.get(info.time_field)
    filter_field = f"{info.filter_name}.{suffix}" if suffix else None
    sample = "2026-07-01" if info.time_field in ("daily", "interval_civil_start") else "2026-07-01T00:00:00Z"
    return {"id": info.id, "filter_name": info.filter_name, "category": info.category, "listable": info.listable, "rollup": info.rollup, "daily_rollup": info.daily_rollup, "writable": info.writable, "time_field": info.time_field, "page_cap": info.page_cap, "rollup_range_days": info.rollup_range_days, "description": info.description, "key_fields": list(info.key_fields), "gotchas": list(info.gotchas), "time_field_label": labels.get(info.time_field, info.time_field), "filter_field": filter_field, "filter_example": f'{filter_field} >= "{sample}"' if filter_field else None}


async def list_data_points(auth: AuthState, args: dict) -> dict:
    dt = args["data_type"]
    url = f"{BASE}/dataTypes/{dt}/dataPoints"
    params = []
    f = args.get("filter") or ""
    if not f and args.get("start_time"):
        f = _build_filter(dt, args["start_time"], args.get("end_time"))
    if f:
        params.append(f"filter={quote(f)}")
    if args.get("page_size"):
        params.append(f"pageSize={int(args['page_size'])}")
    if args.get("page_token"):
        params.append(f"pageToken={quote(args['page_token'])}")
    if params:
        url += "?" + "&".join(params)
    v = await auth.api_get(url)
    _pagination_hint(v)
    if not args.get("raw"):
        _simplify(v)
    return v


async def get_data_point(auth: AuthState, args: dict) -> dict:
    dp_id = args["data_point_id"]
    url = f"https://health.googleapis.com/v4/{dp_id}" if dp_id.startswith("users/") else f"{BASE}/dataTypes/{args['data_type']}/dataPoints/{dp_id}"
    v = await auth.api_get(url)
    if not args.get("raw"):
        _simplify(v)
    return v


async def reconcile_data_points(auth: AuthState, args: dict) -> dict:
    url = f"{BASE}/dataTypes/{args['data_type']}/dataPoints:reconcile"
    params = []
    if args.get("filter"):
        params.append(f"filter={quote(args['filter'])}")
    if args.get("page_size"):
        params.append(f"pageSize={int(args['page_size'])}")
    if args.get("page_token"):
        params.append(f"pageToken={quote(args['page_token'])}")
    if args.get("data_source_family"):
        params.append(f"dataSourceFamily={quote(args['data_source_family'])}")
    if params:
        url += "?" + "&".join(params)
    v = await auth.api_get(url)
    _pagination_hint(v)
    if not args.get("raw"):
        _simplify(v)
    return v


async def sync_data_points(auth: AuthState, args: dict) -> dict:
    f = _build_filter(args["data_type"], args["since_time"], args.get("until_time"))
    return await reconcile_data_points(auth, {**args, "filter": f})


async def rollup_data_points(auth: AuthState, args: dict) -> dict:
    url = f"{BASE}/dataTypes/{args['data_type']}/dataPoints:rollUp"
    body = {"range": {"startTime": args["start_time"], "endTime": args["end_time"]}, "windowSize": args["window_size"]}
    if args.get("page_size"):
        body["pageSize"] = int(args["page_size"])
    if args.get("page_token"):
        body["pageToken"] = args["page_token"]
    if args.get("data_source_family"):
        body["dataSourceFamily"] = args["data_source_family"]
    v = await auth.api_post(url, body)
    _pagination_hint(v)
    if not args.get("raw"):
        _simplify(v)
    return v


async def daily_rollup_data_points(auth: AuthState, args: dict) -> dict:
    start = _parse_date(args["start_date"])
    end = _parse_date(args["end_date"])
    url = f"{BASE}/dataTypes/{args['data_type']}/dataPoints:dailyRollUp"
    body: dict = {"range": {"start": {"date": _date_obj(start)}, "end": {"date": _date_obj(end)}}}
    if args.get("window_size_days"):
        body["windowSizeDays"] = int(args["window_size_days"])
    if args.get("page_size"):
        body["pageSize"] = int(args["page_size"])
    if args.get("page_token"):
        body["pageToken"] = args["page_token"]
    if args.get("data_source_family"):
        body["dataSourceFamily"] = args["data_source_family"]
    v = await auth.api_post(url, body)
    _pagination_hint(v)
    if not args.get("raw"):
        _simplify(v)
    return v


async def create_data_point(auth: AuthState, args: dict) -> dict:
    url = f"{BASE}/dataTypes/{args['data_type']}/dataPoints"
    if args.get("dry_run"):
        return {"dry_run": True, "method": "POST", "url": url, "body": args["body"]}
    v = await auth.api_post(url, args["body"])
    auth.cache.clear()
    return v


async def add_weight_sample(auth: AuthState, args: dict) -> dict:
    kg = args["weight_kg"]
    if kg <= 0 or kg > 500:
        return {"error": "weight_kg must be between 0 and 500 kg"}
    ts = args.get("timestamp") or datetime.now(timezone.utc).isoformat()
    off = args.get("utc_offset") or "0s"
    body = {"weight": {"sampleTime": {"physicalTime": ts, "utcOffset": off}, "weightGrams": round(kg * 1000)}}
    return await create_data_point(auth, {"data_type": "weight", "body": body, "dry_run": args.get("dry_run")})


async def add_hydration_log(auth: AuthState, args: dict) -> dict:
    start = args.get("start_time") or datetime.now(timezone.utc).isoformat()
    end = args.get("end_time") or start
    if start == end:
        end = (datetime.fromisoformat(start) + timedelta(seconds=60)).isoformat()
    off = args.get("utc_offset") or "0s"
    body = {"hydrationLog": {"interval": {"startTime": start, "startUtcOffset": off, "endTime": end, "endUtcOffset": off}}}
    return await create_data_point(auth, {"data_type": "hydration-log", "body": body, "dry_run": args.get("dry_run")})


async def add_sleep_session(auth: AuthState, args: dict) -> dict:
    start_dt = datetime.fromisoformat(args["start_time"])
    end_dt = datetime.fromisoformat(args["end_time"])
    if start_dt >= end_dt:
        return {"error": "end_time must be after start_time"}
    off = args.get("utc_offset") or "0s"
    body = {"sleep": {"interval": {"startTime": args["start_time"], "startUtcOffset": off, "endTime": args["end_time"], "endUtcOffset": off}}}
    return await create_data_point(auth, {"data_type": "sleep", "body": body, "dry_run": args.get("dry_run")})


async def add_exercise_session(auth: AuthState, args: dict) -> dict:
    start_dt = datetime.fromisoformat(args["start_time"])
    end_dt = datetime.fromisoformat(args["end_time"])
    if start_dt >= end_dt:
        return {"error": "end_time must be after start_time"}
    off = args.get("utc_offset") or "0s"
    body = {"exercise": {"exerciseType": args["exercise_type"].upper(), "interval": {"startTime": args["start_time"], "startUtcOffset": off, "endTime": args["end_time"], "endUtcOffset": off}}}
    return await create_data_point(auth, {"data_type": "exercise", "body": body, "dry_run": args.get("dry_run")})


async def add_nutrition_log(auth: AuthState, args: dict) -> dict:
    valid = {"BREAKFAST", "LUNCH", "DINNER", "SNACK"}
    meal = args["meal_type"].upper()
    if meal not in valid:
        return {"error": "meal_type must be one of: BREAKFAST, LUNCH, DINNER, SNACK"}
    start = args.get("start_time") or datetime.now(timezone.utc).isoformat()
    end = args.get("end_time") or start
    if start == end:
        end = (datetime.fromisoformat(start) + timedelta(minutes=30)).isoformat()
    off = args.get("utc_offset") or "0s"
    body = {"nutritionLog": {"mealType": meal, "interval": {"startTime": start, "startUtcOffset": off, "endTime": end, "endUtcOffset": off}}}
    return await create_data_point(auth, {"data_type": "nutrition-log", "body": body, "dry_run": args.get("dry_run")})


async def patch_data_point(auth: AuthState, args: dict) -> dict:
    dp_id = args["data_point_id"]
    url = f"https://health.googleapis.com/v4/{dp_id}" if dp_id.startswith("users/") else f"{BASE}/dataTypes/{args['data_type']}/dataPoints/{dp_id}"
    v = await auth.api_patch(url, args["body"])
    auth.cache.clear()
    return v


async def delete_data_point(auth: AuthState, args: dict) -> dict:
    dp_id = args["data_point_id"]
    name = dp_id if dp_id.startswith("users/") else f"users/me/dataTypes/{args['data_type']}/dataPoints/{dp_id}"
    return await batch_delete_data_points(auth, {"data_type": args["data_type"], "names": [name]})


async def batch_delete_data_points(auth: AuthState, args: dict) -> dict:
    url = f"{BASE}/dataTypes/{args['data_type']}/dataPoints:batchDelete"
    v = await auth.api_post(url, {"names": args["names"]})
    auth.cache.clear()
    return v


async def delete_by_filter(auth: AuthState, args: dict) -> dict:
    dt = args["data_type"]
    filt = args["filter"]
    max_count = min(max(int(args.get("max_count") or 100), 1), 10000)
    names: list[str] = []
    page_token = None
    while True:
        ps = 25 if dt in ("sleep", "exercise") else 100
        url = f"{BASE}/dataTypes/{dt}/dataPoints?filter={quote(filt)}&pageSize={ps}"
        if page_token:
            url += f"&pageToken={quote(page_token)}"
        v = await auth.api_get(url)
        for p in v.get("dataPoints", []):
            if name := p.get("name"):
                names.append(name)
                if len(names) >= max_count:
                    break
        if len(names) >= max_count:
            break
        page_token = v.get("nextPageToken")
        if not page_token:
            break
    if not names:
        return {"deleted_count": 0, "message": "No data points matched the filter"}
    deleted = 0
    for i in range(0, len(names), 10000):
        chunk = names[i:i + 10000]
        try:
            await auth.api_post(f"{BASE}/dataTypes/{dt}/dataPoints:batchDelete", {"names": chunk})
            deleted += len(chunk)
        except Exception as e:
            return {"deleted_count": deleted, "error": f"Batch delete failed after {deleted}: {e}"}
    auth.cache.clear()
    return {"deleted_count": deleted, "data_type": dt, "filter": filt}


async def export_exercise_tcx(auth: AuthState, args: dict) -> dict:
    params = "alt=media"
    if args.get("partial_data"):
        params += "&partialData=true"
    url = f"{BASE}/dataTypes/exercise/dataPoints/{args['data_point_id']}:exportExerciseTcx?{params}"
    return await auth.api_get(url)


async def get_profile(auth: AuthState, args: dict) -> dict:
    return await auth.api_get(f"{BASE}/profile")


async def update_profile(auth: AuthState, args: dict) -> dict:
    return await auth.api_patch(f"{BASE}/profile", args["body"])


async def get_settings(auth: AuthState, args: dict) -> dict:
    return await auth.api_get(f"{BASE}/settings")


async def update_settings(auth: AuthState, args: dict) -> dict:
    return await auth.api_patch(f"{BASE}/settings", args["body"])


async def get_identity(auth: AuthState, args: dict) -> dict:
    return await auth.api_get(f"{BASE}/identity")


async def get_irn_profile(auth: AuthState, args: dict) -> dict:
    return await auth.api_get(f"{BASE}/irnProfile")


async def list_paired_devices(auth: AuthState, args: dict) -> dict:
    return await auth.api_get(f"{BASE}/pairedDevices")


async def get_paired_device(auth: AuthState, args: dict) -> dict:
    return await auth.api_get(f"{BASE}/pairedDevices/{args['device_id']}")


async def clear_cache(auth: AuthState, args: dict) -> dict:
    auth.cache.clear()
    return {"success": True, "message": "In-memory response cache cleared"}


# ─── Analytics ────────────────────────────────────────────────────────────────


async def compare_health_periods(auth: AuthState, args: dict) -> dict:
    a_start, a_end = _parse_date(args["period_a_start"]), _parse_date(args["period_a_end"])
    b_start, b_end = _parse_date(args["period_b_start"]), _parse_date(args["period_b_end"])
    sa, sb = await asyncio.gather(_period_summary(auth, a_start, a_end), _period_summary(auth, b_start, b_end))
    keys = ["avg_daily_steps", "avg_daily_active_calories_kcal", "avg_daily_total_calories_kcal", "avg_daily_distance_km", "avg_daily_floors", "avg_heart_rate_bpm", "avg_sleep_minutes", "avg_deep_sleep_minutes", "avg_rem_sleep_minutes", "avg_awake_minutes", "avg_sleep_efficiency_pct", "avg_hrv_ms", "avg_resting_hr_bpm"]
    delta = {}
    for k in keys:
        va, vb = _num(sa.get(k)), _num(sb.get(k))
        diff = vb - va
        pct = (diff / va * 100) if va else 0
        delta[k] = {"period_a": va, "period_b": vb, "diff": _round2(diff), "percentage_change": f"{pct:.1f}%"}
    return {"period_a": {"start": args["period_a_start"], "end": args["period_a_end"], "metrics": sa}, "period_b": {"start": args["period_b_start"], "end": args["period_b_end"], "metrics": sb}, "comparison_delta": delta}


async def _period_summary(auth: AuthState, start: date, end: date) -> dict:
    ss, es = start.isoformat(), (end + timedelta(days=1)).isoformat()
    days = (end - start).days + 1
    metrics = [("steps", "steps/countSum"), ("active-energy-burned", "activeEnergyBurned/kcalSum"), ("total-calories", "totalCalories/kcalSum"), ("distance", "distance/millimetersSum"), ("floors", "floors/countSum"), ("heart-rate", "heartRate/beatsPerMinuteAvg")]

    async def fetch_rollup(dt):
        try:
            return await auth.api_post(f"{BASE}/dataTypes/{dt}/dataPoints:dailyRollUp", {"range": {"start": {"date": _date_obj(start)}, "end": {"date": _date_obj(end + timedelta(days=1))}}})
        except Exception:
            return None

    rollups = await asyncio.gather(*[fetch_rollup(m[0]) for m in metrics])

    def extract_sum(idx, path):
        r = rollups[idx]
        if not r:
            return 0.0
        return sum(_num(_json_pointer(p, path)) for p in r.get("rollupDataPoints", []))

    def extract_avg(idx, path):
        r = rollups[idx]
        if not r:
            return 0.0
        vals = [_num(_json_pointer(p, path)) for p in r.get("rollupDataPoints", []) if _json_pointer(p, path) is not None]
        return sum(vals) / len(vals) if vals else 0.0

    # Sleep
    sleep_pts = []
    try:
        pt = None
        while True:
            url = f"{BASE}/dataTypes/sleep/dataPoints?filter={quote(f'sleep.interval.civil_end_time >= {Q}{ss}{Q} AND sleep.interval.civil_end_time < {Q}{es}{Q}')}&pageSize=25"
            if pt:
                url += f"&pageToken={quote(pt)}"
            v = await auth.api_get(url)
            sleep_pts.extend(v.get("dataPoints", []))
            pt = v.get("nextPageToken")
            if not pt:
                break
    except Exception:
        pass

    total_sleep = sessions = deep = rem = awake = in_period = 0
    for p in sleep_pts:
        s = _json_pointer(p, "sleep/summary")
        if not s:
            continue
        if "minutesAsleep" in s:
            sessions += 1
            total_sleep += int(_num(s.get("minutesAsleep")))
        in_period += int(_num(s.get("minutesInSleepPeriod")))
        awake += int(_num(s.get("minutesAwake")))
        for st in s.get("stagesSummary", []):
            if st.get("type") == "DEEP":
                deep += int(_num(st.get("minutes")))
            elif st.get("type") == "REM":
                rem += int(_num(st.get("minutes")))

    # HRV + RHR
    hrv_f = f'daily_heart_rate_variability.date >= "{ss}" AND daily_heart_rate_variability.date < "{es}"'
    rhr_f = f'daily_resting_heart_rate.date >= "{ss}" AND daily_resting_heart_rate.date < "{es}"'
    hrv_resp, rhr_resp = await asyncio.gather(
        _safe_get(auth, f"{BASE}/dataTypes/daily-heart-rate-variability/dataPoints?filter={quote(hrv_f)}&pageSize=100"),
        _safe_get(auth, f"{BASE}/dataTypes/daily-resting-heart-rate/dataPoints?filter={quote(rhr_f)}&pageSize=100"),
    )
    hrv_vals = [_num(_json_pointer(p, "dailyHeartRateVariability/averageHeartRateVariabilityMilliseconds")) for p in (hrv_resp or {}).get("dataPoints", []) if _json_pointer(p, "dailyHeartRateVariability/averageHeartRateVariabilityMilliseconds")]
    rhr_vals = [_num(_json_pointer(p, "dailyRestingHeartRate/beatsPerMinute")) for p in (rhr_resp or {}).get("dataPoints", []) if _json_pointer(p, "dailyRestingHeartRate/beatsPerMinute")]
    avg_arr = lambda a: sum(a) / len(a) if a else 0.0

    return {
        "days_count": days, "total_steps": int(extract_sum(0, "steps/countSum")), "avg_daily_steps": int(extract_sum(0, "steps/countSum") // days),
        "total_active_calories_kcal": _round1(extract_sum(1, "activeEnergyBurned/kcalSum")), "avg_daily_active_calories_kcal": _round1(extract_sum(1, "activeEnergyBurned/kcalSum") / days),
        "total_calories_kcal": _round1(extract_sum(2, "totalCalories/kcalSum")), "avg_daily_total_calories_kcal": _round1(extract_sum(2, "totalCalories/kcalSum") / days),
        "total_distance_km": _round2(extract_sum(3, "distance/millimetersSum") / 1e6), "avg_daily_distance_km": _round2(extract_sum(3, "distance/millimetersSum") / 1e6 / days),
        "total_floors": int(extract_sum(4, "floors/countSum")), "avg_daily_floors": int(extract_sum(4, "floors/countSum") // days),
        "avg_heart_rate_bpm": _round1(extract_avg(5, "heartRate/beatsPerMinuteAvg")),
        "sleep_sessions": sessions, "total_sleep_minutes": total_sleep,
        "avg_sleep_minutes": total_sleep // sessions if sessions else 0,
        "avg_deep_sleep_minutes": deep // sessions if sessions else 0,
        "avg_rem_sleep_minutes": rem // sessions if sessions else 0,
        "avg_awake_minutes": awake // sessions if sessions else 0,
        "avg_sleep_efficiency_pct": _round1(total_sleep / in_period * 100) if in_period else 0,
        "avg_hrv_ms": _round1(avg_arr(hrv_vals)), "avg_resting_hr_bpm": _round1(avg_arr(rhr_vals)),
    }


async def _safe_get(auth: AuthState, url: str):
    try:
        return await auth.api_get(url)
    except Exception:
        return None


async def get_hrv_recovery_trend(auth: AuthState, args: dict) -> dict:
    days_count = min(max(int(args.get("days") or 14), 1), 90)
    end = _parse_date(args["end_date"]) if args.get("end_date") else date.today()
    start = end - timedelta(days=days_count - 1)
    end_excl = (end + timedelta(days=1)).isoformat()
    ss = start.isoformat()

    hrv_resp, rhr_resp = await asyncio.gather(
        _safe_get(auth, f"{BASE}/dataTypes/daily-heart-rate-variability/dataPoints?filter={quote(f'daily_heart_rate_variability.date >= {Q}{ss}{Q} AND daily_heart_rate_variability.date < {Q}{end_excl}{Q}')}&pageSize=100"),
        _safe_get(auth, f"{BASE}/dataTypes/daily-resting-heart-rate/dataPoints?filter={quote(f'daily_resting_heart_rate.date >= {Q}{ss}{Q} AND daily_resting_heart_rate.date < {Q}{end_excl}{Q}')}&pageSize=100"),
    )

    hrv_daily, rhr_daily = [], []
    for p in (hrv_resp or {}).get("dataPoints", []):
        h = p.get("dailyHeartRateVariability") or {}
        v = _num(h.get("averageHeartRateVariabilityMilliseconds"))
        if not v:
            continue
        hrv_daily.append({"date": _date_obj_to_str(h.get("date")), "avg_hrv_ms": v, "entropy": h.get("entropy"), "deep_sleep_hrv_ms": h.get("deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds"), "non_rem_hr_bpm": h.get("nonRemHeartRateBeatsPerMinute")})
    for p in (rhr_resp or {}).get("dataPoints", []):
        r = p.get("dailyRestingHeartRate") or {}
        v = _num(r.get("beatsPerMinute"))
        if not v:
            continue
        rhr_daily.append({"date": _date_obj_to_str(r.get("date")), "bpm": v, "calculation_method": _json_pointer(r, "dailyRestingHeartRateMetadata/calculationMethod")})

    hrv_daily.sort(key=lambda d: d["date"])
    rhr_daily.sort(key=lambda d: d["date"])
    hrv_vals = [d["avg_hrv_ms"] for d in hrv_daily]
    rhr_vals = [d["bpm"] for d in rhr_daily]
    avg_arr = lambda a: sum(a) / len(a) if a else 0.0
    hrv_avg, rhr_avg = avg_arr(hrv_vals), avg_arr(rhr_vals)

    if len(hrv_daily) >= 4:
        bl_end = len(hrv_daily) - 3
        bl_label = f"first {bl_end} days"
        bl_hrv = avg_arr([d["avg_hrv_ms"] for d in hrv_daily[:bl_end]])
        bl_rhr = avg_arr([d["bpm"] for d in rhr_daily[:len(rhr_daily) - 3]]) if len(rhr_daily) >= 4 else avg_arr(rhr_vals)
        cur_hrv = avg_arr([d["avg_hrv_ms"] for d in hrv_daily[bl_end:]])
        cur_rhr = avg_arr([d["bpm"] for d in rhr_daily[-3:]])
        if cur_hrv >= bl_hrv * 0.95 and (not bl_rhr or cur_rhr <= bl_rhr * 1.05):
            readiness = "HIGH"
        elif cur_hrv >= bl_hrv * 0.85:
            readiness = "MODERATE"
        else:
            readiness = "LOW / RECOVERY NEEDED"
    else:
        bl_label, bl_hrv, bl_rhr, cur_hrv, cur_rhr = "first 7 days", 0, 0, hrv_avg, rhr_avg
        readiness = "HIGH" if hrv_avg > 50 and 0 < rhr_avg < 65 else "MODERATE" if hrv_avg > 30 else "LOW / RECOVERY NEEDED"

    return {"period": {"start_date": ss, "end_date": end.isoformat(), "days": days_count},
            "hrv_metrics": {"sample_count": len(hrv_vals), "avg_hrv_ms": _round1(hrv_avg), "min_hrv_ms": min(hrv_vals) if hrv_vals else 0, "max_hrv_ms": max(hrv_vals) if hrv_vals else 0},
            "resting_hr_metrics": {"sample_count": len(rhr_vals), "avg_bpm": _round1(rhr_avg), "min_bpm": min(rhr_vals) if rhr_vals else 0, "max_bpm": max(rhr_vals) if rhr_vals else 0},
            "baseline": {"period": bl_label, "hrv_avg_ms": _round1(bl_hrv), "rhr_avg_bpm": _round1(bl_rhr), "data_sufficient": len(hrv_daily) >= 4},
            "current": {"period": "last 3 days", "hrv_avg_ms": _round1(cur_hrv), "rhr_avg_bpm": _round1(cur_rhr)},
            "daily_hrv": hrv_daily, "daily_rhr": rhr_daily, "readiness_assessment": readiness}


async def get_temperature_summary(auth: AuthState, args: dict) -> dict:
    start, end = _parse_date(args["start_date"]), _parse_date(args["end_date"])
    end_excl = (end + timedelta(days=1)).isoformat()
    sd = args["start_date"]
    core_f = f'core_body_temperature.sample_time.physical_time >= "{sd}T00:00:00Z" AND core_body_temperature.sample_time.physical_time < "{end_excl}T00:00:00Z"'
    sleep_f = f'daily_sleep_temperature_derivations.date >= "{sd}" AND daily_sleep_temperature_derivations.date < "{end_excl}"'
    core, sleep_temp = await asyncio.gather(
        _safe_get(auth, f"{BASE}/dataTypes/core-body-temperature/dataPoints?filter={quote(core_f)}&pageSize=100"),
        _safe_get(auth, f"{BASE}/dataTypes/daily-sleep-temperature-derivations/dataPoints?filter={quote(sleep_f)}&pageSize=100"),
    )
    return {"period": {"start_date": args["start_date"], "end_date": args["end_date"]}, "core_body_temperature": core, "daily_sleep_temperature_derivations": sleep_temp, "note": "Google Health API v4 core-body-temperature is read-only; entries are synced automatically from connected wearables."}


async def get_trends(auth: AuthState, args: dict) -> dict:
    start, end = _parse_date(args["start_date"]), _parse_date(args["end_date"])
    if start > end:
        return {"error": "end_date must be on or after start_date"}
    body = {"range": {"start": {"date": _date_obj(start)}, "end": {"date": _date_obj(end + timedelta(days=1))}}, "windowSizeDays": 1}
    v = await auth.api_post(f"{BASE}/dataTypes/{args['data_type']}/dataPoints:dailyRollUp", body)
    camel = _snake_to_camel(args["data_type"].replace("-", "_"))
    series = [{"date": _date_obj_to_str(_json_pointer(p, "civilStartTime/date")), "value": p.get(camel)} for p in v.get("rollupDataPoints", [])]
    return {"data_type": args["data_type"], "start_date": args["start_date"], "end_date": args["end_date"], "days": len(series), "series": series}


# ─── Daily Summary ────────────────────────────────────────────────────────────

ROLLUP_SPECS = [("steps", "steps", "steps"), ("heart-rate", "heartRate", "heart_rate"), ("active-energy-burned", "activeEnergyBurned", "active_calories"), ("total-calories", "totalCalories", "total_calories"), ("distance", "distance", "distance"), ("active-minutes", "activeMinutes", "active_minutes"), ("active-zone-minutes", "activeZoneMinutes", "active_zone_minutes"), ("floors", "floors", "floors"), ("time-in-heart-rate-zone", "timeInHeartRateZone", "time_in_heart_rate_zone"), ("calories-in-heart-rate-zone", "caloriesInHeartRateZone", "calories_in_heart_rate_zone"), ("altitude", "altitude", "altitude"), ("swim-lengths-data", "swimLengthsData", "swim_lengths"), ("weight", "weight", "weight_rollup"), ("body-fat", "bodyFat", "body_fat"), ("blood-glucose", "bloodGlucose", "blood_glucose"), ("core-body-temperature", "coreBodyTemperature", "core_body_temperature"), ("run-vo2-max", "runVo2Max", "run_vo2_max"), ("sedentary-period", "sedentaryPeriod", "sedentary_period"), ("nutrition-log", "nutritionLog", "nutrition_log"), ("hydration-log", "hydrationLog", "hydration_log")]
DAILY_SPECS = [("daily-resting-heart-rate", "daily_resting_heart_rate", "dailyRestingHeartRate", "resting_heart_rate"), ("daily-heart-rate-variability", "daily_heart_rate_variability", "dailyHeartRateVariability", "heart_rate_variability"), ("daily-oxygen-saturation", "daily_oxygen_saturation", "dailyOxygenSaturation", "oxygen_saturation"), ("daily-respiratory-rate", "daily_respiratory_rate", "dailyRespiratoryRate", "respiratory_rate"), ("daily-sleep-temperature-derivations", "daily_sleep_temperature_derivations", "dailySleepTemperatureDerivations", "sleep_temperature"), ("daily-vo2-max", "daily_vo2_max", "dailyVo2Max", "daily_vo2_max"), ("daily-heart-rate-zones", "daily_heart_rate_zones", "dailyHeartRateZones", "daily_heart_rate_zones")]
SAMPLE_SPECS = [("vo2-max", "vo2_max", "vo2Max", "vo2_max"), ("heart-rate-variability", "heart_rate_variability", "heartRateVariability", "hrv_sample"), ("oxygen-saturation", "oxygen_saturation", "oxygenSaturation", "spo2_sample"), ("respiratory-rate-sleep-summary", "respiratory_rate_sleep_summary", "respiratoryRateSleepSummary", "respiratory_rate_sleep")]
CONCURRENCY = 10


async def build_daily_summary(auth: AuthState, d: date) -> dict:
    ds, ns = d.isoformat(), (d + timedelta(days=1)).isoformat()
    summary: dict = {"date": ds}
    errors: list[str] = []
    sem = asyncio.Semaphore(CONCURRENCY)
    rollup_body = {"range": {"start": {"date": _date_obj(d)}, "end": {"date": _date_obj(d + timedelta(days=1))}}, "windowSizeDays": 1}

    async def task_rollup(dt, field, key):
        async with sem:
            try:
                v = await auth.api_post(f"{BASE}/dataTypes/{dt}/dataPoints:dailyRollUp", rollup_body)
                pts = v.get("rollupDataPoints", [])
                summary[key] = pts[0].get(field) if pts else None
            except Exception as e:
                errors.append(f"{dt}: {e}")

    async def task_daily(dt, ff, df, key):
        async with sem:
            try:
                v = await auth.api_get(f"{BASE}/dataTypes/{dt}/dataPoints?filter={quote(f'{ff}.date >= {Q}{ds}{Q} AND {ff}.date < {Q}{ns}{Q}')}&pageSize=1")
                pts = v.get("dataPoints", [])
                summary[key] = pts[0].get(df) if pts else None
            except Exception as e:
                errors.append(f"{dt}: {e}")

    async def task_sample(dt, ff, df, key):
        async with sem:
            try:
                v = await auth.api_get(f"{BASE}/dataTypes/{dt}/dataPoints?filter={quote(f'{ff}.sample_time.civil_time >= {Q}{ds}{Q} AND {ff}.sample_time.civil_time < {Q}{ns}{Q}')}&pageSize=1")
                pts = v.get("dataPoints", [])
                summary[key] = pts[0].get(df) if pts else None
            except Exception as e:
                errors.append(f"{dt}: {e}")

    async def task_sleep():
        async with sem:
            try:
                v = await auth.api_get(f"{BASE}/dataTypes/sleep/dataPoints?filter={quote(f'sleep.interval.civil_end_time >= {Q}{ds}{Q} AND sleep.interval.civil_end_time < {Q}{ns}{Q}')}&pageSize=5")
                sleeps = [{"start": _json_pointer(p, "sleep/interval/startTime"), "end": _json_pointer(p, "sleep/interval/endTime"), "startUtcOffset": _json_pointer(p, "sleep/interval/startUtcOffset"), "endUtcOffset": _json_pointer(p, "sleep/interval/endUtcOffset"), "type": _json_pointer(p, "sleep/type"), "stages": _json_pointer(p, "sleep/stages"), "summary": _json_pointer(p, "sleep/summary"), "metadata": _json_pointer(p, "sleep/metadata")} for p in v.get("dataPoints", []) if p.get("sleep")]
                if sleeps:
                    summary["sleep"] = sleeps
            except Exception as e:
                errors.append(f"sleep: {e}")

    async def task_exercise():
        async with sem:
            try:
                v = await auth.api_get(f"{BASE}/dataTypes/exercise/dataPoints?filter={quote(f'exercise.interval.civil_start_time >= {Q}{ds}{Q} AND exercise.interval.civil_start_time < {Q}{ns}{Q}')}&pageSize=25")
                exercises = [{"type": _json_pointer(p, "exercise/exerciseType"), "name": _json_pointer(p, "exercise/displayName"), "start": _json_pointer(p, "exercise/interval/startTime"), "end": _json_pointer(p, "exercise/interval/endTime"), "startUtcOffset": _json_pointer(p, "exercise/interval/startUtcOffset"), "endUtcOffset": _json_pointer(p, "exercise/interval/endUtcOffset"), "duration": _json_pointer(p, "exercise/activeDuration"), "metrics": _json_pointer(p, "exercise/metricsSummary"), "metadata": _json_pointer(p, "exercise/exerciseMetadata")} for p in v.get("dataPoints", []) if p.get("exercise")]
                if exercises:
                    summary["exercise"] = exercises
            except Exception as e:
                errors.append(f"exercise: {e}")

    async def task_activity():
        async with sem:
            try:
                v = await auth.api_get(f"{BASE}/dataTypes/activity-level/dataPoints?filter={quote(f'activity_level.interval.start_time >= {Q}{ds}T00:00:00Z{Q} AND activity_level.interval.start_time < {Q}{ns}T00:00:00Z{Q}')}&pageSize=50")
                levels = [p["activityLevel"] for p in v.get("dataPoints", []) if p.get("activityLevel")]
                if levels:
                    summary["activity_levels"] = levels
            except Exception as e:
                errors.append(f"activity-level: {e}")

    tasks = [task_rollup(*s) for s in ROLLUP_SPECS] + [task_daily(*s) for s in DAILY_SPECS] + [task_sample(*s) for s in SAMPLE_SPECS] + [task_sleep(), task_exercise(), task_activity()]
    await asyncio.gather(*tasks)
    if errors:
        summary["_errors"] = errors
    return summary


async def _daily_summary(auth: AuthState, d: date) -> dict:
    key = f"summary:{d.isoformat()}"
    cached = auth.cache.get(key)
    if cached:
        return {**cached, "_cached": True}
    summary = await build_daily_summary(auth, d)
    auth.cache.set(key, summary)
    return summary


async def summary(auth: AuthState, args: dict) -> dict:
    d = _parse_date(args["date"]) if args.get("date") else date.today()
    return await _daily_summary(auth, d)


async def today(auth: AuthState, args: dict) -> dict:
    return await _daily_summary(auth, date.today())


async def yesterday(auth: AuthState, args: dict) -> dict:
    return await _daily_summary(auth, date.today() - timedelta(days=1))


# ─── Tool registry ────────────────────────────────────────────────────────────

TOOL_HANDLERS = {
    "list_data_types": list_data_types, "describe_data_type": describe_data_type,
    "list_data_points": list_data_points, "get_data_point": get_data_point,
    "reconcile_data_points": reconcile_data_points, "sync_data_points": sync_data_points,
    "rollup_data_points": rollup_data_points, "daily_rollup_data_points": daily_rollup_data_points,
    "create_data_point": create_data_point, "add_weight_sample": add_weight_sample,
    "add_hydration_log": add_hydration_log, "add_sleep_session": add_sleep_session,
    "add_exercise_session": add_exercise_session, "add_nutrition_log": add_nutrition_log,
    "patch_data_point": patch_data_point, "delete_data_point": delete_data_point,
    "batch_delete_data_points": batch_delete_data_points, "delete_by_filter": delete_by_filter,
    "export_exercise_tcx": export_exercise_tcx, "get_profile": get_profile,
    "update_profile": update_profile, "get_settings": get_settings,
    "update_settings": update_settings, "get_identity": get_identity,
    "get_irn_profile": get_irn_profile, "list_paired_devices": list_paired_devices,
    "get_paired_device": get_paired_device, "clear_cache": clear_cache,
    "compare_health_periods": compare_health_periods, "get_hrv_recovery_trend": get_hrv_recovery_trend,
    "get_temperature_summary": get_temperature_summary, "get_trends": get_trends,
    "summary": summary, "today": today, "yesterday": yesterday,
}
