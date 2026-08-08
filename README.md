# mdview

A lightweight standalone Markdown viewer for Windows, macOS, and Linux, built with [Wails](https://wails.io/) (Go + WebView2).

## Features

- **Multi-file support** — Open multiple files in one window and switch between them via a collapsible file list panel, grouped by folder
- **Table of contents** — Jump between headings via a collapsible TOC panel that shares the same slot as the file list panel; the selected heading tracks the render area's scroll position
- **Drag & drop** — Drop one or more Markdown files, or folders, onto the window to open them; folders are expanded recursively into their Markdown files. All are added to the file list, and the first one found is displayed, from either the start screen or the viewer
- **CLI argument** — Open a file directly: `mdview.exe path/to/file.md`
- **File watching** — Automatically reloads when the file is saved; files open in the background show an unread (●) indicator instead
- **Inline diff** — View changes against two baselines:
  - *Initial Diff* — diff against the content when the file was first opened
  - *Baseline Diff* — diff against a snapshot you set manually with **Update Baseline**
  - Opens in *Baseline Diff* mode by default; `Ctrl+D` toggles Normal ⇔ the last diff mode used
- **Syntax highlighting** — Code blocks highlighted via Prism.js (lazy-loaded)
- **Mermaid diagrams** — Renders `mermaid` code blocks as diagrams (lazy-loaded)
- **Callouts** — GitHub-style alert blockquotes are rendered as colored callout boxes:
  ```markdown
  > [!NOTE]
  > Highlights information that users should take into account.
  ```
  Supported types: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`
- **Link handling**
  - `.md` / `.markdown` links → opens the file in the same window, adding it to the file list (like a drag & drop)
  - `http://`, `https://`, `mailto:` links → opens in the system default browser
  - Other local file links → opens in the system default browser
  - `#heading` links → scrolls to the matching heading in the current file (headings get GitHub-style slug IDs, including non-ASCII text such as Japanese)
  - Hovering a link shows the resolved destination in a status bar at the bottom
- **Persistent toolbar** — Spans both the file list panel and the render area at the top of the window
- **Font selection** — Set the rendering font via an in-app dialog using any CSS `font` shorthand value (e.g. `bold 1.1em "Yu Gothic", sans-serif`); a live preview updates as you type; the value is saved and restored on next launch
- **Color themes** — Switch between Light, Dark, and System (follows OS setting) from the toolbar; preference is saved across sessions
- **Editor integration** — Register an external editor executable via the Menu; press `Ctrl+E` to open the current file in that editor
- **Zoom** — Scale the document view from 50% to 200% in 10% steps; a zoom indicator appears in the bottom-right corner on hover or when the zoom level changes
- **Front matter display** — YAML front matter (`---` blocks) is parsed and shown as a collapsible metadata table above the document body
- **Local image rendering** — Relative image paths are resolved against the markdown file's directory and embedded as base64 data URLs
- **Code block copy** — A **Copy** button appears on hover over any code block; clicking it copies the raw code to the clipboard
- **In-document search** — `Ctrl+F` or `/` opens a search bar; the `.*` button toggles regex matching (plain string search by default)

## Supported Markdown

Rendered via [goldmark](https://github.com/yuin/goldmark) with the following extensions enabled:

- GitHub Flavored Markdown (GFM): tables, strikethrough, task lists, autolinks
- Definition lists
- Callouts / alerts (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`)
- GitHub-style emoji shortcodes (e.g. `:smile:` → 😄), via [goldmark-emoji](https://github.com/yuin/goldmark-emoji)
- Raw HTML passthrough (`html.WithUnsafe`)

## Syntax Highlighting

Code blocks are highlighted by [Prism.js](https://prismjs.com/). Specify the language after the opening fence:

````markdown
```go
package main
```
````

Supported languages:

| Category | Languages (fence identifier) |
|---|---|
| Systems | `c`, `cpp`, `rust`, `go`, `swift` |
| JVM | `java`, `kotlin`, `scala` |
| Scripting | `python`, `ruby`, `perl`, `lua`, `r` |
| Shell | `bash`, `shell`, `powershell` |
| Web | `javascript`, `js`, `typescript`, `ts`, `jsx`, `tsx`, `css`, `html`, `xml`, `php`, `graphql` |
| Data / Config | `json`, `json5`, `yaml`, `toml`, `sql` |
| DevOps | `docker`, `makefile` |
| Other | `diff`, `markdown`, `go-module`, `vim` |

The theme switches automatically with the color scheme (Light/System/Dark).

## Usage

```
mdview.exe [file]
```

| Action | Result |
|---|---|
| Launch with no argument | Shows the drop screen |
| Drag & drop one or more `.md` files, or folders | Adds all of them to the file list (folders are expanded recursively); the first one found is shown in the viewer |
| Click the drop area or `Ctrl+O` | Opens a file picker dialog (multiple files can be selected at once) |
| `mdview.exe path/to/file.md` | Opens the file directly on launch |

### Toolbar

The toolbar is always visible and spans the full width of the window, above both the file list panel and the render area.

| Control | Description |
|---|---|
| **📁 (folder icon)** | Toggles the file list panel; opening this way does not move keyboard focus |
| **TOC** | Toggles the table of contents panel; opening this way does not move keyboard focus |
| **Normal** | Renders the current file as-is |
| **Initial Diff** | Highlights changes since the file was first opened |
| **Baseline Diff** | Highlights changes since the last **Update Baseline** |
| **Update Baseline** | Saves the current content as the new diff baseline |
| **Menu** | Opens a context menu with color scheme, editor, and font settings |

#### Menu

| Item | Description |
|---|---|
| **Color Scheme** | Switch between Light, Dark, and System (follows OS) using the inline buttons |
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

### File list panel

Toggle the panel via the folder icon on the toolbar or the `f` shortcut. Open files are grouped by their containing folder:

- Each file row shows its file name, plus an unread (●) indicator if it changed on disk while a different file was displayed
- Group headers show an abbreviated path (e.g. `C:\path\to\my\folder` → `C/p/t/m/folder`, with the leaf folder name shown in full) and can be collapsed by clicking; a group shows ● if any file inside it has unseen changes
- Click a file to display it in the render area
- Drag the divider between the panel and the render area to resize; the ratio (initially 30/70) is saved and restored on next launch
- Closing the last open file (`q`) quits the application

See [Keyboard shortcuts](#keyboard-shortcuts) below for the full set of file-list navigation keys.

### Table of contents panel

Toggle the panel via the **TOC** button on the toolbar or the `t` shortcut. It occupies the same slot as the file list panel, so opening one closes the other; the resize ratio is shared between them.

- Lists every `h1`–`h6` heading found in the current file, indented by level
- Click a heading (or select it and press `Enter`/`Space`/`t`) to scroll the render area to it
- While the panel is visible and keyboard focus is in the render area, the selected heading automatically tracks the current scroll position
- Jumps (from the TOC or an in-document link) are tracked per file, so `h`/`l` in the render area — or the mouse's back/forward side buttons — step back and forward through them

See [Keyboard shortcuts](#keyboard-shortcuts) below for the full set of TOC navigation keys.

### Keyboard shortcuts

Global (work regardless of which area has focus):

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open a file picker dialog (supports selecting multiple files at once) |
| `Ctrl+E` | Open current file in the configured editor |
| `Ctrl+F` or `/` | Open search panel |
| `F3` | Next match |
| `Shift+F3` | Previous match |
| `Ctrl+D` | Toggle diff mode: Normal ⇔ last used diff mode (Initial Diff or Baseline Diff) |
| `Ctrl++` | Zoom in 10% |
| `Ctrl+-` | Zoom out 10% |
| `Ctrl+=` | Reset zoom to 100% |

Render area (active when neither the file list panel nor the TOC panel has keyboard focus):

| Shortcut | Action |
|---|---|
| `f` | Show the file list panel and move focus to the current file's position |
| `t` | Show the TOC panel and move focus to the heading nearest the current scroll position |
| `Escape` | Close the menu if open, else close the search panel if open, else hide the file list panel or TOC panel if visible |
| `q` or `Ctrl+W` | Close the current file and switch to the next (or previous) one; quits the app if it's the last file open |
| `j` | Scroll down one line |
| `k` | Scroll up one line |
| `b` or `Shift+Space` | Scroll up one page |
| `g` | Scroll to top |
| `Shift+G` | Scroll to bottom |
| `h` | Jump back to the position before the last TOC selection or in-document link click |
| `l` | Jump forward again after `h` |

File list panel (active once focused via `f` or a click):

| Shortcut | Action |
|---|---|
| `Enter` / `Space` / `f` | On a file: opens it and moves focus to the render area. On a group: toggles its collapse and keeps focus in the panel |
| `Escape` | Hide the panel and move focus to the render area |
| `↑`/`↓` or `j`/`k` | Move focus between files and group headers |
| `q` | Close the focused file; quits the app if it's the last file open |
| `t` | Close the file list panel and show the TOC panel instead |

TOC panel (active once focused via `t` or a click):

| Shortcut | Action |
|---|---|
| `Enter` / `Space` / `t` | Scroll the render area to the selected heading and move focus there; the panel stays open |
| `Escape` | Hide the panel and move focus to the render area |
| `↑`/`↓` or `j`/`k` | Move focus between headings |
| `f` | Close the TOC panel and show the file list panel instead |

### Settings file

User preferences are saved to `mdview.json` and loaded automatically on next launch.

The file is searched in this order; the first found is used:

1. Same directory as the executable
2. OS user config directory — `mdview` subdirectory (`os.UserConfigDir()`)
   - Windows: `%APPDATA%\mdview\mdview.json`
   - macOS: `~/Library/Application Support/mdview/mdview.json`
   - Linux: `~/.config/mdview/mdview.json`

When saving for the first time (no existing file), it is written to the OS user config directory (`mdview` subdirectory).

The `font` field accepts any valid CSS `font` shorthand string. `fileListRatio` is the width fraction (0–1) given to the file list panel, updated whenever you drag the splitter:

```json
{
  "font": "bold 1.1em \"Yu Gothic\", sans-serif",
  "themeMode": "system",
  "editorPath": "",
  "fileListRatio": 0.3
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
