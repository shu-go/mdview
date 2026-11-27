package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSettingsDefaultsAndMigration(t *testing.T) {
	// a settings file written before lastTabAction existed, with a zoom factor
	s := DefaultSettings()
	if err := json.Unmarshal([]byte(`{"theme":"dark","zoom":1}`), &s); err != nil {
		t.Fatal(err)
	}
	s.normalize()
	if s.LastTabAction != "close" {
		t.Errorf("lastTabAction = %q, want close", s.LastTabAction)
	}
	if !s.WrapText {
		t.Error("wrapText should default to true")
	}
	if s.OpenInNewWindow {
		t.Error("openInNewWindow should default to false")
	}
	if s.DiffDetail != "word" {
		t.Errorf("diffDetail = %q, want word", s.DiffDetail)
	}
	if s.Zoom != 100 || s.Theme != "dark" {
		t.Errorf("zoom/theme = %d/%s", s.Zoom, s.Theme)
	}
	for _, c := range []struct{ in, want string }{
		{`{"closeWindowOnLastTab":false}`, "keep"},
		{`{"closeWindowOnLastTab":true}`, "close"},
		{`{"lastTabAction":"minimize"}`, "minimize"},
		{`{"lastTabAction":"bogus"}`, "close"},
	} {
		s = DefaultSettings()
		_ = json.Unmarshal([]byte(c.in), &s)
		s.normalize()
		if s.LastTabAction != c.want {
			t.Errorf("%s: lastTabAction = %q, want %q", c.in, s.LastTabAction, c.want)
		}
		if s.LegacyCloseWindowOnLastTab != nil {
			t.Errorf("%s: legacy field must be dropped", c.in)
		}
		b, _ := json.Marshal(s)
		if strings.Contains(string(b), "closeWindowOnLastTab") {
			t.Errorf("%s: legacy field written: %s", c.in, b)
		}
	}
}
