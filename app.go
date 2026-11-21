package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/shu-go/mdview/internal/markdown"
	"github.com/shu-go/mdview/internal/workspace"
)

// Event names (Go -> frontend).
const (
	EvDocChanged      = "doc:changed"      // string path
	EvFilesChanged    = "files:changed"    // workspace.Snapshot
	EvSettingsChanged = "settings:changed" // Settings
	EvCustomCSS       = "customcss:changed"
	EvOpenPaths       = "open:paths"  // OpenPathsEvent, targeted
	EvTabReceive      = "tab:receive" // TabReceiveEvent, targeted
	EvTabAdopted      = "tab:adopted" // TabAdoptedEvent, targeted
)

// TabState describes a tab moved between windows.
type TabState struct {
	Path     string  `json:"path"`
	DiffMode string  `json:"diffMode"`
	Scroll   float64 `json:"scroll"`
}

// OpenPathsEvent asks a window to open paths.
type OpenPathsEvent struct {
	Target uint     `json:"target"`
	Paths  []string `json:"paths"`
}

// TabReceiveEvent asks a window to adopt a tab dropped at a screen position.
type TabReceiveEvent struct {
	Target uint     `json:"target"`
	Tab    TabState `json:"tab"`
	X      int      `json:"x"` // screen DIP
	Y      int      `json:"y"`
}

// InitState is returned to a window when its frontend starts.
type InitState struct {
	WindowID uint               `json:"windowId"`
	Platform string             `json:"platform"`
	Settings Settings           `json:"settings"`
	Files    workspace.Snapshot `json:"files"`
	Paths    []string           `json:"paths"` // paths to open (command line)
	Tabs     []TabState         `json:"tabs"`  // tabs to adopt (detached)
}

// RenderResult is a rendered document.
type RenderResult struct {
	Path     string             `json:"path"`
	HTML     string             `json:"html"`
	Headings []markdown.Heading `json:"headings"`
	Changes  int                `json:"changes"`
	Missing  bool               `json:"missing"`
	Version  int                `json:"version"`
}

// OpenResult tells the frontend what OpenPaths did.
type OpenResult struct {
	Files   []string `json:"files"`   // files to open as tabs
	Folders []string `json:"folders"` // folders added to the list
	Errors  []string `json:"errors"`
}

// App is the service bound to the frontend.
type App struct {
	app *application.App
	ws  *workspace.Workspace

	mu           sync.Mutex
	settings     Settings
	settingsPath string
	lastActive   uint
	pendingPaths map[uint][]string
	pendingTabs  map[uint][]TabState
	cssStamp     time.Time
}

// NewApp creates the service.
func NewApp() *App {
	s, p := loadSettings()
	return &App{
		settings:     s,
		settingsPath: p,
		pendingPaths: map[uint][]string{},
		pendingTabs:  map[uint][]TabState{},
	}
}

// ServiceStartup implements application.ServiceStartup.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.app = application.Get()
	ws, err := workspace.New(
		func(p string) { a.app.Event.Emit(EvDocChanged, p) },
		func() { a.app.Event.Emit(EvFilesChanged, a.ws.Snapshot()) },
	)
	if err != nil {
		return err
	}
	a.ws = ws
	go a.watchCustomCSS(ctx)
	return nil
}

// ServiceShutdown implements application.ServiceShutdown.
func (a *App) ServiceShutdown() error {
	if a.ws != nil {
		return a.ws.Close()
	}
	return nil
}

func callerWindow(ctx context.Context) application.Window {
	if w, ok := ctx.Value(application.WindowKey).(application.Window); ok {
		return w
	}
	return nil
}

