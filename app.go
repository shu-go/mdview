package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/bep/debounce"
	"github.com/fsnotify/fsnotify"
	"github.com/sergi/go-diff/diffmatchpatch"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

var mdParser = goldmark.New(
	goldmark.WithExtensions(
		extension.GFM,
		extension.DefinitionList,
	),
	goldmark.WithRendererOptions(
		html.WithUnsafe(),
	),
)

var reTagName = regexp.MustCompile(`^</?([a-zA-Z][a-zA-Z0-9]*)`)

// reHTMLToken splits text into HTML tags, words, and whitespace runs.
var reHTMLToken = regexp.MustCompile(`<[^>]*>|[^\s<>]+|\s+`)

// structuralTags are block-container elements whose tags should not be wrapped
// in <ins>/<del>; only their content lines should be marked.
var structuralTags = map[string]bool{
	"ul": true, "ol": true,
	"table": true, "thead": true, "tbody": true, "tfoot": true, "tr": true,
	"blockquote": true, "dl": true,
}

// LoadResult contains the HTML parsed content and the raw Markdown content.
type LoadResult struct {
	HTML string `json:"html"`
	Raw  string `json:"raw"`
}

// App struct
type App struct {
	ctx          context.Context
	watcher      *fsnotify.Watcher
	watcherStop  chan struct{}
	watchedFile  string
	watcherMutex sync.Mutex
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// shutdown is called when the app exits. Clean up resources.
func (a *App) shutdown(ctx context.Context) {
	a.stopWatcher()
}

// stopWatcher stops the active file watcher if it exists
func (a *App) stopWatcher() {
	a.watcherMutex.Lock()
	defer a.watcherMutex.Unlock()

	if a.watcherStop != nil {
		close(a.watcherStop)
		a.watcherStop = nil
	}
	if a.watcher != nil {
		a.watcher.Close()
		a.watcher = nil
	}
	a.watchedFile = ""
}

// LoadFile reads a Markdown file, parses it to HTML, and returns both raw text and HTML.
func (a *App) LoadFile(filePath string) (LoadResult, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return LoadResult{}, fmt.Errorf("failed to read file: %w", err)
	}

	rawContent := string(data)
	htmlContent, err := a.parseMarkdown(rawContent)
	if err != nil {
		return LoadResult{}, fmt.Errorf("failed to parse markdown: %w", err)
	}

	return LoadResult{
		HTML: htmlContent,
		Raw:  rawContent,
	}, nil
}

func (a *App) parseMarkdown(mdText string) (string, error) {
	var buf bytes.Buffer
	if err := mdParser.Convert([]byte(mdText), &buf); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ParseMarkdownWithDiff renders both base and current Markdown to HTML,
// then returns the HTML with line-level diff markup (<ins>/<del>).
func (a *App) ParseMarkdownWithDiff(baseText, currentText string) (string, error) {
	if baseText == currentText {
		return a.parseMarkdown(currentText)
	}

	baseHTML, err := a.parseMarkdown(baseText)
	if err != nil {
		return "", err
	}
	currentHTML, err := a.parseMarkdown(currentText)
	if err != nil {
		return "", err
	}

	return diffHTMLByWord(baseHTML, currentHTML), nil
}

// diffHTMLByLine computes a line-level diff between two HTML strings,
// placing <ins>/<del> inside HTML elements rather than wrapping them.
func diffHTMLByLine(oldHTML, newHTML string) string {
	dmp := diffmatchpatch.New()
	chars1, chars2, lineArray := dmp.DiffLinesToChars(oldHTML, newHTML)
	diffs := dmp.DiffMain(chars1, chars2, false)
	diffs = dmp.DiffCharsToLines(diffs, lineArray)

	var result strings.Builder
	for _, diff := range diffs {
		lines := strings.Split(diff.Text, "\n")
		for i, line := range lines {
			if i == len(lines)-1 {
				break // last element after split is always ""
			}
			switch diff.Type {
			case diffmatchpatch.DiffDelete:
				if line != "" {
					result.WriteString(wrapWithDiff(line, "del"))
				}
				result.WriteString("\n")
			case diffmatchpatch.DiffInsert:
				if line != "" {
					result.WriteString(wrapWithDiff(line, "ins"))
				}
				result.WriteString("\n")
			case diffmatchpatch.DiffEqual:
				result.WriteString(line)
				result.WriteString("\n")
			}
		}
	}
	return result.String()
}

// diffHTMLByWord computes a word-level diff between two HTML strings.
// It first identifies changed line regions, then for matched delete+insert pairs
// applies word-level markup. Unmatched lines fall back to whole-line markup.
func diffHTMLByWord(oldHTML, newHTML string) string {
	dmp := diffmatchpatch.New()
	chars1, chars2, lineArray := dmp.DiffLinesToChars(oldHTML, newHTML)
	diffs := dmp.DiffMain(chars1, chars2, false)
	diffs = dmp.DiffCharsToLines(diffs, lineArray)

	var result strings.Builder
	i := 0
	for i < len(diffs) {
		d := diffs[i]
		switch d.Type {
		case diffmatchpatch.DiffEqual:
			result.WriteString(d.Text)
			i++
		case diffmatchpatch.DiffDelete:
			if i+1 < len(diffs) && diffs[i+1].Type == diffmatchpatch.DiffInsert {
				applyWordDiff(&result, dmp, d.Text, diffs[i+1].Text)
				i += 2
			} else {
				writeWrappedLines(&result, d.Text, "del")
				i++
			}
		case diffmatchpatch.DiffInsert:
			writeWrappedLines(&result, d.Text, "ins")
			i++
		}
	}
	return result.String()
}

// writeWrappedLines wraps each non-empty line in text with <ins> or <del> markup.
func writeWrappedLines(sb *strings.Builder, text, tag string) {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if i == len(lines)-1 {
			break
		}
		if line != "" {
			sb.WriteString(wrapWithDiff(line, tag))
		}
		sb.WriteString("\n")
	}
}

