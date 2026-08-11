package main

import "strings"

// TimeField indicates which time field a data type is filtered on (AIP-160 filters).
type TimeField string

const (
	TimeFieldIntervalStart      TimeField = "interval_start"       // {type}.interval.start_time (RFC3339)
	TimeFieldIntervalCivilStart TimeField = "interval_civil_start" // {type}.interval.civil_start_time (date)
	TimeFieldIntervalEnd        TimeField = "interval_end"         // {type}.interval.end_time / civil_end_time
	TimeFieldSamplePhysical     TimeField = "sample_physical"      // {type}.sample_time.physical_time (RFC3339)
	TimeFieldSampleCivil        TimeField = "sample_civil"         // {type}.sample_time.civil_time (date)
	TimeFieldDaily              TimeField = "daily"                // {type}.date (YYYY-MM-DD)
	TimeFieldNone               TimeField = "none"                 // No time filter (reference catalogs)
)

// Label returns a human-readable label for the time field.
func (tf TimeField) Label() string {
	switch tf {
	case TimeFieldIntervalStart:
		return "interval.start_time (RFC3339)"
	case TimeFieldIntervalCivilStart:
		return "interval.civil_start_time (date)"
	case TimeFieldIntervalEnd:
		return "interval.end_time / civil_end_time"
	case TimeFieldSamplePhysical:
		return "sample_time.physical_time (RFC3339)"
	case TimeFieldSampleCivil:
		return "sample_time.civil_time (date)"
	case TimeFieldDaily:
		return "date (YYYY-MM-DD)"
	case TimeFieldNone:
		return "none (no time filter)"
	default:
		return "unknown"
	}
}

// FilterPath builds the concrete filter field path for a snake_case type name.
// Returns empty string for reference catalogs that take no time filter.
func (tf TimeField) FilterPath(snakeType string) string {
	var suffix string
	switch tf {
	case TimeFieldIntervalStart:
		suffix = "interval.start_time"
	case TimeFieldIntervalCivilStart:
		suffix = "interval.civil_start_time"
	case TimeFieldIntervalEnd:
		suffix = "interval.end_time"
	case TimeFieldSamplePhysical:
		suffix = "sample_time.physical_time"
	case TimeFieldSampleCivil:
		suffix = "sample_time.civil_time"
	case TimeFieldDaily:
		suffix = "date"
	case TimeFieldNone:
		return ""
	default:
		return ""
	}
	return snakeType + "." + suffix
}

// DataTypeInfo holds full metadata for a single Google Health API v4 data type.
type DataTypeInfo struct {
	ID              string    `json:"id"`
	FilterName      string    `json:"filter_name"`
	Category        string    `json:"category"`
	Listable        bool      `json:"listable"`
	Rollup          bool      `json:"rollup"`
	DailyRollup     bool      `json:"daily_rollup"`
	Writable        bool      `json:"writable"`
	Reconcilable    bool      `json:"reconcilable"`
	TimeField       TimeField `json:"time_field"`
	PageCap         int       `json:"page_cap"`
	RollupRangeDays int       `json:"rollup_range_days"`
	Description     string    `json:"description"`
	KeyFields       []string  `json:"key_fields"`
	Gotchas         []string  `json:"gotchas"`
}

