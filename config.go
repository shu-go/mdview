package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings are the user preferences, persisted as mdview.json.
type Settings struct {
	Theme           string `json:"theme"`           // "system" | "light" | "dark"
	FontFamily      string `json:"fontFamily"`      // body font, "" = default
	CodeFontFamily  string `json:"codeFontFamily"`  // code font, "" = default
	FontSize        int    `json:"fontSize"`        // base font size in px
	Zoom            int    `json:"zoom"`            // content zoom in percent (100 = 1x)
	ContentMaxWidth int    `json:"contentMaxWidth"` // max width of the text column in px, 0 = unlimited
	ContentPadding  int    `json:"contentPadding"`  // left/right padding of the render area in px
	EditorCommand   string `json:"editorCommand"`   // e.g. `code -g "{file}:{line}"`
	CustomCSSPath   string `json:"customCssPath"`   // user stylesheet
	DiffMode        string `json:"diffMode"`        // default for new tabs: "baseline" | "initial" | "off"
	SidebarVisible  bool   `json:"sidebarVisible"`
	SidebarWidth    int    `json:"sidebarWidth"`
	SidebarTab      string `json:"sidebarTab"` // "files" | "outline" | "search"
	OutlineMaxLevel int    `json:"outlineMaxLevel"`
	// DiffDetail is how changes inside a changed block are shown:
	// "word" | "char" (inline marks) or "block" (old and new block side by side).
	DiffDetail string `json:"diffDetail"`
	// OpenInNewWindow opens files in a new window (command line, drops, the
	// open dialog, recent files, document links); the sidebar opens tabs.
	OpenInNewWindow bool `json:"openInNewWindow"`
	// LastTabAction is what happens to a window when its last tab is closed:
	// "close" | "minimize" | "keep".
	LastTabAction string `json:"lastTabAction"`
	// LegacyCloseWindowOnLastTab is read from settings files written before
	// lastTabAction existed and converted by normalize; it is never written.
	LegacyCloseWindowOnLastTab *bool `json:"closeWindowOnLastTab,omitempty"`
	// WrapText wraps long lines of text files at the right edge; false keeps
	// lines as they are with horizontal scrolling.
	WrapText bool `json:"wrapText"`
}

// DefaultSettings returns the settings used when no file exists.
func DefaultSettings() Settings {
	return Settings{
		Theme:           "system",
		FontSize:        16,
		Zoom:            100,
		ContentMaxWidth: 860,
		ContentPadding:  32,
		DiffMode:        "baseline",
		SidebarVisible:  true,
		SidebarWidth:    260,
		SidebarTab:      "files",
		OutlineMaxLevel: 6,

		DiffDetail:    "word",
		LastTabAction: "close",
		WrapText:      true,
	}
}

func (s *Settings) normalize() {
	d := DefaultSettings()
	switch s.Theme {
	case "system", "light", "dark":
	default:
		s.Theme = d.Theme
	}
	switch s.DiffMode {
	case "baseline", "initial", "off":
	default:
		s.DiffMode = d.DiffMode
	}
	switch s.DiffDetail {
	case "word", "char", "block":
	default:
		s.DiffDetail = d.DiffDetail
	}
	if s.LegacyCloseWindowOnLastTab != nil {
		// only old files carry it; they have no lastTabAction, which keeps the default
		if !*s.LegacyCloseWindowOnLastTab && s.LastTabAction == d.LastTabAction {
			s.LastTabAction = "keep"
		}
		s.LegacyCloseWindowOnLastTab = nil
	}
	switch s.LastTabAction {
	case "close", "minimize", "keep":
	default:
		s.LastTabAction = d.LastTabAction
	}
	switch s.SidebarTab {
	case "files", "outline", "search":
	default:
		s.SidebarTab = d.SidebarTab
	}
	if s.FontSize < 8 || s.FontSize > 48 {
		s.FontSize = d.FontSize
	}
	if s.Zoom > 0 && s.Zoom <= 4 {
		s.Zoom *= 100 // older settings stored a factor
	}
	if s.Zoom < 30 || s.Zoom > 400 {
		s.Zoom = d.Zoom
	}
	if s.ContentMaxWidth < 0 {
		s.ContentMaxWidth = 0
	}
	if s.ContentPadding < 0 {
		s.ContentPadding = 0
	}
	if s.SidebarWidth < 120 {
		s.SidebarWidth = d.SidebarWidth
	}
	if s.OutlineMaxLevel < 1 || s.OutlineMaxLevel > 6 {
		s.OutlineMaxLevel = d.OutlineMaxLevel
	}
}

const settingsFileName = "mdview.json"

// settingsCandidates lists where mdview.json is searched: next to the
// executable (portable use) first, then the user config directory.
func settingsCandidates() []string {
	var c []string
	if exe, err := os.Executable(); err == nil {
		c = append(c, filepath.Join(filepath.Dir(exe), settingsFileName))
	}
	if ud, err := os.UserConfigDir(); err == nil {
		c = append(c, filepath.Join(ud, "mdview", settingsFileName))
	}
	return c
}

// loadSettings returns the stored settings and the path to save them to.
func loadSettings() (Settings, string) {
	s := DefaultSettings()
	cands := settingsCandidates()
	for _, p := range cands {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		_ = json.Unmarshal(b, &s)
		s.normalize()
		return s, p
	}
	path := ""
	if len(cands) > 0 {
		path = cands[len(cands)-1]
	}
	return s, path
}

func saveSettings(path string, s Settings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}