// applyWordDiff writes word-level diff output for a paired delete+insert block.
func applyWordDiff(sb *strings.Builder, dmp *diffmatchpatch.DiffMatchPatch, delText, insText string) {
	delLines := splitLines(delText)
	insLines := splitLines(insText)

	if len(delLines) != len(insLines) {
		writeWrappedLines(sb, delText, "del")
		writeWrappedLines(sb, insText, "ins")
		return
	}

	for j := range delLines {
		wordDiffOneLine(sb, dmp, delLines[j], insLines[j])
	}
}

// splitLines splits text by \n, dropping the trailing empty element.
func splitLines(text string) []string {
	parts := strings.Split(text, "\n")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	return parts
}

// wordDiffOneLine performs word-level diff between delLine and insLine,
// writing the result (including trailing \n) to sb.
// Falls back to line-level markup when the outer HTML structure differs.
func wordDiffOneLine(sb *strings.Builder, dmp *diffmatchpatch.DiffMatchPatch, delLine, insLine string) {
	// Structural container tags: fall back to line-level
	if m := reTagName.FindStringSubmatch(delLine); m != nil && structuralTags[strings.ToLower(m[1])] {
		if delLine != "" {
			sb.WriteString(wrapWithDiff(delLine, "del"))
		}
		sb.WriteString("\n")
		if insLine != "" {
			sb.WriteString(wrapWithDiff(insLine, "ins"))
		}
		sb.WriteString("\n")
		return
	}

	delOpen, delContent, _ := splitHTMLLine(delLine)
	insOpen, insContent, insClose := splitHTMLLine(insLine)

	if delOpen != insOpen || (delContent == "" && insContent == "") {
		// Different outer tag or bare tag: line-level fallback
		if delLine != "" {
			sb.WriteString(wrapWithDiff(delLine, "del"))
		}
		sb.WriteString("\n")
		if insLine != "" {
			sb.WriteString(wrapWithDiff(insLine, "ins"))
		}
		sb.WriteString("\n")
		return
	}

	// Same outer tag: word-level diff on inner content
	wordDiffs := tokenizedDiff(dmp, delContent, insContent)
	sb.WriteString(insOpen)
	for _, wd := range wordDiffs {
		switch wd.Type {
		case diffmatchpatch.DiffDelete:
			sb.WriteString("<del>")
			sb.WriteString(wd.Text)
			sb.WriteString("</del>")
		case diffmatchpatch.DiffInsert:
			sb.WriteString("<ins>")
			sb.WriteString(wd.Text)
			sb.WriteString("</ins>")
		default:
			sb.WriteString(wd.Text)
		}
	}
	sb.WriteString(insClose)
	sb.WriteString("\n")
}

// splitHTMLLine extracts the outer opening tag, inner content, and closing tag from an HTML line.
// e.g. "<p>foo bar</p>" → ("<p>", "foo bar", "</p>")
func splitHTMLLine(line string) (openTag, content, closeTag string) {
	if !strings.HasPrefix(line, "<") {
		return "", line, ""
	}
	firstClose := strings.Index(line, ">")
	if firstClose == -1 {
		return "", line, ""
	}
	openTag = line[:firstClose+1]
	rest := line[firstClose+1:]
	lastOpen := strings.LastIndex(rest, "</")
	if lastOpen == -1 {
		return openTag, rest, ""
	}
	return openTag, rest[:lastOpen], rest[lastOpen:]
}

