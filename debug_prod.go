//go:build production

package main

// debugBrowserArgs: production builds never open a remote debugging port.
func debugBrowserArgs() []string { return nil }
