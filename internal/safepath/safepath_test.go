package safepath

import (
	"runtime"
	"testing"
)

func TestIsNetwork(t *testing.T) {
	if runtime.GOOS != "windows" {
		if !IsNetwork("//server/share") || IsNetwork("/home/x.png") {
			t.Error("unix")
		}
		return
	}
	for _, p := range []string{`\\server\share\a.png`, `//server/share/a.png`, `\/server/share/a.png`, `/\server\share`, `\\?\UNC\server\share`, `\\.\pipe\x`, `\\?\C:\a.png`} {
		if !IsNetwork(p) {
			t.Errorf("%s should be a network path", p)
		}
	}
	for _, p := range []string{`C:\a\b.png`, `c:/a/b.png`} {
		if IsNetwork(p) {
			t.Errorf("%s should be local", p)
		}
	}
}