// tokenizedDiff diffs two strings at the word/token level, treating HTML tags as atomic tokens.
func tokenizedDiff(dmp *diffmatchpatch.DiffMatchPatch, text1, text2 string) []diffmatchpatch.Diff {
	tokens := []string{""}
	tokenIndex := map[string]rune{}
	next := rune(1)

	encode := func(text string) string {
		var b strings.Builder
		for _, tok := range reHTMLToken.FindAllString(text, -1) {
			r, ok := tokenIndex[tok]
			if !ok {
				r = next
				next++
				tokenIndex[tok] = r
				tokens = append(tokens, tok)
			}
			b.WriteRune(r)
		}
		return b.String()
	}

	c1 := encode(text1)
	c2 := encode(text2)

	diffs := dmp.DiffMain(c1, c2, false)
	diffs = dmp.DiffCleanupSemantic(diffs)

	result := make([]diffmatchpatch.Diff, len(diffs))
	for i, d := range diffs {
		var b strings.Builder
		for _, r := range d.Text {
			if int(r) < len(tokens) {
				b.WriteString(tokens[int(r)])
			}
		}
		result[i] = diffmatchpatch.Diff{Type: d.Type, Text: b.String()}
	}
	return result
}

// wrapWithDiff places <ins> or <del> inside an HTML element's content.
//
// Examples:
//
//	<li>text</li>       → <li><del>text</del></li>
//	<p>text</p>         → <p><ins>text</ins></p>
//	<ul>                → <ul>  (structural tag, unchanged)
//	<li>partial text    → <li><del>partial text</del>
func wrapWithDiff(line, tag string) string {
	if line == "" {
		return ""
	}

	// Check if line starts with a known structural container tag — leave unchanged.
	if m := reTagName.FindStringSubmatch(line); m != nil {
		if structuralTags[strings.ToLower(m[1])] {
			return line
		}
	}

	// Find the end of the first tag (opening or closing).
	firstClose := strings.Index(line, ">")
	if firstClose == -1 || !strings.HasPrefix(line, "<") {
		// No HTML structure — wrap the whole line.
		return "<" + tag + ">" + line + "</" + tag + ">"
	}

	openTag := line[:firstClose+1]
	rest := line[firstClose+1:]

	if rest == "" {
		// Bare tag only (e.g. <hr />, </li> alone) — don't modify.
		return line
	}

	// Find the last </...> closing tag in rest and wrap the content between them.
	lastCloseStart := strings.LastIndex(rest, "</")
	if lastCloseStart != -1 {
		content := rest[:lastCloseStart]
		closeTag := rest[lastCloseStart:]
		return openTag + "<" + tag + ">" + content + "</" + tag + ">" + closeTag
	}

	// No closing tag on the same line (partial element like <li>text without </li>).
	return openTag + "<" + tag + ">" + rest + "</" + tag + ">"
}

// WatchFile starts watching a markdown file for changes. It will stop any previous watcher.
func (a *App) WatchFile(filePath string) error {
	a.stopWatcher()

	a.watcherMutex.Lock()
	var err error
	a.watcher, err = fsnotify.NewWatcher()
	if err != nil {
		a.watcherMutex.Unlock()
		return fmt.Errorf("failed to create watcher: %w", err)
	}
	a.watcherStop = make(chan struct{})
	a.watchedFile = filepath.Clean(filePath)

	// Watch the parent directory to safely handle file replacements/renames by editors
	parentDir := filepath.Dir(a.watchedFile)
	err = a.watcher.Add(parentDir)
	a.watcherMutex.Unlock()
	if err != nil {
		a.watcher.Close()
		a.watcher = nil
		return fmt.Errorf("failed to watch directory %s: %w", parentDir, err)
	}

	debounced := debounce.New(300 * time.Millisecond)

	go func() {
		for {
			select {
			case event, ok := <-a.watcher.Events:
				if !ok {
					return
				}
				if filepath.Clean(event.Name) == a.watchedFile {
					if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
						debounced(func() {
							a.onFileChanged()
						})
					}
				}
			case _, ok := <-a.watcher.Errors:
				if !ok {
					return
				}
			case <-a.watcherStop:
				return
			}
		}
	}()

	return nil
}

