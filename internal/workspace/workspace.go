// Package workspace manages the documents and folders opened in mdview,
// shared by all windows: file contents (initial / baseline / current), the
// file list shown in the sidebar, and file system watching.
package workspace

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Debounce is the delay between a file system event and its handling.
var Debounce = 120 * time.Millisecond

var mdExts = map[string]bool{".md": true, ".markdown": true, ".mdown": true, ".mkd": true, ".mkdn": true, ".mdwn": true}

// IsMarkdown reports whether path has a Markdown file extension.
func IsMarkdown(path string) bool {
	return mdExts[strings.ToLower(filepath.Ext(path))]
}

// skipDir reports whether a directory is skipped while scanning folders.
func skipDir(name string) bool {
	return name == "node_modules" || (strings.HasPrefix(name, ".") && len(name) > 1)
}

// FileItem is an entry of the sidebar file list.
type FileItem struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Dir     string `json:"dir"`
	Root    string `json:"root"` // folder the file was found in, "" for opened files
	Missing bool   `json:"missing"`
}

// Snapshot is the shared file list.
type Snapshot struct {
	Folders []string   `json:"folders"`
	Files   []FileItem `json:"files"`
}

// Contents are the versions of a document.
type Contents struct {
	Initial  []byte
	Baseline []byte
	Current  []byte
	Missing  bool
	Version  int
}

type doc struct {
	path     string
	initial  []byte
	baseline []byte
	current  []byte
	missing  bool
	version  int
}

// Workspace is safe for concurrent use.
type Workspace struct {
	mu          sync.Mutex
	docs        map[string]*doc
	files       map[string]bool            // explicitly opened files
	folders     map[string]map[string]bool // folder -> markdown files found in it
	watcher     *fsnotify.Watcher
	watched     map[string]bool
	timers      map[string]*time.Timer
	onDoc       func(path string)
	onList      func()
	closed      bool
	watchErrors int
}

// New creates a workspace. onDocChanged is called (from a background
// goroutine) when a loaded document changes on disk; onListChanged when the
// file list changes.
func New(onDocChanged func(path string), onListChanged func()) (*Workspace, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	ws := &Workspace{
		docs:    map[string]*doc{},
		files:   map[string]bool{},
		folders: map[string]map[string]bool{},
		watcher: w,
		watched: map[string]bool{},
		timers:  map[string]*time.Timer{},
		onDoc:   onDocChanged,
		onList:  onListChanged,
	}
	if ws.onDoc == nil {
		ws.onDoc = func(string) {}
	}
	if ws.onList == nil {
		ws.onList = func() {}
	}
	go ws.loop()
	return ws, nil
}

// Close stops watching.
func (ws *Workspace) Close() error {
	ws.mu.Lock()
	ws.closed = true
	for _, t := range ws.timers {
		t.Stop()
	}
	ws.mu.Unlock()
	return ws.watcher.Close()
}

// Canonical returns the cleaned absolute form of path.
func Canonical(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	return filepath.Clean(path)
}

// OpenFile adds a file to the list and loads it.
func (ws *Workspace) OpenFile(path string) (string, error) {
	path = Canonical(path)
	st, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", errors.New("is a directory: " + path)
	}
	ws.mu.Lock()
	_, err = ws.loadLocked(path)
	added := !ws.files[path]
	ws.files[path] = true
	ws.refreshWatchesLocked()
	ws.mu.Unlock()
	if err != nil {
		return "", err
	}
	if added {
		ws.onList()
	}
	return path, nil
}

// OpenFolder adds a folder (scanned recursively, watched for new files) and
// returns the Markdown files found in it, sorted.
func (ws *Workspace) OpenFolder(path string) (string, []string, error) {
	path = Canonical(path)
	st, err := os.Stat(path)
	if err != nil {
		return "", nil, err
	}
	if !st.IsDir() {
		return "", nil, errors.New("not a directory: " + path)
	}
	found := scanFolder(path)
	ws.mu.Lock()
	ws.folders[path] = found
	ws.refreshWatchesLocked()
	ws.mu.Unlock()
	ws.onList()
	files := make([]string, 0, len(found))
	for f := range found {
		files = append(files, f)
	}
	sort.Strings(files)
	return path, files, nil
}

// Remove removes a file or folder from the list.
func (ws *Workspace) Remove(path string) {
	path = Canonical(path)
	ws.mu.Lock()
	delete(ws.files, path)
	delete(ws.folders, path)
	ws.refreshWatchesLocked()
	ws.mu.Unlock()
	ws.onList()
}

