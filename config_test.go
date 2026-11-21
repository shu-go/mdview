package main

import (
	"encoding/json"
	"testing"
)

func TestSettingsDefaultsAndMigration(t *testing.T) {
	// a settings file written before closeWindowOnLastTab existed, with a zoom factor
	s := DefaultSettings()
	if err := json.Unmarshal([]byte(`{"theme":"dark","zoom":1}`), &s); err != nil {
		t.Fatal(err)
	}
	s.normalize()
	if !s.CloseWindowOnLastTab {
		t.Error("closeWindowOnLastTab should default to true")
	}
	if s.Zoom != 100 || s.Theme != "dark" {
		t.Errorf("zoom/theme = %d/%s", s.Zoom, s.Theme)
	}
	s = DefaultSettings()
	_ = json.Unmarshal([]byte(`{"closeWindowOnLastTab":false}`), &s)
	if s.CloseWindowOnLastTab {
		t.Error("explicit false must be kept")
	}
}
