//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideConsole prevents a console window from flashing for console programs.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
