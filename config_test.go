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
	if s.DiffDetail != "word" {
		t.Errorf("diffDetail = %q, want word", s.DiffDetail)
	}
	if s.Zoom != 100 || s.Theme != "dark" {
		t.Errorf("zoom/theme = %d/%s", s.Zoom, s.Theme)
	}
	s = DefaultSettings()
	_ = json.Unmarshal([]byte(`{"closeWindowOnLastTab":false}`), &s)
	if s.CloseWindowOnLastTab {
		t.Error("explicit false must be kept")
	}
	if s.TextExtensions != "txt" {
		t.Errorf("textExtensions should default to txt: %q", s.TextExtensions)
	}
}

func TestTextExtensions(t *testing.T) {
	s := DefaultSettings()
	s.TextExtensions = " .TXT, *.log;md txt  .markdown csv "
	s.normalize()
	if s.TextExtensions != "txt log csv" {
		t.Errorf("normalized = %q", s.TextExtensions)
	}
	if got := textExtList(s.TextExtensions); len(got) != 3 || got[0] != ".txt" || got[2] != ".csv" {
		t.Errorf("list = %v", got)
	}
	s.TextExtensions = ""
	s.normalize()
	if s.TextExtensions != "" || textExtList("") != nil {
		t.Error("empty stays empty (no text files)")
	}
}
