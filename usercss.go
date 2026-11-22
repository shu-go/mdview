package main

import (
	"path/filepath"
	"regexp"
	"strings"

	"github.com/shu-go/mdview/internal/markdown"
)

var cssURLRe = regexp.MustCompile(`url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"()\s]*))\s*\)`)

// rewriteCSSURLs makes relative url(...) references in the user stylesheet
// resolve against the stylesheet's directory. The stylesheet is installed as
// an inline <style>, so the webview would otherwise resolve them against the
// app page.
func rewriteCSSURLs(css, dir string) string {
	return cssURLRe.ReplaceAllStringFunc(css, func(m string) string {
		sub := cssURLRe.FindStringSubmatch(m)
		ref := sub[1] + sub[2] + sub[3]
		if !isRelativeCSSRef(ref) {
			return m
		}
		p := ref
		if i := strings.IndexAny(p, "?#"); i >= 0 {
			p = p[:i]
		}
		abs := filepath.Clean(filepath.Join(dir, filepath.FromSlash(p)))
		return `url("` + markdown.FileURL(abs) + `")`
	})
}

func isRelativeCSSRef(ref string) bool {
	if ref == "" || strings.HasPrefix(ref, "#") || strings.HasPrefix(ref, "/") || strings.HasPrefix(ref, `\`) {
		return false
	}
	if filepath.IsAbs(ref) || filepath.VolumeName(ref) != "" {
		return false
	}
	// scheme (data:, http:, blob: ...)
	if i := strings.Index(ref, ":"); i > 0 && !strings.ContainsAny(ref[:i], `/\.`) {
		return false
	}
	return true
}