// NewWindow creates a window. paths are opened, tabs adopted, once its
// frontend calls Init. bounds (DIP) positions it when non-nil.
func (a *App) newWindow(paths []string, tabs []TabState, bounds *application.Rect) *application.WebviewWindow {
	opts := application.WebviewWindowOptions{
		Title:            "mdview",
		Width:            1100,
		Height:           780,
		MinWidth:         360,
		MinHeight:        240,
		EnableFileDrop:   true,
		URL:              "/",
		BackgroundColour: application.NewRGB(32, 33, 36),
	}
	if bounds != nil {
		opts.Hidden = true
	}
	w := a.app.Window.NewWithOptions(opts)
	id := w.ID()
	a.mu.Lock()
	if len(paths) > 0 {
		a.pendingPaths[id] = paths
	}
	if len(tabs) > 0 {
		a.pendingTabs[id] = tabs
	}
	if a.lastActive == 0 {
		a.lastActive = id
	}
	a.mu.Unlock()

	w.OnWindowEvent(events.Common.WindowFocus, func(*application.WindowEvent) {
		a.mu.Lock()
		a.lastActive = id
		a.mu.Unlock()
	})
	w.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		files := e.Context().DroppedFiles()
		if len(files) > 0 {
			a.app.Event.Emit(EvOpenPaths, OpenPathsEvent{Target: id, Paths: files})
		}
	})
	w.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		a.mu.Lock()
		delete(a.pendingPaths, id)
		delete(a.pendingTabs, id)
		if a.lastActive == id {
			a.lastActive = 0
		}
		a.mu.Unlock()
	})
	if bounds != nil {
		w.SetBounds(*bounds)
		w.Show()
		w.Focus()
	}
	return w
}

// windowsExcept returns the live webview windows other than id.
func (a *App) windowsExcept(id uint) []*application.WebviewWindow {
	var ws []*application.WebviewWindow
	for _, w := range a.app.Window.GetAll() {
		if ww, ok := w.(*application.WebviewWindow); ok && ww.ID() != id {
			ws = append(ws, ww)
		}
	}
	sort.Slice(ws, func(i, j int) bool { return ws[i].ID() < ws[j].ID() })
	return ws
}

// targetWindow returns the window that should open files from outside: the
// last active one, or any.
func (a *App) targetWindow() *application.WebviewWindow {
	a.mu.Lock()
	id := a.lastActive
	a.mu.Unlock()
	if w, ok := a.app.Window.GetByID(id); ok {
		if ww, ok := w.(*application.WebviewWindow); ok {
			return ww
		}
	}
	if all := a.windowsExcept(0); len(all) > 0 {
		return all[len(all)-1]
	}
	return nil
}

// raise brings a window to the front. Plain Focus() often only flashes the
// taskbar button on Windows (foreground lock), so cycle minimise/restore.
func raise(w *application.WebviewWindow) {
	w.Show()
	if runtime.GOOS == "windows" {
		w.Minimise()
		w.UnMinimise()
	} else if w.IsMinimised() {
		w.UnMinimise()
	}
	w.Focus()
}

// HandleSecondInstance opens the paths of a second launch in the last active window.
func (a *App) HandleSecondInstance(data application.SecondInstanceData) {
	paths := argPaths(data.Args, data.WorkingDir)
	w := a.targetWindow()
	if w == nil {
		a.newWindow(paths, nil, nil)
		return
	}
	raise(w)
	if len(paths) > 0 {
		a.app.Event.Emit(EvOpenPaths, OpenPathsEvent{Target: w.ID(), Paths: paths})
	}
}

// argPaths turns command line arguments into absolute paths.
func argPaths(args []string, wd string) []string {
	var paths []string
	for i, arg := range args {
		if i == 0 || arg == "" || arg[0] == '-' {
			continue
		}
		if !filepath.IsAbs(arg) && wd != "" {
			arg = filepath.Join(wd, arg)
		}
		paths = append(paths, arg)
	}
	return paths
}

// ---- bound methods ----

// Init returns the initial state of the calling window.
func (a *App) Init(ctx context.Context) InitState {
	st := InitState{Platform: runtime.GOOS, Files: a.ws.Snapshot(), Paths: []string{}, Tabs: []TabState{}}
	a.mu.Lock()
	st.Settings = a.settings
	if w := callerWindow(ctx); w != nil {
		st.WindowID = w.ID()
		if p, ok := a.pendingPaths[w.ID()]; ok {
			st.Paths = p
			delete(a.pendingPaths, w.ID())
		}
		if t, ok := a.pendingTabs[w.ID()]; ok {
			st.Tabs = t
			delete(a.pendingTabs, w.ID())
		}
	}
	a.mu.Unlock()
	return st
}

