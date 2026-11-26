package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu   sync.Mutex
	docs []string
	list int
}

func (r *recorder) doc(p string) { r.mu.Lock(); r.docs = append(r.docs, p); r.mu.Unlock() }
func (r *recorder) lst()         { r.mu.Lock(); r.list++; r.mu.Unlock() }

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestOpenFileReloadBaseline(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.md")
	write(t, p, "one")
	r := &recorder{}
	ws, err := New(r.doc, r.lst)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()

	got, err := ws.OpenFile(p)
	if err != nil || got != Canonical(p) {
		t.Fatalf("OpenFile = %q, %v", got, err)
	}
	write(t, p, "two")
	waitFor(t, "doc change", func() bool {
		c, _ := ws.Get(p)
		return string(c.Current) == "two"
	})
	c, _ := ws.Get(p)
	if string(c.Initial) != "one" || string(c.Baseline) != "one" {
		t.Errorf("initial/baseline = %q/%q", c.Initial, c.Baseline)
	}
	ws.SetBaseline(p)
	c, _ = ws.Get(p)
	if string(c.Baseline) != "two" || string(c.Initial) != "one" {
		t.Errorf("after SetBaseline: %q/%q", c.Initial, c.Baseline)
	}

	os.Remove(p)
	waitFor(t, "missing", func() bool { c, _ := ws.Get(p); return c.Missing })
	write(t, p, "three")
	waitFor(t, "recreated", func() bool { c, _ := ws.Get(p); return !c.Missing && string(c.Current) == "three" })
}

func TestFolderWatch(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "a.md"), "a")
	write(t, filepath.Join(dir, "sub", "b.markdown"), "b")
	write(t, filepath.Join(dir, "x.txt"), "x")
	write(t, filepath.Join(dir, "node_modules", "n.md"), "n")
	write(t, filepath.Join(dir, ".git", "g.md"), "g")
	r := &recorder{}
	ws, err := New(r.doc, r.lst)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_, files, err := ws.OpenFolder(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("files = %v", files)
	}
	has := func(name string) bool {
		for _, f := range ws.Snapshot().Files {
			if f.Name == name {
				return true
			}
		}
		return false
	}
	// new file in a new sub directory
	write(t, filepath.Join(dir, "new", "deep", "c.md"), "c")
	waitFor(t, "c.md added", func() bool { return has("c.md") })
	write(t, filepath.Join(dir, "new", "deep", "d.md"), "d")
	waitFor(t, "d.md added", func() bool { return has("d.md") })
	os.Remove(filepath.Join(dir, "a.md"))
	waitFor(t, "a.md removed", func() bool { return !has("a.md") })
	// writing a listed but not loaded file is reported
	sub := filepath.Join(dir, "sub", "b.markdown")
	write(t, sub, "changed")
	waitFor(t, "change notification", func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		for _, d := range r.docs {
			if d == Canonical(sub) {
				return true
			}
		}
		return false
	})

	s := ws.Snapshot()
	if len(s.Folders) != 1 || s.Files[0].Root != Canonical(dir) {
		t.Errorf("snapshot = %+v", s)
	}
}

func TestSnapshotSorted(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "b", "z.md"), "")
	write(t, filepath.Join(dir, "a", "y.md"), "")
	write(t, filepath.Join(dir, "a", "X.md"), "")
	ws, _ := New(nil, nil)
	defer ws.Close()
	for _, p := range []string{"b/z.md", "a/y.md", "a/X.md"} {
		if _, err := ws.OpenFile(filepath.Join(dir, p)); err != nil {
			t.Fatal(err)
		}
	}
	var names []string
	for _, f := range ws.Snapshot().Files {
		names = append(names, f.Name)
	}
	if want := "X.md y.md z.md"; join(names) != want {
		t.Errorf("order = %v", names)
	}
}

func TestKindsAndText(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "a.md"), "")
	write(t, filepath.Join(dir, "b.markdown"), "")
	write(t, filepath.Join(dir, "c.mdown"), "")
	write(t, filepath.Join(dir, "d.TXT"), "\x93\xfa\x96\x7b\x8c\xea") // 日本語 in Shift_JIS
	write(t, filepath.Join(dir, "e.log"), "")
	write(t, filepath.Join(dir, "f.txt"), "bin\x00ary")
	ws, _ := New(nil, nil)
	defer ws.Close()

	if _, err := ws.OpenFile(filepath.Join(dir, "d.TXT")); !errors.Is(err, ErrUnsupported) {
		t.Errorf("text files are unsupported until enabled: %v", err)
	}
	ws.SetTextExtensions([]string{".txt"})
	if _, err := ws.OpenFile(filepath.Join(dir, "c.mdown")); !errors.Is(err, ErrUnsupported) {
		t.Errorf(".mdown should be unsupported: %v", err)
	}
	if _, err := ws.OpenFile(filepath.Join(dir, "f.txt")); err == nil {
		t.Error("binary file should be refused")
	}
	p, err := ws.OpenFile(filepath.Join(dir, "d.TXT"))
	if err != nil {
		t.Fatal(err)
	}
	if c, _ := ws.Get(p); string(c.Current) != "日本語" {
		t.Errorf("Shift_JIS not decoded: %q", c.Current)
	}
	if ws.Kind(p) != KindText || ws.Kind("x.Markdown") != KindMarkdown || ws.Kind("x.log") != "" {
		t.Error("Kind")
	}

	_, files, err := ws.OpenFolder(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range files {
		names = append(names, filepath.Base(f))
	}
	if want := "a.md b.markdown d.TXT f.txt"; join(names) != want {
		t.Errorf("folder files = %v", names)
	}
	ws.SetTextExtensions([]string{".log"})
	names = nil
	for _, f := range ws.Snapshot().Files {
		if f.Root != "" {
			names = append(names, f.Name)
		}
	}
	if want := "a.md b.markdown e.log"; join(names) != want {
		t.Errorf("after changing the text extensions = %v", names)
	}
}

func join(s []string) string {
	out := ""
	for i, v := range s {
		if i > 0 {
			out += " "
		}
		out += v
	}
	return out
}
