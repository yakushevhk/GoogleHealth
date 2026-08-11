"""Registry of all 39 Google Health API v4 data types."""

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class DataTypeInfo:
    id: str
    filter_name: str
    category: str
    listable: bool
    rollup: bool
    daily_rollup: bool
    writable: bool
    reconcilable: bool
    time_field: str
    page_cap: int
    rollup_range_days: int
    description: str
    key_fields: tuple[str, ...] = ()
    gotchas: tuple[str, ...] = ()


def _t(id: str, cat: str, tf: str, *, listable=True, rollup=False, daily_rollup=False,
       writable=False, reconcilable=True, page_cap=10000, rollup_range_days=90,
       desc="", keys=(), gotchas=()) -> DataTypeInfo:
    return DataTypeInfo(
        id=id, filter_name=id.replace("-", "_"), category=cat,
        listable=listable, rollup=rollup, daily_rollup=daily_rollup,
        writable=writable, reconcilable=reconcilable, time_field=tf,
        page_cap=page_cap, rollup_range_days=rollup_range_days,
        description=desc, key_fields=keys, gotchas=gotchas,
    )


DATA_TYPES: list[DataTypeInfo] = [
    # Interval types
    _t("steps", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Step counts over time intervals.", keys=("countSum",), gotchas=("list returns intervals WITHOUT values; use dailyRollUp for totals",)),
    _t("active-energy-burned", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Active (exercise) calories burned over intervals.", keys=("kcalSum",), gotchas=("list returns intervals WITHOUT values; use rollUp/dailyRollUp for kcalSum",)),
    _t("distance", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Distance travelled over intervals (millimeters).", keys=("millimetersSum",), gotchas=("values are in millimeters; divide by 1_000_000 for km",)),
    _t("active-minutes", "activity", "interval_start", rollup=True, daily_rollup=True, rollup_range_days=14, desc="Active minutes bucketed by activity level.", keys=("activeMinutesRollupByActivityLevel",), gotchas=("14-day rollup range limit",)),
    _t("active-zone-minutes", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Minutes spent in fat-burn / cardio / peak heart-rate zones.", keys=("sumInFatBurnHeartZone", "sumInCardioHeartZone", "sumInPeakHeartZone")),
    _t("activity-level", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Discrete activity-level segments (still, walking, running, ...).", keys=("activityLevel",)),
    _t("altitude", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Altitude readings over intervals (meters).", keys=("metersAvg", "metersMax", "metersMin")),
    _t("sedentary-period", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Continuous sedentary (inactive) periods.", keys=("interval",)),
    _t("swim-lengths-data", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Swim pool-length counts per interval.", keys=("swimLengthsSum",)),
    _t("time-in-heart-rate-zone", "activity", "interval_start", rollup=True, daily_rollup=True, desc="Time spent in each heart-rate zone.", keys=("timeInHeartRateZone",)),
    # Sample types
    _t("heart-rate", "cardiac", "sample_physical", rollup=True, daily_rollup=True, rollup_range_days=14, desc="Instantaneous heart-rate samples (BPM).", keys=("beatsPerMinute", "beatsPerMinuteAvg", "beatsPerMinuteMax", "beatsPerMinuteMin"), gotchas=("14-day rollup range limit",)),
    _t("weight", "body", "sample_physical", rollup=True, daily_rollup=True, writable=True, desc="Body weight samples (kilograms).", keys=("kilograms",), gotchas=("writable via add_weight_sample",)),
    _t("height", "body", "sample_physical", desc="Height samples (meters).", keys=("meters",), gotchas=("no rollUp support",)),
    _t("body-fat", "body", "sample_physical", rollup=True, daily_rollup=True, desc="Body fat percentage samples.", keys=("percentage",)),
    _t("blood-glucose", "nutrition", "sample_physical", rollup=True, daily_rollup=True, desc="Blood glucose samples.", keys=("millimolesPerLiter", "milligramsPerDeciliter"), gotchas=("unit depends on user settings",)),
    _t("core-body-temperature", "temperature", "sample_physical", rollup=True, daily_rollup=True, desc="Core body temperature samples (Celsius).", keys=("celsius",)),
    _t("heart-rate-variability", "cardiac", "sample_physical", desc="HRV (RMSSD) samples in milliseconds.", keys=("rootMeanSquareOfSuccessiveDifferencesMilliseconds",), gotchas=("no rollUp support; use daily-heart-rate-variability for daily aggregates",)),
    _t("oxygen-saturation", "oxygen", "sample_physical", desc="Blood oxygen saturation (SpO2) samples, percentage.", keys=("percentage",), gotchas=("no rollUp support; use daily-oxygen-saturation for daily aggregates",)),
    _t("respiratory-rate-sleep-summary", "respiratory", "sample_physical", desc="Per-sleep-stage respiratory rate summary (breaths/min).", keys=("breathsPerMinuteDeepSleep", "breathsPerMinuteLightSleep", "breathsPerMinuteRemSleep"), gotchas=("no rollUp support",)),
    _t("vo2-max", "activity", "sample_physical", desc="VO2 max samples (ml/min/kg).", keys=("millilitersPerMinuteKilogramMax",), gotchas=("no rollUp support; use daily-vo2-max for daily aggregates",)),
    _t("run-vo2-max", "activity", "sample_physical", rollup=True, daily_rollup=True, desc="Running-specific VO2 max samples (ml/min/kg).", keys=("millilitersPerMinuteKilogramMax",)),
    # Daily types
    _t("daily-resting-heart-rate", "cardiac", "daily", desc="Daily resting heart rate (BPM).", keys=("beatsPerMinute",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    _t("daily-heart-rate-variability", "cardiac", "daily", desc="Daily HRV aggregate (RMSSD avg, ms).", keys=("rootMeanSquareOfSuccessiveDifferencesMillisecondsAvg",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    _t("daily-heart-rate-zones", "cardiac", "daily", desc="Daily time-in-heart-rate-zone aggregate.", keys=("timeInHeartRateZone",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    _t("daily-oxygen-saturation", "oxygen", "daily", desc="Daily SpO2 aggregate (percentage avg).", keys=("percentageAvg",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    _t("daily-respiratory-rate", "respiratory", "daily", desc="Daily respiratory rate aggregate (breaths/min).", keys=("breathsPerMinuteAvg",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    _t("daily-sleep-temperature-derivations", "sleep", "daily", desc="Nightly skin/sleep temperature deviation from baseline (Celsius).", keys=("deviationFromBaselineCelsius",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    _t("daily-vo2-max", "activity", "daily", desc="Daily VO2 max aggregate (ml/min/kg).", keys=("millilitersPerMinuteKilogramMax",), gotchas=("already daily; filter on .date (YYYY-MM-DD)",)),
    # Session types
    _t("sleep", "sleep", "interval_end", writable=True, page_cap=25, desc="Sleep sessions with stages and summary.", keys=("stages", "minutesAsleep", "minutesInSleepPeriod", "sleepType"), gotchas=("page size capped at 25", "filter on sleep.interval.end_time (or civil_end_time), not start_time")),
    _t("exercise", "activity", "interval_civil_start", writable=True, page_cap=25, desc="Exercise sessions with type, duration, and metrics.", keys=("exerciseType", "metrics", "duration"), gotchas=("page size capped at 25", "filter uses exercise.interval.civil_start_time (date)", "exportable to TCX via export_exercise_tcx")),
    _t("hydration-log", "nutrition", "interval_civil_start", rollup=True, daily_rollup=True, writable=True, desc="Hydration events (time only).", keys=("interval",), gotchas=("API v4 does not support volume recording; time only", "filter uses hydration_log.interval.civil_start_time (date)")),
    _t("nutrition-log", "nutrition", "interval_civil_start", rollup=True, daily_rollup=True, writable=True, desc="Meal events (meal type and time only).", keys=("mealType", "interval"), gotchas=("API v4 does not support nutrient recording; meal type and time only", "filter uses nutrition_log.interval.civil_start_time (date)")),
    _t("irregular-rhythm-notification", "clinical", "interval_civil_start", desc="Irregular rhythm (AFib) notification events.", keys=("interval",), gotchas=("filter uses irregular_rhythm_notification.interval.civil_start_time (date)",)),
    _t("electrocardiogram", "clinical", "interval_start", desc="ECG recordings with classification and signal.", keys=("classification", "signal"), gotchas=("filter supports >= only, no upper bound",)),
    # Reference catalogs
    _t("food", "nutrition", "none", reconcilable=False, desc="Reference catalog of foods.", keys=("foodName",), gotchas=("reference catalog, no time filter",)),
    _t("food-measurement-unit", "nutrition", "none", reconcilable=False, desc="Reference catalog of food measurement units.", keys=("measurementUnit",), gotchas=("reference catalog, no time filter",)),
    # Rollup-only
    _t("floors", "activity", "interval_start", listable=False, rollup=True, daily_rollup=True, reconcilable=False, desc="Floors climbed aggregates.", keys=("floorsSum",), gotchas=("rollup-only, no list support",)),
    _t("total-calories", "nutrition", "interval_start", listable=False, rollup=True, daily_rollup=True, reconcilable=False, rollup_range_days=14, desc="Total (resting + active) calories burned aggregates.", keys=("kcalSum",), gotchas=("rollup-only, no list support", "14-day rollup range limit")),
    _t("calories-in-heart-rate-zone", "cardiac", "interval_start", listable=False, rollup=True, daily_rollup=True, reconcilable=False, rollup_range_days=14, desc="Calories burned per heart-rate zone aggregates.", keys=("caloriesInHeartRateZone",), gotchas=("rollup-only, no list support", "14-day rollup range limit")),
]

_TYPE_MAP = {t.id: t for t in DATA_TYPES}


def find_type(type_id: str) -> DataTypeInfo | None:
    return _TYPE_MAP.get(type_id)


def categories() -> list[str]:
    seen: list[str] = []
    for t in DATA_TYPES:
        if t.category not in seen:
            seen.append(t.category)
    return seen