// NotifyFocus records the calling window as the last active one.
func (a *App) NotifyFocus(ctx context.Context) {
	if w := callerWindow(ctx); w != nil {
		a.mu.Lock()
		a.lastActive = w.ID()
		a.mu.Unlock()
	}
}

// OpenPaths adds files and folders to the workspace.
func (a *App) OpenPaths(paths []string) OpenResult {
	res := OpenResult{Files: []string{}, Folders: []string{}, Errors: []string{}}
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil {
			res.Errors = append(res.Errors, err.Error())
			continue
		}
		if st.IsDir() {
			f, _, err := a.ws.OpenFolder(p)
			if err != nil {
				res.Errors = append(res.Errors, err.Error())
				continue
			}
			res.Folders = append(res.Folders, f)
			continue
		}
		f, err := a.ws.OpenFile(p)
		if err != nil {
			res.Errors = append(res.Errors, err.Error())
			continue
		}
		res.Files = append(res.Files, f)
	}
	return res
}

var mdFilter = []application.FileFilter{
	{DisplayName: "Markdown", Pattern: "*.md;*.markdown;*.mdown;*.mkd;*.mkdn;*.mdwn"},
	{DisplayName: "All files", Pattern: "*.*"},
}

// OpenFileDialog lets the user choose files and opens them.
func (a *App) OpenFileDialog(ctx context.Context) (OpenResult, error) {
	d := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:                   "Open Markdown files",
		CanChooseFiles:          true,
		AllowsMultipleSelection: true,
		Filters:                 mdFilter,
	})
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		d.AttachToWindow(w)
	}
	files, err := d.PromptForMultipleSelection()
	if err != nil {
		return OpenResult{}, err
	}
	return a.OpenPaths(files), nil
}

// OpenFolderDialog lets the user choose a folder and adds it.
func (a *App) OpenFolderDialog(ctx context.Context) (OpenResult, error) {
	d := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:                "Open folder",
		CanChooseDirectories: true,
		CanChooseFiles:       false,
	})
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		d.AttachToWindow(w)
	}
	dir, err := d.PromptForSingleSelection()
	if err != nil || dir == "" {
		return OpenResult{Files: []string{}, Folders: []string{}, Errors: []string{}}, err
	}
	return a.OpenPaths([]string{dir}), nil
}

// Files returns the shared file list.
func (a *App) Files() workspace.Snapshot { return a.ws.Snapshot() }

// RemoveFromList removes a file or folder from the shared list.
func (a *App) RemoveFromList(path string) { a.ws.Remove(path) }

// Render renders a document. mode is "off", "initial" or "baseline".
func (a *App) Render(path string, mode string) (RenderResult, error) {
	c, err := a.ws.Get(path)
	if err != nil {
		return RenderResult{}, err
	}
	path = workspace.Canonical(path)
	var r markdown.Result
	switch mode {
	case "initial":
		r = markdown.RenderDiff(c.Initial, c.Current, path)
	case "baseline":
		r = markdown.RenderDiff(c.Baseline, c.Current, path)
	default:
		r = markdown.Render(c.Current, path)
	}
	return RenderResult{Path: path, HTML: r.HTML, Headings: r.Headings, Changes: r.Changes, Missing: c.Missing, Version: c.Version}, nil
}

// SetBaseline makes the current content the diff baseline.
func (a *App) SetBaseline(path string) { a.ws.SetBaseline(path) }

// Reload re-reads a document from disk.
func (a *App) Reload(path string) { a.ws.Reload(path) }

// GetSettings returns the settings.
func (a *App) GetSettings() Settings {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.settings
}

// SaveSettings stores the settings and broadcasts them to all windows.
func (a *App) SaveSettings(s Settings) (Settings, error) {
	s.normalize()
	a.mu.Lock()
	a.settings = s
	path := a.settingsPath
	a.cssStamp = time.Time{}
	a.mu.Unlock()
	err := saveSettings(path, s)
	a.app.Event.Emit(EvSettingsChanged, s)
	a.emitCustomCSS()
	return s, err
}

