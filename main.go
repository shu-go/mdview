package main

import (
	"embed"
	"log"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	svc := NewApp()
	wd, _ := os.Getwd()

	app := application.New(application.Options{
		Name:        "mdview",
		Description: "Markdown viewer",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: fileMiddleware,
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               "com.github.shu-go.mdview",
			OnSecondInstanceLaunch: svc.HandleSecondInstance,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{
			AdditionalBrowserArgs: debugBrowserArgs(),
		},
	})

	svc.app = app
	svc.newWindow(argPaths(os.Args, wd), nil, nil)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// debugBrowserArgs enables the WebView2 remote debugging (CDP) port when
// MDVIEW_REMOTE_DEBUG_PORT is set; used for automated UI tests.
func debugBrowserArgs() []string {
	port := os.Getenv("MDVIEW_REMOTE_DEBUG_PORT")
	if port == "" {
		return nil
	}
	for _, c := range port {
		if c < '0' || c > '9' {
			return nil
		}
	}
	return []string{"--remote-debugging-port=" + port}
}