// Snapshot returns the file list: opened files plus files found in folders,
// sorted by directory then name.
func (ws *Workspace) Snapshot() Snapshot {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	seen := map[string]bool{}
	s := Snapshot{Folders: []string{}, Files: []FileItem{}}
	add := func(p, root string) {
		if seen[p] {
			return
		}
		seen[p] = true
		item := FileItem{Path: p, Name: filepath.Base(p), Dir: filepath.Dir(p), Root: root}
		if d, ok := ws.docs[p]; ok {
			item.Missing = d.missing
		}
		s.Files = append(s.Files, item)
	}
	folders := make([]string, 0, len(ws.folders))
	for f := range ws.folders {
		folders = append(folders, f)
	}
	sort.Strings(folders)
	s.Folders = folders
	for _, f := range folders {
		for p := range ws.folders[f] {
			add(p, f)
		}
	}
	for p := range ws.files {
		add(p, "")
	}
	sort.Slice(s.Files, func(i, j int) bool {
		a, b := s.Files[i], s.Files[j]
		if a.Dir != b.Dir {
			return strings.ToLower(a.Dir) < strings.ToLower(b.Dir)
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return s
}

// Get returns the contents of a document, loading it if needed.
func (ws *Workspace) Get(path string) (Contents, error) {
	path = Canonical(path)
	ws.mu.Lock()
	defer ws.mu.Unlock()
	d, err := ws.loadLocked(path)
	if err != nil {
		return Contents{}, err
	}
	ws.refreshWatchesLocked()
	return Contents{Initial: d.initial, Baseline: d.baseline, Current: d.current, Missing: d.missing, Version: d.version}, nil
}

// SetBaseline makes the current content the diff baseline of a document.
func (ws *Workspace) SetBaseline(path string) {
	path = Canonical(path)
	ws.mu.Lock()
	if d, ok := ws.docs[path]; ok {
		d.baseline = d.current
		d.version++
	}
	ws.mu.Unlock()
	ws.onDoc(path)
}

// Reload re-reads a document from disk now.
func (ws *Workspace) Reload(path string) {
	ws.reload(Canonical(path))
}

func (ws *Workspace) loadLocked(path string) (*doc, error) {
	if d, ok := ws.docs[path]; ok {
		return d, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	d := &doc{path: path, initial: b, baseline: b, current: b}
	ws.docs[path] = d
	return d, nil
}

func scanFolder(root string) map[string]bool {
	found := map[string]bool{}
	_ = filepath.WalkDir(root, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			if e != nil && e.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if e.IsDir() {
			if p != root && skipDir(e.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if IsMarkdown(p) {
			found[p] = true
		}
		return nil
	})
	return found
}

func folderDirs(root string) []string {
	var dirs []string
	_ = filepath.WalkDir(root, func(p string, e fs.DirEntry, err error) error {
		if err != nil || !e.IsDir() {
			if err != nil && e != nil && e.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if p != root && skipDir(e.Name()) {
			return filepath.SkipDir
		}
		dirs = append(dirs, p)
		return nil
	})
	return dirs
}

// refreshWatchesLocked makes the watched directory set match what is needed:
// the directories of loaded documents and all directories under folders.
func (ws *Workspace) refreshWatchesLocked() {
	if ws.closed {
		return
	}
	want := map[string]bool{}
	for p := range ws.docs {
		want[filepath.Dir(p)] = true
	}
	for p := range ws.files {
		want[filepath.Dir(p)] = true
	}
	for f := range ws.folders {
		for _, d := range folderDirs(f) {
			want[d] = true
		}
	}
	for d := range ws.watched {
		if !want[d] {
			_ = ws.watcher.Remove(d)
			delete(ws.watched, d)
		}
	}
	for d := range want {
		if !ws.watched[d] {
			if err := ws.watcher.Add(d); err == nil {
				ws.watched[d] = true
			} else {
				ws.watchErrors++
			}
		}
	}
}

func (ws *Workspace) loop() {
	for {
		select {
		case ev, ok := <-ws.watcher.Events:
			if !ok {
				return
			}
			ws.handle(ev)
		case _, ok := <-ws.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

func (ws *Workspace) schedule(key string, f func()) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return
	}
	if t, ok := ws.timers[key]; ok {
		t.Stop()
	}
	ws.timers[key] = time.AfterFunc(Debounce, func() {
		ws.mu.Lock()
		delete(ws.timers, key)
		ws.mu.Unlock()
		f()
	})
}

func (ws *Workspace) handle(ev fsnotify.Event) {
	path := filepath.Clean(ev.Name)
	ws.mu.Lock()
	_, isDoc := ws.docs[path]
	var roots []string
	for f := range ws.folders {
		if path == f || strings.HasPrefix(path, f+string(filepath.Separator)) {
			roots = append(roots, f)
		}
	}
	ws.mu.Unlock()

	if isDoc {
		ws.schedule("doc:"+path, func() { ws.reload(path) })
	} else if len(roots) > 0 && IsMarkdown(path) && (ev.Has(fsnotify.Write) || ev.Has(fsnotify.Create)) {
		// not loaded, but listed: content consumers (grep) need to know
		ws.schedule("doc:"+path, func() { ws.onDoc(path) })
	}
	// Folder membership changes on create/remove/rename (files or directories).
	if len(roots) > 0 && (ev.Has(fsnotify.Create) || ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename)) {
		for _, r := range roots {
			r := r
			ws.schedule("folder:"+r, func() { ws.rescan(r) })
		}
	}
}

func (ws *Workspace) reload(path string) {
	b, err := os.ReadFile(path)
	ws.mu.Lock()
	d, ok := ws.docs[path]
	if !ok {
		ws.mu.Unlock()
		return
	}
	changed := false
	listChanged := false
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) && !d.missing {
			d.missing = true
			d.version++
			changed, listChanged = true, true
		}
	} else {
		if d.missing {
			d.missing = false
			listChanged = true
			changed = true
		}
		if !bytes.Equal(b, d.current) {
			d.current = b
			changed = true
		}
		if changed {
			d.version++
		}
	}
	ws.mu.Unlock()
	if changed {
		ws.onDoc(path)
	}
	if listChanged {
		ws.onList()
	}
}

func (ws *Workspace) rescan(root string) {
	found := scanFolder(root)
	ws.mu.Lock()
	old, ok := ws.folders[root]
	if !ok {
		ws.mu.Unlock()
		return
	}
	same := len(old) == len(found)
	if same {
		for p := range found {
			if !old[p] {
				same = false
				break
			}
		}
	}
	ws.folders[root] = found
	ws.refreshWatchesLocked()
	ws.mu.Unlock()
	if !same {
		ws.onList()
	}
}
