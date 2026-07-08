package main

import (
	"embed"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// On Windows, when a file is passed on the command line, start minimised
	// and let the frontend un-minimise once the document has finished rendering.
	// This hides the brief flash of the drop-target window on launch.
	startState := options.Normal
	if runtime.GOOS == "windows" && len(os.Args) > 1 {
		startState = options.Minimised
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:            "mdview",
		Width:            1024,
		Height:           768,
		WindowStartState: startState,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