// DataTypes is the complete registry of all 39 Google Health API v4 data types.
var DataTypes = []DataTypeInfo{
	// ── Interval types (filter: {type}.interval.start_time) ──────────────────
	{
		ID: "steps", FilterName: "steps", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Step counts over time intervals.",
		KeyFields:   []string{"countSum"},
		Gotchas:     []string{"list returns intervals WITHOUT values; use dailyRollUp for totals"},
	},
	{
		ID: "active-energy-burned", FilterName: "active_energy_burned", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Active (exercise) calories burned over intervals.",
		KeyFields:   []string{"kcalSum"},
		Gotchas:     []string{"list returns intervals WITHOUT values; use rollUp/dailyRollUp for kcalSum"},
	},
	{
		ID: "distance", FilterName: "distance", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Distance travelled over intervals (millimeters).",
		KeyFields:   []string{"millimetersSum"},
		Gotchas:     []string{"values are in millimeters; divide by 1_000_000 for km"},
	},
	{
		ID: "active-minutes", FilterName: "active_minutes", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 14,
		Description: "Active minutes bucketed by activity level.",
		KeyFields:   []string{"activeMinutesRollupByActivityLevel"},
		Gotchas:     []string{"14-day rollup range limit"},
	},
	{
		ID: "active-zone-minutes", FilterName: "active_zone_minutes", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Minutes spent in fat-burn / cardio / peak heart-rate zones.",
		KeyFields:   []string{"sumInFatBurnHeartZone", "sumInCardioHeartZone", "sumInPeakHeartZone"},
		Gotchas:     []string{},
	},
	{
		ID: "activity-level", FilterName: "activity_level", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Discrete activity-level segments (still, walking, running, ...).",
		KeyFields:   []string{"activityLevel"},
		Gotchas:     []string{},
	},
	{
		ID: "altitude", FilterName: "altitude", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Altitude readings over intervals (meters).",
		KeyFields:   []string{"metersAvg", "metersMax", "metersMin"},
		Gotchas:     []string{},
	},
	{
		ID: "sedentary-period", FilterName: "sedentary_period", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Continuous sedentary (inactive) periods.",
		KeyFields:   []string{"interval"},
		Gotchas:     []string{},
	},
	{
		ID: "swim-lengths-data", FilterName: "swim_lengths_data", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Swim pool-length counts per interval.",
		KeyFields:   []string{"swimLengthsSum"},
		Gotchas:     []string{},
	},
	{
		ID: "time-in-heart-rate-zone", FilterName: "time_in_heart_rate_zone", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Time spent in each heart-rate zone.",
		KeyFields:   []string{"timeInHeartRateZone"},
		Gotchas:     []string{},
	},
	// ── Sample types (filter: {type}.sample_time.physical_time) ──────────────
	{
		ID: "heart-rate", FilterName: "heart_rate", Category: "cardiac",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 14,
		Description: "Instantaneous heart-rate samples (BPM).",
		KeyFields:   []string{"beatsPerMinute", "beatsPerMinuteAvg", "beatsPerMinuteMax", "beatsPerMinuteMin"},
		Gotchas:     []string{"14-day rollup range limit"},
	},
	{
		ID: "weight", FilterName: "weight", Category: "body",
		Listable: true, Rollup: true, DailyRollup: true, Writable: true, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Body weight samples (kilograms).",
		KeyFields:   []string{"kilograms"},
		Gotchas:     []string{"writable via add_weight_sample"},
	},
	{
		ID: "height", FilterName: "height", Category: "body",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Height samples (meters).",
		KeyFields:   []string{"meters"},
		Gotchas:     []string{"no rollUp support"},
	},
	{
		ID: "body-fat", FilterName: "body_fat", Category: "body",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Body fat percentage samples.",
		KeyFields:   []string{"percentage"},
		Gotchas:     []string{},
	},
	{
		ID: "blood-glucose", FilterName: "blood_glucose", Category: "nutrition",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Blood glucose samples.",
		KeyFields:   []string{"millimolesPerLiter", "milligramsPerDeciliter"},
		Gotchas:     []string{"unit depends on user settings"},
	},
	{
		ID: "core-body-temperature", FilterName: "core_body_temperature", Category: "temperature",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Core body temperature samples (Celsius).",
		KeyFields:   []string{"celsius"},
		Gotchas:     []string{},
	},
	{
		ID: "heart-rate-variability", FilterName: "heart_rate_variability", Category: "cardiac",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "HRV (RMSSD) samples in milliseconds.",
		KeyFields:   []string{"rootMeanSquareOfSuccessiveDifferencesMilliseconds"},
		Gotchas:     []string{"no rollUp support; use daily-heart-rate-variability for daily aggregates"},
	},
	{
		ID: "oxygen-saturation", FilterName: "oxygen_saturation", Category: "oxygen",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Blood oxygen saturation (SpO2) samples, percentage.",
		KeyFields:   []string{"percentage"},
		Gotchas:     []string{"no rollUp support; use daily-oxygen-saturation for daily aggregates"},
	},
	{
		ID: "respiratory-rate-sleep-summary", FilterName: "respiratory_rate_sleep_summary", Category: "respiratory",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Per-sleep-stage respiratory rate summary (breaths/min).",
		KeyFields:   []string{"breathsPerMinuteDeepSleep", "breathsPerMinuteLightSleep", "breathsPerMinuteRemSleep"},
		Gotchas:     []string{"no rollUp support"},
	},
	{
		ID: "vo2-max", FilterName: "vo2_max", Category: "activity",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "VO2 max samples (ml/min/kg).",
		KeyFields:   []string{"millilitersPerMinuteKilogramMax"},
		Gotchas:     []string{"no rollUp support; use daily-vo2-max for daily aggregates"},
	},
	{
		ID: "run-vo2-max", FilterName: "run_vo2_max", Category: "activity",
		Listable: true, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: true,
		TimeField: TimeFieldSamplePhysical, PageCap: 10000, RollupRangeDays: 90,
		Description: "Running-specific VO2 max samples (ml/min/kg).",
		KeyFields:   []string{"millilitersPerMinuteKilogramMax"},
		Gotchas:     []string{},
	},
	// ── Daily types (filter: {type}.date) ────────────────────────────────────
	{
		ID: "daily-resting-heart-rate", FilterName: "daily_resting_heart_rate", Category: "cardiac",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Daily resting heart rate (BPM).",
		KeyFields:   []string{"beatsPerMinute"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	{
		ID: "daily-heart-rate-variability", FilterName: "daily_heart_rate_variability", Category: "cardiac",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Daily HRV aggregate (RMSSD avg, ms).",
		KeyFields:   []string{"rootMeanSquareOfSuccessiveDifferencesMillisecondsAvg"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	{
		ID: "daily-heart-rate-zones", FilterName: "daily_heart_rate_zones", Category: "cardiac",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Daily time-in-heart-rate-zone aggregate.",
		KeyFields:   []string{"timeInHeartRateZone"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	{
		ID: "daily-oxygen-saturation", FilterName: "daily_oxygen_saturation", Category: "oxygen",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Daily SpO2 aggregate (percentage avg).",
		KeyFields:   []string{"percentageAvg"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	{
		ID: "daily-respiratory-rate", FilterName: "daily_respiratory_rate", Category: "respiratory",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Daily respiratory rate aggregate (breaths/min).",
		KeyFields:   []string{"breathsPerMinuteAvg"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	{
		ID: "daily-sleep-temperature-derivations", FilterName: "daily_sleep_temperature_derivations", Category: "sleep",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Nightly skin/sleep temperature deviation from baseline (Celsius).",
		KeyFields:   []string{"deviationFromBaselineCelsius"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	{
		ID: "daily-vo2-max", FilterName: "daily_vo2_max", Category: "activity",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldDaily, PageCap: 10000, RollupRangeDays: 90,
		Description: "Daily VO2 max aggregate (ml/min/kg).",
		KeyFields:   []string{"millilitersPerMinuteKilogramMax"},
		Gotchas:     []string{"already daily; filter on .date (YYYY-MM-DD)"},
	},
	// ── Session types ────────────────────────────────────────────────────────
	{
		ID: "sleep", FilterName: "sleep", Category: "sleep",
		Listable: true, Rollup: false, DailyRollup: false, Writable: true, Reconcilable: true,
		TimeField: TimeFieldIntervalEnd, PageCap: 25, RollupRangeDays: 90,
		Description: "Sleep sessions with stages and summary.",
		KeyFields:   []string{"stages", "minutesAsleep", "minutesInSleepPeriod", "sleepType"},
		Gotchas: []string{
			"page size capped at 25",
			"filter on sleep.interval.end_time (or civil_end_time), not start_time",
		},
	},
	{
		ID: "exercise", FilterName: "exercise", Category: "activity",
		Listable: true, Rollup: false, DailyRollup: false, Writable: true, Reconcilable: true,
		TimeField: TimeFieldIntervalCivilStart, PageCap: 25, RollupRangeDays: 90,
		Description: "Exercise sessions with type, duration, and metrics.",
		KeyFields:   []string{"exerciseType", "metrics", "duration"},
		Gotchas: []string{
			"page size capped at 25",
			"filter uses exercise.interval.civil_start_time (date)",
			"exportable to TCX via export_exercise_tcx",
		},
	},
	{
		ID: "hydration-log", FilterName: "hydration_log", Category: "nutrition",
		Listable: true, Rollup: true, DailyRollup: true, Writable: true, Reconcilable: true,
		TimeField: TimeFieldIntervalCivilStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Hydration events (time only).",
		KeyFields:   []string{"interval"},
		Gotchas: []string{
			"API v4 does not support volume recording; time only",
			"filter uses hydration_log.interval.civil_start_time (date)",
		},
	},
	{
		ID: "nutrition-log", FilterName: "nutrition_log", Category: "nutrition",
		Listable: true, Rollup: true, DailyRollup: true, Writable: true, Reconcilable: true,
		TimeField: TimeFieldIntervalCivilStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Meal events (meal type and time only).",
		KeyFields:   []string{"mealType", "interval"},
		Gotchas: []string{
			"API v4 does not support nutrient recording; meal type and time only",
			"filter uses nutrition_log.interval.civil_start_time (date)",
		},
	},
	{
		ID: "irregular-rhythm-notification", FilterName: "irregular_rhythm_notification", Category: "clinical",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalCivilStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Irregular rhythm (AFib) notification events.",
		KeyFields:   []string{"interval"},
		Gotchas:     []string{"filter uses irregular_rhythm_notification.interval.civil_start_time (date)"},
	},
	{
		ID: "electrocardiogram", FilterName: "electrocardiogram", Category: "clinical",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: true,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "ECG recordings with classification and signal.",
		KeyFields:   []string{"classification", "signal"},
		Gotchas:     []string{"filter supports >= only, no upper bound"},
	},
	// ── Reference catalogs (no time filter) ──────────────────────────────────
	{
		ID: "food", FilterName: "food", Category: "nutrition",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: false,
		TimeField: TimeFieldNone, PageCap: 10000, RollupRangeDays: 90,
		Description: "Reference catalog of foods.",
		KeyFields:   []string{"foodName"},
		Gotchas:     []string{"reference catalog, no time filter"},
	},
	{
		ID: "food-measurement-unit", FilterName: "food_measurement_unit", Category: "nutrition",
		Listable: true, Rollup: false, DailyRollup: false, Writable: false, Reconcilable: false,
		TimeField: TimeFieldNone, PageCap: 10000, RollupRangeDays: 90,
		Description: "Reference catalog of food measurement units.",
		KeyFields:   []string{"measurementUnit"},
		Gotchas:     []string{"reference catalog, no time filter"},
	},
	// ── Rollup-only types (no list support) ──────────────────────────────────
	{
		ID: "floors", FilterName: "floors", Category: "activity",
		Listable: false, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: false,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 90,
		Description: "Floors climbed aggregates.",
		KeyFields:   []string{"floorsSum"},
		Gotchas:     []string{"rollup-only, no list support"},
	},
	{
		ID: "total-calories", FilterName: "total_calories", Category: "nutrition",
		Listable: false, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: false,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 14,
		Description: "Total (resting + active) calories burned aggregates.",
		KeyFields:   []string{"kcalSum"},
		Gotchas:     []string{"rollup-only, no list support", "14-day rollup range limit"},
	},
	{
		ID: "calories-in-heart-rate-zone", FilterName: "calories_in_heart_rate_zone", Category: "cardiac",
		Listable: false, Rollup: true, DailyRollup: true, Writable: false, Reconcilable: false,
		TimeField: TimeFieldIntervalStart, PageCap: 10000, RollupRangeDays: 14,
		Description: "Calories burned per heart-rate zone aggregates.",
		KeyFields:   []string{"caloriesInHeartRateZone"},
		Gotchas:     []string{"rollup-only, no list support", "14-day rollup range limit"},
	},
}

// FindType looks up a data type by its kebab-case ID.
func FindType(id string) *DataTypeInfo {
	for i := range DataTypes {
		if DataTypes[i].ID == id {
			return &DataTypes[i]
		}
	}
	return nil
}

// Categories returns all distinct categories in stable order.
func Categories() []string {
	var seen []string
	for _, t := range DataTypes {
		found := false
		for _, s := range seen {
			if s == t.Category {
				found = true
				break
			}
		}
		if !found {
			seen = append(seen, t.Category)
		}
	}
	return seen
}

// SnakeToKebab converts snake_case to kebab-case.
func SnakeToKebab(s string) string {
	return strings.ReplaceAll(s, "_", "-")
}

// KebabToSnake converts kebab-case to snake_case.
func KebabToSnake(s string) string {
	return strings.ReplaceAll(s, "-", "_")
}
