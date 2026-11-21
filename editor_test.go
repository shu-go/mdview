package main

import (
	"reflect"
	"testing"
)

func TestEditorArgs(t *testing.T) {
	cases := []struct {
		tmpl string
		want []string
	}{
		{`code -g "{file}:{line}"`, []string{"code", "-g", `C:\a b\x.md:12`}},
		{`"C:\Program Files\Vim\gvim.exe" +{line}`, []string{`C:\Program Files\Vim\gvim.exe`, "+12", `C:\a b\x.md`}},
		{`notepad`, []string{"notepad", `C:\a b\x.md`}},
	}
	for _, c := range cases {
		got, err := editorArgs(c.tmpl, `C:\a b\x.md`, 12)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %q, want %q", c.tmpl, got, c.want)
		}
	}
	if _, err := editorArgs(`"unterminated`, "x", 1); err == nil {
		t.Error("expected error")
	}
	if _, err := editorArgs(``, "x", 1); err == nil {
		t.Error("expected error for empty")
	}
}