// SettingsPath returns where the settings are stored.
func (a *App) SettingsPath() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.settingsPath
}

// CustomCSS returns the user stylesheet ("" when none).
func (a *App) CustomCSS() string {
	a.mu.Lock()
	p := a.settings.CustomCSSPath
	a.mu.Unlock()
	if p == "" {
		return ""
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(b)
}

func (a *App) emitCustomCSS() { a.app.Event.Emit(EvCustomCSS, a.CustomCSS()) }

// watchCustomCSS polls the user stylesheet and pushes it on change.
func (a *App) watchCustomCSS(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		a.mu.Lock()
		p := a.settings.CustomCSSPath
		stamp := a.cssStamp
		a.mu.Unlock()
		if p == "" {
			continue
		}
		st, err := os.Stat(p)
		if err != nil || st.ModTime().Equal(stamp) {
			continue
		}
		a.mu.Lock()
		first := a.cssStamp.IsZero()
		a.cssStamp = st.ModTime()
		a.mu.Unlock()
		if !first {
			a.emitCustomCSS()
		}
	}
}

// ChooseCSSFile lets the user pick a stylesheet.
func (a *App) ChooseCSSFile(ctx context.Context) (string, error) {
	d := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:          "Choose a stylesheet",
		CanChooseFiles: true,
		Filters:        []application.FileFilter{{DisplayName: "CSS", Pattern: "*.css"}, {DisplayName: "All files", Pattern: "*.*"}},
	})
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		d.AttachToWindow(w)
	}
	return d.PromptForSingleSelection()
}

// ChooseEditor lets the user pick an editor executable and returns a command template.
func (a *App) ChooseEditor(ctx context.Context) (string, error) {
	d := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:          "Choose an editor",
		CanChooseFiles: true,
	})
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		d.AttachToWindow(w)
	}
	p, err := d.PromptForSingleSelection()
	if err != nil || p == "" {
		return "", err
	}
	return `"` + p + `" "{file}"`, nil
}

// ExportCSS saves the built-in stylesheet (sent by the frontend) as a template.
func (a *App) ExportCSS(ctx context.Context, css string) (string, error) {
	d := a.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    "Export stylesheet template",
		Filename: "mdview-custom.css",
		Filters:  []application.FileFilter{{DisplayName: "CSS", Pattern: "*.css"}},
	})
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		d.AttachToWindow(w)
	}
	p, err := d.PromptForSingleSelection()
	if err != nil || p == "" {
		return "", err
	}
	if filepath.Ext(p) == "" {
		p += ".css"
	}
	return p, os.WriteFile(p, []byte(css), 0o644)
}

// OpenInEditor opens a file in the configured external editor.
func (a *App) OpenInEditor(path string, line int) error {
	a.mu.Lock()
	cmd := a.settings.EditorCommand
	a.mu.Unlock()
	if cmd == "" {
		return errors.New("no editor configured (Settings > Editor)")
	}
	return launchEditor(cmd, path, line)
}

// OpenURL opens an http(s)/mailto URL in the default browser.
func (a *App) OpenURL(u string) error {
	pu, err := url.Parse(u)
	if err != nil {
		return err
	}
	switch strings.ToLower(pu.Scheme) {
	case "http", "https", "mailto":
		return a.app.Browser.OpenURL(u)
	}
	return errors.New("refused to open URL scheme: " + pu.Scheme)
}

// OpenWithSystem opens a local (non-Markdown) file with its default
// application, after the user confirms: a link could point to a program.
func (a *App) OpenWithSystem(ctx context.Context, path string) error {
	if isUNC(path) {
		return errors.New("refused to open network path")
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	confirmed := make(chan bool, 1)
	d := a.app.Dialog.Question().
		SetTitle("Open file").
		SetMessage("Open this file with its default application?\n\n" + path)
	yes := d.AddButton("Open")
	yes.OnClick(func() { confirmed <- true })
	no := d.AddButton("Cancel")
	no.OnClick(func() { confirmed <- false })
	d.SetDefaultButton(no)
	d.SetCancelButton(no)
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		d.AttachToWindow(w)
	}
	d.Show()
	if !<-confirmed {
		return nil
	}
	return a.app.Browser.OpenFile(path)
}

