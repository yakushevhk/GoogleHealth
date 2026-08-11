package main

import (
	"testing"
)

func TestRegistryHas39Types(t *testing.T) {
	if len(DataTypes) != 39 {
		t.Errorf("registry must contain all 39 data types, got %d", len(DataTypes))
	}
}

func TestIDsAreUniqueAndKebabCase(t *testing.T) {
	seen := make(map[string]bool)
	for _, dt := range DataTypes {
		if seen[dt.ID] {
			t.Errorf("duplicate data type ID: %s", dt.ID)
		}
		seen[dt.ID] = true

		for _, c := range dt.ID {
			if c == '_' {
				t.Errorf("id %s must be kebab-case (contains underscore)", dt.ID)
			}
		}
		for _, c := range dt.FilterName {
			if c == '-' {
				t.Errorf("filter_name %s must be snake_case (contains hyphen)", dt.FilterName)
			}
		}
	}
}

func TestFilterNameMatchesID(t *testing.T) {
	for _, dt := range DataTypes {
		expected := KebabToSnake(dt.ID)
		if dt.FilterName != expected {
			t.Errorf("filter_name mismatch for %s: got %s, want %s", dt.ID, dt.FilterName, expected)
		}
	}
}

func TestFindTypeWorks(t *testing.T) {
	hr := FindType("heart-rate")
	if hr == nil {
		t.Fatal("FindType(heart-rate) returned nil")
	}
	if hr.Category != "cardiac" {
		t.Errorf("heart-rate category: got %s, want cardiac", hr.Category)
	}

	drhr := FindType("daily-resting-heart-rate")
	if drhr == nil {
		t.Fatal("FindType(daily-resting-heart-rate) returned nil")
	}
	if drhr.TimeField != TimeFieldDaily {
		t.Errorf("daily-resting-heart-rate time_field: got %s, want daily", drhr.TimeField)
	}

	if FindType("does-not-exist") != nil {
		t.Error("FindType(does-not-exist) should return nil")
	}
}

func TestPageCapsAndRanges(t *testing.T) {
	tests := []struct {
		id      string
		pageCap int
	}{
		{"sleep", 25},
		{"exercise", 25},
		{"steps", 10000},
	}
	for _, tt := range tests {
		dt := FindType(tt.id)
		if dt == nil {
			t.Fatalf("FindType(%s) returned nil", tt.id)
		}
		if dt.PageCap != tt.pageCap {
			t.Errorf("%s page_cap: got %d, want %d", tt.id, dt.PageCap, tt.pageCap)
		}
	}

	rangeTests := []struct {
		id   string
		days int
	}{
		{"heart-rate", 14},
		{"active-minutes", 14},
		{"total-calories", 14},
		{"calories-in-heart-rate-zone", 14},
		{"steps", 90},
	}
	for _, tt := range rangeTests {
		dt := FindType(tt.id)
		if dt == nil {
			t.Fatalf("FindType(%s) returned nil", tt.id)
		}
		if dt.RollupRangeDays != tt.days {
			t.Errorf("%s rollup_range_days: got %d, want %d", tt.id, dt.RollupRangeDays, tt.days)
		}
	}
}

func TestRollupOnlyTypesNotListable(t *testing.T) {
	for _, id := range []string{"floors", "total-calories", "calories-in-heart-rate-zone"} {
		dt := FindType(id)
		if dt == nil {
			t.Fatalf("FindType(%s) returned nil", id)
		}
		if dt.Listable {
			t.Errorf("%s must not be listable", id)
		}
		if !dt.Rollup {
			t.Errorf("%s must support rollup", id)
		}
	}
}

func TestFilterPathExamples(t *testing.T) {
	hr := FindType("heart-rate")
	if hr == nil {
		t.Fatal("FindType(heart-rate) returned nil")
	}
	path := hr.TimeField.FilterPath(hr.FilterName)
	expected := "heart_rate.sample_time.physical_time"
	if path != expected {
		t.Errorf("heart-rate filter path: got %s, want %s", path, expected)
	}

	food := FindType("food")
	if food == nil {
		t.Fatal("FindType(food) returned nil")
	}
	if food.TimeField.FilterPath(food.FilterName) != "" {
		t.Error("food filter path should be empty")
	}
}

func TestCategories(t *testing.T) {
	cats := Categories()
	if len(cats) == 0 {
		t.Error("Categories() returned empty")
	}
	// Check no duplicates.
	seen := make(map[string]bool)
	for _, c := range cats {
		if seen[c] {
			t.Errorf("duplicate category: %s", c)
		}
		seen[c] = true
	}
}

func TestTimeFieldLabels(t *testing.T) {
	tests := []struct {
		tf    TimeField
		label string
	}{
		{TimeFieldIntervalStart, "interval.start_time (RFC3339)"},
		{TimeFieldDaily, "date (YYYY-MM-DD)"},
		{TimeFieldNone, "none (no time filter)"},
	}
	for _, tt := range tests {
		if got := tt.tf.Label(); got != tt.label {
			t.Errorf("TimeField(%s).Label(): got %q, want %q", tt.tf, got, tt.label)
		}
	}
}
