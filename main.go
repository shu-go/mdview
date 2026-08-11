package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	appl := application.New(application.Options{
		Name: "mdview",
		Services: []application.Service{
			application.NewService(app),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		// Route a second `mdview` launch into this instance instead of opening
		// a separate process: bring the window to front, and if paths were
		// passed, open them the same way a native drag & drop would.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.github.shu-go.mdview", // matches build/config.yml's productIdentifier
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if win := application.Get().Window.Current(); win != nil {
					win.Show()
					// Plain Focus() often only blinks the taskbar icon instead
					// of raising the window — Windows' foreground-lock denies
					// SetForegroundWindow requests that aren't tied to a live
					// input event on this process. Cycling minimise→restore
					// forces the window manager to actually raise it.
					win.Minimise()
					win.UnMinimise()
					win.Focus()
				}
				if paths := resolveArgPaths(data); len(paths) > 0 {
					application.Get().Event.Emit("files-dropped", paths)
				}
			},
		},
	})

	// On Windows, when a file is passed on the command line, start minimised
	// and let the frontend un-minimise once the document has finished rendering.
	// This hides the brief flash of the drop-target window on launch.
	startState := application.WindowStateNormal
	if runtime.GOOS == "windows" && len(os.Args) > 1 {
		startState = application.WindowStateMinimised
	}

	win := appl.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "mdview",
		Width:            1024,
		Height:           768,
		StartState:       startState,
		BackgroundColour: application.NewRGBA(27, 38, 54, 1),
		EnableFileDrop:   true,
		URL:              "/",
	})

	// Native OS drag & drop of files/folders onto the window. Elements with the
	// `data-file-drop-target` attribute (see frontend/index.html) are drop targets;
	// forward the dropped paths to the frontend so it can expand folders and
	// filter by extension the same way it always has.
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		appl.Event.Emit("files-dropped", files)
	})

	if err := appl.Run(); err != nil {
		log.Fatal(err)
	}
}

// resolveArgPaths extracts the file/folder paths passed to a second instance
// launch, resolving any relative paths against that instance's working
// directory (which may differ from this, the first instance's, cwd).
func resolveArgPaths(data application.SecondInstanceData) []string {
	if len(data.Args) <= 1 {
		return nil
	}
	paths := make([]string, 0, len(data.Args)-1)
	for _, arg := range data.Args[1:] {
		if arg == "" {
			continue
		}
		if !filepath.IsAbs(arg) && data.WorkingDir != "" {
			arg = filepath.Join(data.WorkingDir, arg)
		}
		paths = append(paths, arg)
	}
	return paths
}