// onFileChanged notifies the frontend that the watched file has changed.
func (a *App) onFileChanged() {
	a.watcherMutex.Lock()
	watchedFile := a.watchedFile
	a.watcherMutex.Unlock()

	if watchedFile == "" {
		return
	}

	runtime.EventsEmit(a.ctx, "file-changed", watchedFile)
}

// SetWindowTitle sets the OS window title bar text.
func (a *App) SetWindowTitle(title string) {
	runtime.WindowSetTitle(a.ctx, title)
}

// OpenInNewInstance launches a new instance of this app with the given file path.
func (a *App) OpenInNewInstance(filePath string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	return exec.Command(exe, filePath).Start()
}

// OpenInBrowser opens the given URL in the system's default browser or application.
func (a *App) OpenInBrowser(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}

// Config holds user preferences persisted to mdview.json next to the executable.
type Config struct {
	FontFamily string `json:"fontFamily"`
	ThemeMode  string `json:"themeMode"` // "light" | "dark" | "system"
	EditorPath string `json:"editorPath"`
}

func (a *App) configPath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exe), "mdview.json"), nil
}

// LoadConfig reads mdview.json and returns the stored config (or defaults on missing/invalid file).
func (a *App) LoadConfig() Config {
	path, err := a.configPath()
	if err != nil {
		return Config{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}
	}
	return cfg
}

// SaveConfig writes the given config to mdview.json next to the executable.
func (a *App) SaveConfig(cfg Config) error {
	path, err := a.configPath()
	if err != nil {
		return err
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// logFontW mirrors the Windows LOGFONTW structure.
type logFontW struct {
	lfHeight         int32
	lfWidth          int32
	lfEscapement     int32
	lfOrientation    int32
	lfWeight         int32
	lfItalic         uint8
	lfUnderline      uint8
	lfStrikeOut      uint8
	lfCharSet        uint8
	lfOutPrecision   uint8
	lfClipPrecision  uint8
	lfQuality        uint8
	lfPitchAndFamily uint8
	lfFaceName       [32]uint16
}

// chooseFontParams mirrors the Windows CHOOSEFONTW structure for 64-bit.
// Explicit pad fields match the C struct's alignment padding.
type chooseFontParams struct {
	lStructSize uint32
	pad0        uint32
	hwndOwner   uintptr
	hDC         uintptr
	lpLogFont   uintptr
	iPointSize  int32
	flags       uint32
	rgbColors   uint32
	pad1        uint32
	lCustData   uintptr
	lpfnHook    uintptr
	lpTemplate  uintptr
	hInstance   uintptr
	lpszStyle   uintptr
	nFontType   uint16
	pad2        uint16
	nSizeMin    int32
	nSizeMax    int32
}

const (
	cfScreenFonts         = 0x00000001
	cfInitToLogFontStruct = 0x00000040
	cfNoVertFonts         = 0x01000000
)

// ChooseEditor opens a native file dialog to select an editor executable.
// Returns the selected path, or empty string if the user cancelled.
func (a *App) ChooseEditor() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Editor Executable",
		Filters: []runtime.FileFilter{
			{DisplayName: "Executable Files (*.exe)", Pattern: "*.exe"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// OpenInEditor launches the given editor executable with filePath as its argument.
func (a *App) OpenInEditor(editorPath, filePath string) error {
	if editorPath == "" {
		return fmt.Errorf("no editor configured")
	}
	return exec.Command(editorPath, filePath).Start()
}

// ChooseFont opens the Windows native font picker dialog.
// Returns the selected font family name, or empty string if the user cancelled.
func (a *App) ChooseFont() (string, error) {
	dll := syscall.NewLazyDLL("comdlg32.dll")
	proc := dll.NewProc("ChooseFontW")

	var lf logFontW
	var cf chooseFontParams
	cf.lStructSize = uint32(unsafe.Sizeof(cf))
	cf.flags = cfScreenFonts | cfInitToLogFontStruct | cfNoVertFonts
	cf.lpLogFont = uintptr(unsafe.Pointer(&lf))

	ret, _, _ := proc.Call(uintptr(unsafe.Pointer(&cf)))
	if ret == 0 {
		return "", nil // user cancelled
	}
	return syscall.UTF16ToString(lf.lfFaceName[:]), nil
}

// GetInitialFile returns the file path passed as the first command-line argument, or empty string.
func (a *App) GetInitialFile() string {
	if len(os.Args) > 1 {
		return os.Args[1]
	}
	return ""
}

// SelectFile opens a native file dialog to select a markdown file and returns its path.
func (a *App) SelectFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Markdown File",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown Files (*.md;*.markdown)", Pattern: "*.md;*.markdown"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}
