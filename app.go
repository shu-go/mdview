package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/bep/debounce"
	"github.com/fsnotify/fsnotify"
	"github.com/sergi/go-diff/diffmatchpatch"
	"github.com/shu-go/findcfg"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/yuin/goldmark"
	emoji "github.com/yuin/goldmark-emoji"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

var mdParser = goldmark.New(
	goldmark.WithExtensions(
		extension.GFM,
		extension.DefinitionList,
		Callout,
		emoji.Emoji,
		HeadingID,
	),
	goldmark.WithRendererOptions(
		html.WithUnsafe(),
	),
)

var reTagName = regexp.MustCompile(`^</?([a-zA-Z][a-zA-Z0-9]*)`)

// reImgSrc matches src="..." inside <img> tags produced by goldmark.
var reImgSrc = regexp.MustCompile(`(?i)<img\b([^>]*?\s)?src="([^"]*)"([^>]*)>`)

// reHTMLToken splits text into HTML tags, words, and whitespace runs.
var reHTMLToken = regexp.MustCompile(`<[^>]*>|[^\s<>]+|\s+`)

// structuralTags are block-container elements whose tags should not be wrapped
// in <ins>/<del>; only their content lines should be marked.
var structuralTags = map[string]bool{
	"ul": true, "ol": true,
	"table": true, "thead": true, "tbody": true, "tfoot": true, "tr": true,
	"blockquote": true, "dl": true, "div": true,
}

// LoadResult contains the HTML parsed content and the raw Markdown content.
type LoadResult struct {
	HTML        string `json:"html"`
	Raw         string `json:"raw"`
	FrontMatter string `json:"frontMatter"` // raw YAML string, empty if none
}

// extractFrontMatter splits YAML front matter (between --- delimiters) from markdown content.
// Returns the raw YAML string and the body without front matter.
// If no front matter is detected, returns ("", content).
func extractFrontMatter(content string) (yamlStr, body string) {
	norm := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(norm, "---\n") {
		return "", content
	}
	rest := norm[4:]
	if idx := strings.Index(rest, "\n---\n"); idx != -1 {
		return rest[:idx], rest[idx+5:]
	}
	if strings.HasSuffix(rest, "\n---") {
		return rest[:len(rest)-4], ""
	}
	return "", content
}

// dirWatch is an fsnotify watcher on a single parent directory, shared by all
// currently-open files that reside in that directory.
type dirWatch struct {
	watcher  *fsnotify.Watcher
	stop     chan struct{}
	refCount int
}

// App struct
type App struct {
	ctx context.Context

	watchMutex   sync.Mutex
	dirWatches   map[string]*dirWatch    // parent dir -> shared watcher
	watchedFiles map[string]struct{}     // cleaned file paths currently watched
	debouncers   map[string]func(func()) // cleaned file path -> its own debounce function
}

// detectImageMIME returns the MIME type for a local image file based on its extension.
func detectImageMIME(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	default:
		return "image/png"
	}
}

// inlineLocalImages replaces local <img src="..."> references with base64 data URLs.
// Absolute URLs (http/https/data/protocol-relative) are left unchanged.
func inlineLocalImages(htmlContent, dir string) string {
	return reImgSrc.ReplaceAllStringFunc(htmlContent, func(match string) string {
		groups := reImgSrc.FindStringSubmatch(match)
		if len(groups) < 4 {
			return match
		}
		src := groups[2]

		lower := strings.ToLower(src)
		if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") ||
			strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "//") {
			return match
		}

		// URL-decode percent-encoded characters in the path (e.g. %20 → space)
		decoded, err := url.PathUnescape(src)
		if err != nil {
			decoded = src
		}

		imgPath := filepath.Join(dir, filepath.FromSlash(decoded))
		data, err := os.ReadFile(imgPath)
		if err != nil {
			return match
		}

		mimeType := detectImageMIME(imgPath)
		dataURL := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
		return strings.Replace(match, `src="`+src+`"`, `src="`+dataURL+`"`, 1)
	})
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
	a.stopAllWatchers()
}

// stopAllWatchers stops every active per-directory file watcher.
func (a *App) stopAllWatchers() {
	a.watchMutex.Lock()
	defer a.watchMutex.Unlock()

	for _, dw := range a.dirWatches {
		close(dw.stop)
		dw.watcher.Close()
	}
	a.dirWatches = nil
	a.watchedFiles = nil
	a.debouncers = nil
}

