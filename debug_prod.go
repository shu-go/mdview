//go:build production

package main

const singleInstanceID = "com.github.shu-go.mdview"

// debugBrowserArgs: production builds never open a remote debugging port.
func debugBrowserArgs() []string { return nil }
