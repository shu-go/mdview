//go:build !production

package main

import "os"

// singleInstanceID differs from production builds, so that a development build
// (UI tests) never hands its files to a running production mdview.
const singleInstanceID = "com.github.shu-go.mdview.dev"

// debugBrowserArgs enables the WebView2 remote debugging (CDP) port when
// MDVIEW_REMOTE_DEBUG_PORT is set; used for automated UI tests. Development
// builds only: anyone reaching the port controls the app.
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