// LoadFile reads a Markdown file, parses it to HTML, and returns both raw text and HTML.
func (a *App) LoadFile(filePath string) (LoadResult, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return LoadResult{}, fmt.Errorf("failed to read file: %w", err)
	}

	frontMatter, body := extractFrontMatter(string(data))
	htmlContent, err := a.parseMarkdown(body)
	if err != nil {
		return LoadResult{}, fmt.Errorf("failed to parse markdown: %w", err)
	}

	dir := filepath.Dir(filePath)
	htmlContent = inlineLocalImages(htmlContent, dir)

	return LoadResult{
		HTML:        htmlContent,
		Raw:         body,
		FrontMatter: frontMatter,
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
// filePath is used to resolve relative image paths and may be empty.
func (a *App) ParseMarkdownWithDiff(filePath, baseText, currentText string) (string, error) {
	_, baseBody := extractFrontMatter(baseText)
	_, currentBody := extractFrontMatter(currentText)

	dir := ""
	if filePath != "" {
		dir = filepath.Dir(filePath)
	}

	if baseBody == currentBody {
		html, err := a.parseMarkdown(currentBody)
		if err != nil {
			return "", err
		}
		if dir != "" {
			html = inlineLocalImages(html, dir)
		}
		return html, nil
	}

	baseHTML, err := a.parseMarkdown(baseBody)
	if err != nil {
		return "", err
	}
	currentHTML, err := a.parseMarkdown(currentBody)
	if err != nil {
		return "", err
	}

	result := diffHTMLByWord(baseHTML, currentHTML)
	if dir != "" {
		result = inlineLocalImages(result, dir)
	}
	return result, nil
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

// WatchFile starts watching a markdown file for changes, without affecting
// watches already active on other open files. Calling it again for a file
// that's already watched is a no-op. Files that share a parent directory
// share a single fsnotify watcher on that directory.
func (a *App) WatchFile(filePath string) error {
	clean := filepath.Clean(filePath)
	dir := filepath.Dir(clean)

	a.watchMutex.Lock()
	defer a.watchMutex.Unlock()

	if a.watchedFiles == nil {
		a.watchedFiles = make(map[string]struct{})
	}
	if a.dirWatches == nil {
		a.dirWatches = make(map[string]*dirWatch)
	}
	if a.debouncers == nil {
		a.debouncers = make(map[string]func(func()))
	}

	if _, already := a.watchedFiles[clean]; already {
		return nil
	}

	dw, ok := a.dirWatches[dir]
	if !ok {
		w, err := fsnotify.NewWatcher()
		if err != nil {
			return fmt.Errorf("failed to create watcher: %w", err)
		}
		if err := w.Add(dir); err != nil {
			w.Close()
			return fmt.Errorf("failed to watch directory %s: %w", dir, err)
		}
		dw = &dirWatch{watcher: w, stop: make(chan struct{})}
		a.dirWatches[dir] = dw
		go a.runDirWatcher(dw)
	}
	dw.refCount++

	a.watchedFiles[clean] = struct{}{}
	a.debouncers[clean] = debounce.New(300 * time.Millisecond)

	return nil
}

// UnwatchFile stops watching a single file. If it was the last watched file
// in its parent directory, the shared directory watcher is torn down too.
func (a *App) UnwatchFile(filePath string) {
	clean := filepath.Clean(filePath)
	dir := filepath.Dir(clean)

	a.watchMutex.Lock()
	defer a.watchMutex.Unlock()

	if _, ok := a.watchedFiles[clean]; !ok {
		return
	}
	delete(a.watchedFiles, clean)
	delete(a.debouncers, clean)

	dw, ok := a.dirWatches[dir]
	if !ok {
		return
	}
	dw.refCount--
	if dw.refCount <= 0 {
		close(dw.stop)
		dw.watcher.Close()
		delete(a.dirWatches, dir)
	}
}

// runDirWatcher processes fsnotify events for a single shared directory
// watcher, notifying the frontend only for paths that are still watched.
func (a *App) runDirWatcher(dw *dirWatch) {
	for {
		select {
		case event, ok := <-dw.watcher.Events:
			if !ok {
				return
			}
			if !event.Has(fsnotify.Write) && !event.Has(fsnotify.Create) {
				continue
			}
			clean := filepath.Clean(event.Name)

			a.watchMutex.Lock()
			_, watched := a.watchedFiles[clean]
			debounced := a.debouncers[clean]
			a.watchMutex.Unlock()

			if watched && debounced != nil {
				debounced(func() {
					runtime.EventsEmit(a.ctx, "file-changed", clean)
				})
			}
		case _, ok := <-dw.watcher.Errors:
			if !ok {
				return
			}
		case <-dw.stop:
			return
		}
	}
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

// Config holds user preferences persisted to mdview.json.
type Config struct {
	Font          string  `json:"font"`
	ThemeMode     string  `json:"themeMode"` // "light" | "dark" | "system"
	EditorPath    string  `json:"editorPath"`
	FileListRatio float64 `json:"fileListRatio"` // width fraction (0-1) given to the file list area
}

func configFinder() *findcfg.Finder {
	return findcfg.New(
		findcfg.JSON(),
		findcfg.Name("mdview"),
		findcfg.ExecutableDir(),
		findcfg.UserConfigDir("mdview"),
	)
}

// LoadConfig searches for mdview.json (executable dir → UserConfigDir) and returns the stored config.
func (a *App) LoadConfig() Config {
	found := configFinder().Find()
	if found == nil {
		return Config{}
	}
	data, err := os.ReadFile(found.Path)
	if err != nil {
		return Config{}
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}
	}
	return cfg
}

// SaveConfig writes config to the found mdview.json, or to UserConfigDir as fallback.
func (a *App) SaveConfig(cfg Config) error {
	finder := configFinder()
	var path string
	if found := finder.Find(); found != nil {
		path = found.Path
	} else {
		ud, err := os.UserConfigDir()
		if err != nil {
			return err
		}
		path = filepath.Join(ud, "mdview", "mdview.json")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// ChooseEditor opens a native file dialog to select an editor executable.
// Returns the selected path, or empty string if the user cancelled.
func (a *App) ChooseEditor() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Editor Executable",
		Filters: []runtime.FileFilter{
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

// SelectFiles opens a native file dialog allowing multiple Markdown files to
// be selected at once, and returns their paths.
func (a *App) SelectFiles() ([]string, error) {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Markdown Files",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown Files (*.md;*.markdown)", Pattern: "*.md;*.markdown"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, err
	}
	return paths, nil
}

// ExpandDroppedPaths takes the paths from a drag-and-drop event and expands
// any directories into the files they contain (recursively), returning a
// flat list of file paths; non-directory paths are passed through unchanged.
// Extension filtering (.md, .markdown, ...) stays the frontend's concern.
func (a *App) ExpandDroppedPaths(paths []string) ([]string, error) {
	var result []string
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			result = append(result, p)
			continue
		}
		err = filepath.Walk(p, func(path string, fi os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if !fi.IsDir() {
				result = append(result, path)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}
