package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// EvRecentChanged is emitted with RecentList when the list changes.
const EvRecentChanged = "recent:changed"

const (
	recentFileName = "recent.json"
	recentMax      = 10
)

// RecentList holds the recently opened files and folders, newest first.
type RecentList struct {
	Files   []string `json:"files"`
	Folders []string `json:"folders"`
}

func (r *RecentList) normalize() {
	if r.Files == nil {
		r.Files = []string{}
	}
	if r.Folders == nil {
		r.Folders = []string{}
	}
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// pushRecent moves (or adds) paths to the front of list, keeping at most recentMax.
// paths are in opening order; the last one ends up first.
func pushRecent(list []string, paths ...string) []string {
	for _, p := range paths {
		out := []string{p}
		for _, q := range list {
			if !samePath(p, q) {
				out = append(out, q)
			}
		}
		list = out
	}
	if len(list) > recentMax {
		list = list[:recentMax]
	}
	return list
}

func dropRecent(list []string, p string) ([]string, bool) {
	out := list[:0:0]
	found := false
	for _, q := range list {
		if samePath(p, q) {
			found = true
			continue
		}
		out = append(out, q)
	}
	return out, found
}

func loadRecent(path string) RecentList {
	var r RecentList
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &r)
	}
	r.normalize()
	if len(r.Files) > recentMax {
		r.Files = r.Files[:recentMax]
	}
	if len(r.Folders) > recentMax {
		r.Folders = r.Folders[:recentMax]
	}
	return r
}

func saveRecent(path string, r RecentList) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func (a *App) recentPath() string {
	if a.settingsPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(a.settingsPath), recentFileName)
}

// recordRecent adds what OpenPaths opened to the recent lists.
func (a *App) recordRecent(res OpenResult) {
	if len(res.Files) == 0 && len(res.Folders) == 0 {
		return
	}
	a.mu.Lock()
	a.recent.Files = pushRecent(a.recent.Files, res.Files...)
	a.recent.Folders = pushRecent(a.recent.Folders, res.Folders...)
	r, path := a.recentCopy(), a.recentPath()
	a.mu.Unlock()
	_ = saveRecent(path, r)
	a.emitRecent(r)
}

func (a *App) recentCopy() RecentList {
	return RecentList{
		Files:   append([]string{}, a.recent.Files...),
		Folders: append([]string{}, a.recent.Folders...),
	}
}

func (a *App) emitRecent(r RecentList) {
	if a.app != nil {
		a.app.Event.Emit(EvRecentChanged, r)
	}
}

// Recent returns the recently opened files and folders, newest first.
func (a *App) Recent() RecentList {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.recentCopy()
}

// OpenRecent opens an entry of the recent lists. An entry that no longer
// exists is removed from the lists.
func (a *App) OpenRecent(path string) (OpenResult, error) {
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		a.mu.Lock()
		var f1, f2 bool
		a.recent.Files, f1 = dropRecent(a.recent.Files, path)
		a.recent.Folders, f2 = dropRecent(a.recent.Folders, path)
		r, rp := a.recentCopy(), a.recentPath()
		a.mu.Unlock()
		if f1 || f2 {
			_ = saveRecent(rp, r)
			a.emitRecent(r)
		}
		return OpenResult{}, errors.New("not found (removed from the recent list): " + path)
	}
	return a.OpenPaths([]string{path}), nil
}
