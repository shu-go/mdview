package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings are the user preferences, persisted as mdview.json.
type Settings struct {
	Theme           string  `json:"theme"`           // "system" | "light" | "dark"
	FontFamily      string  `json:"fontFamily"`      // body font, "" = default
	CodeFontFamily  string  `json:"codeFontFamily"`  // code font, "" = default
	FontSize        int     `json:"fontSize"`        // base font size in px
	Zoom            float64 `json:"zoom"`            // content zoom factor
	ContentMaxWidth int     `json:"contentMaxWidth"` // max width of the text column in px, 0 = unlimited
	ContentPadding  int     `json:"contentPadding"`  // left/right padding of the render area in px
	EditorCommand   string  `json:"editorCommand"`   // e.g. `code -g "{file}:{line}"`
	CustomCSSPath   string  `json:"customCssPath"`   // user stylesheet
	DiffMode        string  `json:"diffMode"`        // default for new tabs: "baseline" | "initial" | "off"
	SidebarVisible  bool    `json:"sidebarVisible"`
	SidebarWidth    int     `json:"sidebarWidth"`
	SidebarTab      string  `json:"sidebarTab"` // "files" | "outline"
	OutlineMaxLevel int     `json:"outlineMaxLevel"`
}

// DefaultSettings returns the settings used when no file exists.
func DefaultSettings() Settings {
	return Settings{
		Theme:           "system",
		FontSize:        16,
		Zoom:            1,
		ContentMaxWidth: 860,
		ContentPadding:  32,
		DiffMode:        "baseline",
		SidebarVisible:  true,
		SidebarWidth:    260,
		SidebarTab:      "files",
		OutlineMaxLevel: 6,
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
	switch s.SidebarTab {
	case "files", "outline":
	default:
		s.SidebarTab = d.SidebarTab
	}
	if s.FontSize < 8 || s.FontSize > 48 {
		s.FontSize = d.FontSize
	}
	if s.Zoom < 0.3 || s.Zoom > 4 {
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
