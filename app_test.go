package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/shu-go/mdview/internal/workspace"
)

func TestIsUNC(t *testing.T) {
	if runtime.GOOS != "windows" {
		if !isUNC("//server/share") || isUNC("/home/x.png") {
			t.Error("unix")
		}
		return
	}
	for _, p := range []string{`\\server\share\a.png`, `//server/share/a.png`, `\/server/share/a.png`, `/\server\share`, `\\?\UNC\server\share`, `\\.\pipe\x`, `\\?\C:\a.png`} {
		if !isUNC(p) {
			t.Errorf("%s should be rejected", p)
		}
	}
	for _, p := range []string{`C:\a\b.png`, `c:/a/b.png`} {
		if isUNC(p) {
			t.Errorf("%s should be accepted", p)
		}
	}
}

func TestOpenLinkRefusesNetworkPaths(t *testing.T) {
	a := &App{} // the checks run before the workspace is used
	paths := []string{"", "relative.md", "//server/share/a.md"}
	if runtime.GOOS == "windows" {
		paths = append(paths, `\\server\share\a.md`, `\/server/share/a.md`, `/\server\share\a.md`, `\\?\UNC\server\share\a.md`)
	}
	for _, p := range paths {
		if _, err := a.OpenLink(p); err == nil {
			t.Errorf("%q should be refused", p)
		}
		if _, err := a.Preview(p); err == nil {
			t.Errorf("preview of %q should be refused", p)
		}
	}
}

func TestOpenPathsBinary(t *testing.T) {
	ws, err := workspace.New(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	a := &App{ws: ws}
	dir := t.TempDir()
	bin := filepath.Join(dir, "a.pdf")
	txt := filepath.Join(dir, "notes.cfg")
	os.WriteFile(bin, []byte("%PDF-1.7\n\x00\x01"), 0o644)
	os.WriteFile(txt, []byte("key = value"), 0o644)
	res := a.OpenPaths([]string{bin, txt})
	if len(res.Binary) != 1 || res.Binary[0] != bin || len(res.Errors) != 1 {
		t.Errorf("binary file should be refused and reported: %+v", res)
	}
	if len(res.Files) != 1 || filepath.Base(res.Files[0]) != "notes.cfg" {
		t.Errorf("any other file opens as text: %+v", res)
	}
	if _, err := a.Preview(bin); !errors.Is(err, workspace.ErrBinary) {
		t.Errorf("preview of a binary file: %v", err)
	}
}

func TestFileMiddleware(t *testing.T) {
	dir := t.TempDir()
	img := filepath.Join(dir, "a.png")
	txt := filepath.Join(dir, "secret.txt")
	os.WriteFile(img, []byte("PNG"), 0o644)
	os.WriteFile(txt, []byte("secret"), 0o644)
	h := fileMiddleware(http.NotFoundHandler())
	get := func(p string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/_mdv/file?p="+url.QueryEscape(p), nil))
		return rec.Code
	}
	if c := get(img); c != 200 {
		t.Errorf("image: %d", c)
	}
	if c := get(txt); c != http.StatusForbidden {
		t.Errorf("text file: %d", c)
	}
	noext := filepath.Join(dir, "imagefile")
	os.WriteFile(noext, []byte("\x89PNG\r\n\x1a\n0000"), 0o644)
	if c := get(noext); c != 200 {
		t.Errorf("png without extension: %d", c)
	}
	if c := get("rel/a.png"); c != http.StatusForbidden {
		t.Errorf("relative: %d", c)
	}
}