// isUNC reports whether p may refer to a network location (UNC, device or
// mixed-separator forms). On Windows only drive-letter volumes are accepted,
// so that no path can make the system contact a remote host (NTLM leaks).
func isUNC(p string) bool {
	if runtime.GOOS != "windows" {
		return strings.HasPrefix(p, "//")
	}
	p = filepath.Clean(filepath.FromSlash(p))
	vol := filepath.VolumeName(p)
	return !(len(vol) == 2 && vol[1] == ':')
}

// servableExts are the file types served to the page (images and media).
var servableExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true,
	".bmp": true, ".ico": true, ".avif": true, ".apng": true,
	".mp4": true, ".webm": true, ".ogg": true, ".mp3": true, ".wav": true, ".m4a": true,
}

// RevealPath returns whether path exists and is a directory.
func (a *App) PathKind(path string) string {
	st, err := os.Stat(path)
	switch {
	case err != nil:
		return "missing"
	case st.IsDir():
		return "dir"
	default:
		return "file"
	}
}

// SetTitle sets the calling window's title.
func (a *App) SetTitle(ctx context.Context, title string) {
	if w := callerWindow(ctx); w != nil {
		w.SetTitle(title)
	}
}

// OpenNewWindow opens an empty window.
func (a *App) OpenNewWindow() { a.newWindow(nil, nil, nil) }

// DetachTab moves a tab dragged out of the calling window to the window under
// the screen point (x, y in DIP), or to a new window there. It returns the
// target window ID.
func (a *App) DetachTab(ctx context.Context, tab TabState, x, y int) uint {
	src := uint(0)
	var srcW *application.WebviewWindow
	if w, ok := callerWindow(ctx).(*application.WebviewWindow); ok {
		src = w.ID()
		srcW = w
	}
	for _, w := range a.windowsExcept(src) {
		if w.IsMinimised() || !w.IsVisible() {
			continue
		}
		b := w.Bounds()
		if x >= b.X && x < b.X+b.Width && y >= b.Y && y < b.Y+b.Height {
			a.app.Event.Emit(EvTabReceive, TabReceiveEvent{Target: w.ID(), Tab: tab, X: x, Y: y})
			w.Focus()
			return w.ID()
		}
	}
	width, height := 1000, 720
	if srcW != nil {
		b := srcW.Bounds()
		width, height = b.Width, b.Height
	}
	nw := a.newWindow(nil, []TabState{tab}, &application.Rect{X: x - 120, Y: y - 16, Width: width, Height: height})
	return nw.ID()
}

// TabAdoptedEvent tells the source window that another window took its tab.
type TabAdoptedEvent struct {
	Target uint   `json:"target"` // the source window
	TabID  string `json:"tabId"`
}

// NotifyTabAdopted is called by a window that accepted a tab dropped from
// another window, so the source window closes it.
func (a *App) NotifyTabAdopted(source uint, tabID string) {
	a.app.Event.Emit(EvTabAdopted, TabAdoptedEvent{Target: source, TabID: tabID})
}

// ---- local files ----

// fileMiddleware serves local files under markdown.FileURLPrefix.
func fileMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_mdv/file" {
			next.ServeHTTP(w, r)
			return
		}
		p := r.URL.Query().Get("p")
		if p == "" || !filepath.IsAbs(p) || isUNC(p) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		f, err := os.Open(p)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || st.IsDir() {
			http.NotFound(w, r)
			return
		}
		if !servableExts[strings.ToLower(filepath.Ext(p))] {
			// Unknown extension: serve only when the content is media.
			head := make([]byte, 512)
			n, _ := f.Read(head)
			ct := http.DetectContentType(head[:n])
			if !strings.HasPrefix(ct, "image/") && !strings.HasPrefix(ct, "video/") && !strings.HasPrefix(ct, "audio/") {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			w.Header().Set("Content-Type", ct)
			if _, err := f.Seek(0, 0); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, st.Name(), st.ModTime(), f)
	})
}
