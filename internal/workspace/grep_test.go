package workspace

import (
	"path/filepath"
	"testing"
)

func TestGrep(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "b", "z.md"), "nothing\r\nFoo bar\n")
	write(t, filepath.Join(dir, "a", "y.md"), "# 見出し foo\n\nfoo again 😀 foo\n")
	ws, _ := New(nil, nil)
	defer ws.Close()
	if _, _, err := ws.OpenFolder(dir); err != nil {
		t.Fatal(err)
	}
	r, err := ws.Grep(GrepQuery{Pattern: "foo"})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Files) != 2 || r.Files[0].Name != "y.md" || r.Total != 3 {
		t.Fatalf("result = %+v", r)
	}
	m := r.Files[0].Matches[0]
	if m.Line != 1 || m.Text[m.Start:m.End] != "foo" {
		// Text is ASCII up to the match except 見出し (BMP), so UTF-16 == runes here
		rs := []rune(m.Text)
		if string(rs[m.Start:m.End]) != "foo" {
			t.Errorf("match = %+v", m)
		}
	}
	if r.Files[1].Matches[0].Line != 2 || r.Files[1].Matches[0].Text != "Foo bar" {
		t.Errorf("CRLF / case-insensitive: %+v", r.Files[1].Matches)
	}
	r, _ = ws.Grep(GrepQuery{Pattern: "foo", CaseSensitive: true})
	if r.Total != 2 {
		t.Errorf("case sensitive total = %d", r.Total)
	}
	r, _ = ws.Grep(GrepQuery{Pattern: `^#\s`, Regex: true})
	if r.Total != 1 {
		t.Errorf("regex total = %d", r.Total)
	}
	if _, err := ws.Grep(GrepQuery{Pattern: "(", Regex: true}); err == nil {
		t.Error("invalid regex should fail")
	}
}

func TestSnippetUTF16(t *testing.T) {
	s := "😀😀 hit"
	m := snippet(s, len("😀😀 "), len(s), 1)
	if m.Start != 5 || m.End != 8 {
		t.Errorf("utf16 offsets = %d..%d", m.Start, m.End)
	}
}
