package main

import (
	"embed"
	"log"
	"os"
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
