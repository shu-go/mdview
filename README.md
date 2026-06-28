# mdview

A lightweight standalone Markdown viewer for Windows, macOS, and Linux, built with [Wails](https://wails.io/) (Go + WebView2).

## Features

- **Drag & drop** — Drop a Markdown file onto the window to open it, from either the start screen or the viewer
- **CLI argument** — Open a file directly: `mdview.exe path/to/file.md`
- **File watching** — Automatically reloads when the file is saved
- **Inline diff** — View changes against two baselines:
  - *Initial Diff* — diff against the content when the file was first opened
  - *Baseline Diff* — diff against a snapshot you set manually with **Update Baseline**
- **Syntax highlighting** — Code blocks highlighted via Prism.js (lazy-loaded)
- **Mermaid diagrams** — Renders `mermaid` code blocks as diagrams (lazy-loaded)
- **Link handling**
  - `.md` / `.markdown` links → opens a new instance of mdview
  - `http://`, `https://`, `mailto:` links → opens in the system default browser
  - Other local file links → opens in the system default browser
  - Hovering a link shows the resolved destination in a status bar at the bottom
- **Overlay toolbar** — Move the mouse to the top of the viewer to reveal the toolbar; it hides when you move away
- **Font selection** — Set the rendering font via an in-app dialog using any CSS `font` shorthand value (e.g. `bold 1.1em "Yu Gothic", sans-serif`); a live preview updates as you type; the value is saved and restored on next launch
- **Color themes** — Switch between Light, Dark, and System (follows OS setting) from the toolbar; preference is saved across sessions
- **Editor integration** — Register an external editor executable via the Menu; press `Ctrl+E` to open the current file in that editor
- **Zoom** — Scale the document view from 50% to 200% in 10% steps; a zoom indicator appears in the bottom-right corner on hover or when the zoom level changes
- **Front matter display** — YAML front matter (`---` blocks) is parsed and shown as a collapsible metadata table above the document body
- **Local image rendering** — Relative image paths are resolved against the markdown file's directory and embedded as base64 data URLs
- **Code block copy** — A **Copy** button appears on hover over any code block; clicking it copies the raw code to the clipboard

## Supported Markdown

Rendered via [goldmark](https://github.com/yuin/goldmark) with the following extensions enabled:

- GitHub Flavored Markdown (GFM): tables, strikethrough, task lists, autolinks
- Definition lists
- Raw HTML passthrough (`html.WithUnsafe`)

## Usage

```
mdview.exe [file]
```

| Action | Result |
|---|---|
| Launch with no argument | Shows the drop screen |
| Drag & drop a `.md` file | Opens the file in the viewer |
| Click the drop area | Opens a file picker dialog |
| `mdview.exe path/to/file.md` | Opens the file directly on launch |

### Toolbar

Hover the mouse near the top of the viewer window to reveal the toolbar.

| Control | Description |
|---|---|
| **Normal** | Renders the current file as-is |
| **Initial Diff** | Highlights changes since the file was first opened |
| **Baseline Diff** | Highlights changes since the last **Update Baseline** |
| **Update Baseline** | Saves the current content as the new diff baseline |
| **Menu** | Opens a context menu with color scheme, editor, and font settings |

#### Menu

| Item | Description |
|---|---|
| **Color Scheme ▶** | Submenu to switch between Light, Dark, and System (follows OS); active choice is marked with ✓ |
| **Editor...** | Select an editor executable; saved to settings; press `Ctrl+E` to open the current file |
| **Font...** | Opens the font settings dialog; enter any CSS `font` shorthand value with a live preview |

#### Zoom bar

Move the mouse to the **bottom-right corner** of the viewer to reveal the zoom bar.

| Control | Description |
|---|---|
| **−** | Zoom out 10% |
| **100%** (label) | Displays the current zoom level |
| **+** | Zoom in 10% |
| **1:1** | Reset to 100% |

The zoom bar also appears briefly after any zoom change via keyboard shortcut and hides automatically after 1.5 seconds. The zoom level ranges from 50% to 200%.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+E` | Open current file in the configured editor |
| `Ctrl+F` or `/` | Open search panel |
| `F3` | Next match |
| `Shift+F3` | Previous match |
| `Escape` | Close menu / close search panel |
| `Ctrl+D` | Cycle diff mode: Normal → Initial Diff → Baseline Diff → Normal |
| `Ctrl++` | Zoom in 10% |
| `Ctrl+-` | Zoom out 10% |
| `Ctrl+=` | Reset zoom to 100% |
| `Ctrl+W` or `q` | Quit the application |
| `j` | Scroll down one line |
| `k` | Scroll up one line |
| `b` or `Shift+Space` | Scroll up one page |
| `g` | Scroll to top |
| `Shift+G` | Scroll to bottom |

### Settings file

User preferences are saved to `mdview.json` and loaded automatically on next launch.

The file is searched in this order; the first found is used:

1. Same directory as the executable
2. OS user config directory (`os.UserConfigDir()`)
   - Windows: `%APPDATA%\mdview.json`
   - macOS: `~/Library/Application Support/mdview.json`
   - Linux: `~/.config/mdview.json`

When saving for the first time (no existing file), it is written to the executable directory.

The `font` field accepts any valid CSS `font` shorthand string:

```json
{
  "font": "bold 1.1em \"Yu Gothic\", sans-serif",
  "themeMode": "system",
  "editorPath": ""
}
```

## Building

Prerequisites: [Go](https://go.dev/), [Wails CLI](https://wails.io/docs/gettingstarted/installation), [Node.js](https://nodejs.org/)

```sh
# Development (hot reload)
wails dev

# Production binary → build/bin/mdview.exe
wails build
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | [Wails v2](https://wails.io/) |
| Markdown parser | [goldmark](https://github.com/yuin/goldmark) |
| Diff engine | [go-diff / diffmatchpatch](https://github.com/sergi/go-diff) |
| File watching | [fsnotify](https://github.com/fsnotify/fsnotify) |
| Syntax highlighting | [Prism.js](https://prismjs.com/) (lazy-loaded) |
| Diagram rendering | [Mermaid](https://mermaid.js.org/) (lazy-loaded) |
| Frontend | Vanilla JS / CSS (no framework) |
