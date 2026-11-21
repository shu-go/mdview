// Package safepath decides whether a path may be touched on behalf of an
// untrusted document.
package safepath

import (
	"path/filepath"
	"runtime"
	"strings"
)

// IsNetwork reports whether p may refer to a network location (UNC, device or
// mixed-separator forms). Accessing such a path - even a stat - can make
// Windows connect to a remote host and send NTLM credentials. On Windows only
// drive-letter volumes are considered local.
func IsNetwork(p string) bool {
	if runtime.GOOS != "windows" {
		return strings.HasPrefix(p, "//")
	}
	p = filepath.Clean(filepath.FromSlash(p))
	vol := filepath.VolumeName(p)
	return !(len(vol) == 2 && vol[1] == ':')
}
