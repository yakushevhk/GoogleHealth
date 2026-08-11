//! Metadata-driven registry of all 39 Google Health API v4 data types.
//!
//! Modelled after the Google Health CLI's `pkg/types/registry.go`. Each entry
//! carries enough metadata to drive filter construction, capability discovery,
//! and documentation without hard-coding type names across the codebase.

use serde::Serialize;

/// Which time field a data type is filtered on (AIP-160 filters).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TimeField {
    /// `{type}.interval.start_time` (RFC3339)
    IntervalStart,
    /// `{type}.interval.civil_start_time` (date, YYYY-MM-DD)
    IntervalCivilStart,
    /// `{type}.interval.end_time` / `civil_end_time`
    IntervalEnd,
    /// `{type}.sample_time.physical_time` (RFC3339)
    SamplePhysical,
    /// `{type}.sample_time.civil_time` (date)
    SampleCivil,
    /// `{type}.date` (YYYY-MM-DD)
    Daily,
    /// No time filter (reference catalogs: food, food-measurement-unit)
    None,
}

impl TimeField {
    /// Human-readable label for the time field.
    pub fn label(&self) -> &'static str {
        match self {
            TimeField::IntervalStart => "interval.start_time (RFC3339)",
            TimeField::IntervalCivilStart => "interval.civil_start_time (date)",
            TimeField::IntervalEnd => "interval.end_time / civil_end_time",
            TimeField::SamplePhysical => "sample_time.physical_time (RFC3339)",
            TimeField::SampleCivil => "sample_time.civil_time (date)",
            TimeField::Daily => "date (YYYY-MM-DD)",
            TimeField::None => "none (no time filter)",
        }
    }

    /// Build the concrete filter field path for a snake_case type name, e.g.
    /// `heart_rate.sample_time.physical_time`. Returns `None` for reference
    /// catalogs that take no time filter.
    pub fn filter_path(&self, snake_type: &str) -> Option<String> {
        let suffix = match self {
            TimeField::IntervalStart => "interval.start_time",
            TimeField::IntervalCivilStart => "interval.civil_start_time",
            TimeField::IntervalEnd => "interval.end_time",
            TimeField::SamplePhysical => "sample_time.physical_time",
            TimeField::SampleCivil => "sample_time.civil_time",
            TimeField::Daily => "date",
            TimeField::None => return None,
        };
        Some(format!("{snake_type}.{suffix}"))
    }
}

/// Full metadata for a single Google Health API v4 data type.
#[derive(Debug, Clone, Serialize)]
pub struct DataTypeInfo {
    /// kebab-case ID (e.g. "heart-rate")
    pub id: &'static str,
    /// snake_case filter name (e.g. "heart_rate")
    pub filter_name: &'static str,
    /// Category for grouping
    pub category: &'static str,
    /// Supports `dataPoints` list
    pub listable: bool,
    /// Supports `dataPoints:rollUp`
    pub rollup: bool,
    /// Supports `dataPoints:dailyRollUp`
    pub daily_rollup: bool,
    /// Supports create/write (dedicated helper or generic create)
    pub writable: bool,
    /// Supports reconcile (dedup/merge of listed points)
    pub reconcilable: bool,
    /// Time field type used for filters
    pub time_field: TimeField,
    /// Page size cap (25 for sleep/exercise, 10000 for others)
    pub page_cap: u32,
    /// Max rollup range in days (14 for some types, 90 for others)
    pub rollup_range_days: u32,
    /// Short description
    pub description: &'static str,
    /// Key fields in the response value object
    pub key_fields: &'static [&'static str],
    /// Gotchas / important notes
    pub gotchas: &'static [&'static str],
}

