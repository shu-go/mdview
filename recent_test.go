package main

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPushRecent(t *testing.T) {
	l := pushRecent(nil, "a", "b")
	if !reflect.DeepEqual(l, []string{"b", "a"}) {
		t.Fatalf("got %v", l)
	}
	l = pushRecent(l, "a")
	if !reflect.DeepEqual(l, []string{"a", "b"}) {
		t.Fatalf("moved to front: got %v", l)
	}
	for i := range 15 {
		l = pushRecent(l, fmt.Sprint(i))
	}
	if len(l) != recentMax || l[0] != "14" || l[recentMax-1] != "5" {
		t.Fatalf("limit: got %v", l)
	}
}

func TestDropRecent(t *testing.T) {
	l, found := dropRecent([]string{"a", "b", "c"}, "b")
	if !found || !reflect.DeepEqual(l, []string{"a", "c"}) {
		t.Fatalf("got %v %v", l, found)
	}
	if _, found := dropRecent(l, "x"); found {
		t.Fatal("found missing entry")
	}
}

func TestOpenRecentMissing(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "gone.md")
	a := &App{settingsPath: filepath.Join(dir, "mdview.json")}
	a.recent = RecentList{Files: []string{missing, "x.md"}, Folders: []string{}}
	if _, err := a.OpenRecent(missing); err == nil {
		t.Fatal("no error for a missing entry")
	}
	if got := a.Recent().Files; !reflect.DeepEqual(got, []string{"x.md"}) {
		t.Fatalf("not removed: %v", got)
	}
	if got := loadRecent(a.recentPath()).Files; !reflect.DeepEqual(got, []string{"x.md"}) {
		t.Fatalf("not saved: %v", got)
	}
}