/// The complete registry of all 39 Google Health API v4 data types.
pub const DATA_TYPES: &[DataTypeInfo] = &[
    // ── Interval types (filter: {type}.interval.start_time) ──────────────────
    DataTypeInfo {
        id: "steps",
        filter_name: "steps",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Step counts over time intervals.",
        key_fields: &["countSum"],
        gotchas: &["list returns intervals WITHOUT values; use dailyRollUp for totals"],
    },
    DataTypeInfo {
        id: "active-energy-burned",
        filter_name: "active_energy_burned",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Active (exercise) calories burned over intervals.",
        key_fields: &["kcalSum"],
        gotchas: &["list returns intervals WITHOUT values; use rollUp/dailyRollUp for kcalSum"],
    },
    DataTypeInfo {
        id: "distance",
        filter_name: "distance",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Distance travelled over intervals (millimeters).",
        key_fields: &["millimetersSum"],
        gotchas: &["values are in millimeters; divide by 1_000_000 for km"],
    },
    DataTypeInfo {
        id: "active-minutes",
        filter_name: "active_minutes",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 14,
        description: "Active minutes bucketed by activity level.",
        key_fields: &["activeMinutesRollupByActivityLevel"],
        gotchas: &["14-day rollup range limit"],
    },
    DataTypeInfo {
        id: "active-zone-minutes",
        filter_name: "active_zone_minutes",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Minutes spent in fat-burn / cardio / peak heart-rate zones.",
        key_fields: &["sumInFatBurnHeartZone", "sumInCardioHeartZone", "sumInPeakHeartZone"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "activity-level",
        filter_name: "activity_level",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Discrete activity-level segments (still, walking, running, ...).",
        key_fields: &["activityLevel"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "altitude",
        filter_name: "altitude",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Altitude readings over intervals (meters).",
        key_fields: &["metersAvg", "metersMax", "metersMin"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "sedentary-period",
        filter_name: "sedentary_period",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Continuous sedentary (inactive) periods.",
        key_fields: &["interval"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "swim-lengths-data",
        filter_name: "swim_lengths_data",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Swim pool-length counts per interval.",
        key_fields: &["swimLengthsSum"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "time-in-heart-rate-zone",
        filter_name: "time_in_heart_rate_zone",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Time spent in each heart-rate zone.",
        key_fields: &["timeInHeartRateZone"],
        gotchas: &[],
    },
    // ── Sample types (filter: {type}.sample_time.physical_time) ──────────────
    DataTypeInfo {
        id: "heart-rate",
        filter_name: "heart_rate",
        category: "cardiac",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 14,
        description: "Instantaneous heart-rate samples (BPM).",
        key_fields: &["beatsPerMinute", "beatsPerMinuteAvg", "beatsPerMinuteMax", "beatsPerMinuteMin"],
        gotchas: &["14-day rollup range limit"],
    },
    DataTypeInfo {
        id: "weight",
        filter_name: "weight",
        category: "body",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: true,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Body weight samples (kilograms).",
        key_fields: &["kilograms"],
        gotchas: &["writable via add_weight_sample"],
    },
    DataTypeInfo {
        id: "height",
        filter_name: "height",
        category: "body",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Height samples (meters).",
        key_fields: &["meters"],
        gotchas: &["no rollUp support"],
    },
    DataTypeInfo {
        id: "body-fat",
        filter_name: "body_fat",
        category: "body",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Body fat percentage samples.",
        key_fields: &["percentage"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "blood-glucose",
        filter_name: "blood_glucose",
        category: "nutrition",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Blood glucose samples.",
        key_fields: &["millimolesPerLiter", "milligramsPerDeciliter"],
        gotchas: &["unit depends on user settings"],
    },
    DataTypeInfo {
        id: "core-body-temperature",
        filter_name: "core_body_temperature",
        category: "temperature",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Core body temperature samples (Celsius).",
        key_fields: &["celsius"],
        gotchas: &[],
    },
    DataTypeInfo {
        id: "heart-rate-variability",
        filter_name: "heart_rate_variability",
        category: "cardiac",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "HRV (RMSSD) samples in milliseconds.",
        key_fields: &["rootMeanSquareOfSuccessiveDifferencesMilliseconds"],
        gotchas: &["no rollUp support; use daily-heart-rate-variability for daily aggregates"],
    },
    DataTypeInfo {
        id: "oxygen-saturation",
        filter_name: "oxygen_saturation",
        category: "oxygen",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Blood oxygen saturation (SpO2) samples, percentage.",
        key_fields: &["percentage"],
        gotchas: &["no rollUp support; use daily-oxygen-saturation for daily aggregates"],
    },
    DataTypeInfo {
        id: "respiratory-rate-sleep-summary",
        filter_name: "respiratory_rate_sleep_summary",
        category: "respiratory",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Per-sleep-stage respiratory rate summary (breaths/min).",
        key_fields: &["breathsPerMinuteDeepSleep", "breathsPerMinuteLightSleep", "breathsPerMinuteRemSleep"],
        gotchas: &["no rollUp support"],
    },
    DataTypeInfo {
        id: "vo2-max",
        filter_name: "vo2_max",
        category: "activity",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "VO2 max samples (ml/min/kg).",
        key_fields: &["millilitersPerMinuteKilogramMax"],
        gotchas: &["no rollUp support; use daily-vo2-max for daily aggregates"],
    },
    DataTypeInfo {
        id: "run-vo2-max",
        filter_name: "run_vo2_max",
        category: "activity",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: true,
        time_field: TimeField::SamplePhysical,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Running-specific VO2 max samples (ml/min/kg).",
        key_fields: &["millilitersPerMinuteKilogramMax"],
        gotchas: &[],
    },
    // ── Daily types (filter: {type}.date) ────────────────────────────────────
    DataTypeInfo {
        id: "daily-resting-heart-rate",
        filter_name: "daily_resting_heart_rate",
        category: "cardiac",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Daily resting heart rate (BPM).",
        key_fields: &["beatsPerMinute"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    DataTypeInfo {
        id: "daily-heart-rate-variability",
        filter_name: "daily_heart_rate_variability",
        category: "cardiac",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Daily HRV aggregate (RMSSD avg, ms).",
        key_fields: &["rootMeanSquareOfSuccessiveDifferencesMillisecondsAvg"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    DataTypeInfo {
        id: "daily-heart-rate-zones",
        filter_name: "daily_heart_rate_zones",
        category: "cardiac",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Daily time-in-heart-rate-zone aggregate.",
        key_fields: &["timeInHeartRateZone"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    DataTypeInfo {
        id: "daily-oxygen-saturation",
        filter_name: "daily_oxygen_saturation",
        category: "oxygen",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Daily SpO2 aggregate (percentage avg).",
        key_fields: &["percentageAvg"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    DataTypeInfo {
        id: "daily-respiratory-rate",
        filter_name: "daily_respiratory_rate",
        category: "respiratory",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Daily respiratory rate aggregate (breaths/min).",
        key_fields: &["breathsPerMinuteAvg"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    DataTypeInfo {
        id: "daily-sleep-temperature-derivations",
        filter_name: "daily_sleep_temperature_derivations",
        category: "sleep",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Nightly skin/sleep temperature deviation from baseline (Celsius).",
        key_fields: &["deviationFromBaselineCelsius"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    DataTypeInfo {
        id: "daily-vo2-max",
        filter_name: "daily_vo2_max",
        category: "activity",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::Daily,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Daily VO2 max aggregate (ml/min/kg).",
        key_fields: &["millilitersPerMinuteKilogramMax"],
        gotchas: &["already daily; filter on .date (YYYY-MM-DD)"],
    },
    // ── Session types ────────────────────────────────────────────────────────
    DataTypeInfo {
        id: "sleep",
        filter_name: "sleep",
        category: "sleep",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: true,
        reconcilable: true,
        time_field: TimeField::IntervalEnd,
        page_cap: 25,
        rollup_range_days: 90,
        description: "Sleep sessions with stages and summary.",
        key_fields: &["stages", "minutesAsleep", "minutesInSleepPeriod", "sleepType"],
        gotchas: &[
            "page size capped at 25",
            "filter on sleep.interval.end_time (or civil_end_time), not start_time",
        ],
    },
    DataTypeInfo {
        id: "exercise",
        filter_name: "exercise",
        category: "activity",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: true,
        reconcilable: true,
        time_field: TimeField::IntervalCivilStart,
        page_cap: 25,
        rollup_range_days: 90,
        description: "Exercise sessions with type, duration, and metrics.",
        key_fields: &["exerciseType", "metrics", "duration"],
        gotchas: &[
            "page size capped at 25",
            "filter uses exercise.interval.civil_start_time (date)",
            "exportable to TCX via export_exercise_tcx",
        ],
    },
    DataTypeInfo {
        id: "hydration-log",
        filter_name: "hydration_log",
        category: "nutrition",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: true,
        reconcilable: true,
        time_field: TimeField::IntervalCivilStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Hydration events (time only).",
        key_fields: &["interval"],
        gotchas: &[
            "API v4 does not support volume recording; time only",
            "filter uses hydration_log.interval.civil_start_time (date)",
        ],
    },
    DataTypeInfo {
        id: "nutrition-log",
        filter_name: "nutrition_log",
        category: "nutrition",
        listable: true,
        rollup: true,
        daily_rollup: true,
        writable: true,
        reconcilable: true,
        time_field: TimeField::IntervalCivilStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Meal events (meal type and time only).",
        key_fields: &["mealType", "interval"],
        gotchas: &[
            "API v4 does not support nutrient recording; meal type and time only",
            "filter uses nutrition_log.interval.civil_start_time (date)",
        ],
    },
    DataTypeInfo {
        id: "irregular-rhythm-notification",
        filter_name: "irregular_rhythm_notification",
        category: "clinical",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalCivilStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Irregular rhythm (AFib) notification events.",
        key_fields: &["interval"],
        gotchas: &["filter uses irregular_rhythm_notification.interval.civil_start_time (date)"],
    },
    DataTypeInfo {
        id: "electrocardiogram",
        filter_name: "electrocardiogram",
        category: "clinical",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: true,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "ECG recordings with classification and signal.",
        key_fields: &["classification", "signal"],
        gotchas: &["filter supports >= only, no upper bound"],
    },
    // ── Reference catalogs (no time filter) ──────────────────────────────────
    DataTypeInfo {
        id: "food",
        filter_name: "food",
        category: "nutrition",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: false,
        time_field: TimeField::None,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Reference catalog of foods.",
        key_fields: &["foodName"],
        gotchas: &["reference catalog, no time filter"],
    },
    DataTypeInfo {
        id: "food-measurement-unit",
        filter_name: "food_measurement_unit",
        category: "nutrition",
        listable: true,
        rollup: false,
        daily_rollup: false,
        writable: false,
        reconcilable: false,
        time_field: TimeField::None,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Reference catalog of food measurement units.",
        key_fields: &["measurementUnit"],
        gotchas: &["reference catalog, no time filter"],
    },
    // ── Rollup-only types (no list support) ──────────────────────────────────
    DataTypeInfo {
        id: "floors",
        filter_name: "floors",
        category: "activity",
        listable: false,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: false,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 90,
        description: "Floors climbed aggregates.",
        key_fields: &["floorsSum"],
        gotchas: &["rollup-only, no list support"],
    },
    DataTypeInfo {
        id: "total-calories",
        filter_name: "total_calories",
        category: "nutrition",
        listable: false,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: false,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 14,
        description: "Total (resting + active) calories burned aggregates.",
        key_fields: &["kcalSum"],
        gotchas: &["rollup-only, no list support", "14-day rollup range limit"],
    },
    DataTypeInfo {
        id: "calories-in-heart-rate-zone",
        filter_name: "calories_in_heart_rate_zone",
        category: "cardiac",
        listable: false,
        rollup: true,
        daily_rollup: true,
        writable: false,
        reconcilable: false,
        time_field: TimeField::IntervalStart,
        page_cap: 10000,
        rollup_range_days: 14,
        description: "Calories burned per heart-rate zone aggregates.",
        key_fields: &["caloriesInHeartRateZone"],
        gotchas: &["rollup-only, no list support", "14-day rollup range limit"],
    },
];

/// Look up a data type by its kebab-case ID.
pub fn find_type(id: &str) -> Option<&'static DataTypeInfo> {
    DATA_TYPES.iter().find(|t| t.id == id)
}

/// All distinct categories present in the registry, in stable order.
pub fn categories() -> Vec<&'static str> {
    let mut seen: Vec<&'static str> = Vec::new();
    for t in DATA_TYPES {
        if !seen.contains(&t.category) {
            seen.push(t.category);
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_39_types() {
        assert_eq!(DATA_TYPES.len(), 39, "registry must contain all 39 data types");
    }

    #[test]
    fn ids_are_unique_and_kebab_case() {
        let mut ids: Vec<&str> = DATA_TYPES.iter().map(|t| t.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), before, "data type IDs must be unique");
        for t in DATA_TYPES {
            assert!(!t.id.contains('_'), "id {} must be kebab-case", t.id);
            assert!(!t.filter_name.contains('-'), "filter_name {} must be snake_case", t.filter_name);
        }
    }

    #[test]
    fn filter_name_matches_id() {
        for t in DATA_TYPES {
            assert_eq!(t.filter_name, t.id.replace('-', "_"), "filter_name mismatch for {}", t.id);
        }
    }

    #[test]
    fn find_type_works() {
        assert_eq!(find_type("heart-rate").unwrap().category, "cardiac");
        assert_eq!(find_type("daily-resting-heart-rate").unwrap().time_field, TimeField::Daily);
        assert!(find_type("does-not-exist").is_none());
    }

    #[test]
    fn page_caps_and_ranges() {
        assert_eq!(find_type("sleep").unwrap().page_cap, 25);
        assert_eq!(find_type("exercise").unwrap().page_cap, 25);
        assert_eq!(find_type("steps").unwrap().page_cap, 10000);
        assert_eq!(find_type("heart-rate").unwrap().rollup_range_days, 14);
        assert_eq!(find_type("active-minutes").unwrap().rollup_range_days, 14);
        assert_eq!(find_type("total-calories").unwrap().rollup_range_days, 14);
        assert_eq!(find_type("calories-in-heart-rate-zone").unwrap().rollup_range_days, 14);
        assert_eq!(find_type("steps").unwrap().rollup_range_days, 90);
    }

    #[test]
    fn rollup_only_types_not_listable() {
        for id in ["floors", "total-calories", "calories-in-heart-rate-zone"] {
            let t = find_type(id).unwrap();
            assert!(!t.listable, "{id} must not be listable");
            assert!(t.rollup, "{id} must support rollup");
        }
    }

    #[test]
    fn filter_path_examples() {
        let hr = find_type("heart-rate").unwrap();
        assert_eq!(
            hr.time_field.filter_path(hr.filter_name).as_deref(),
            Some("heart_rate.sample_time.physical_time")
        );
        let food = find_type("food").unwrap();
        assert_eq!(food.time_field.filter_path(food.filter_name), None);
    }
}
