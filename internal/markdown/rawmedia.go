package markdown

import (
	"html"
	"regexp"
	"strings"
)

// rawMediaRe matches src / poster attributes of media elements in raw HTML.
var rawMediaRe = regexp.MustCompile(`(?i)(<(?:img|source|video|audio)\b[^>]*?\s(?:src|poster)\s*=\s*)("[^"]*"|'[^']*'|[^\s>"']+)`)

// rewriteRawMedia resolves local media paths in raw HTML (<img src="...">,
// absolute paths, file: URLs, paths with spaces) to the local file URL, before
// sanitising, which would otherwise drop them as invalid URLs.
func rewriteRawMedia(s, docDir string) string {
	if !strings.Contains(s, "src") && !strings.Contains(s, "poster") {
		return s
	}
	return rawMediaRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := rawMediaRe.FindStringSubmatch(m)
		prefix, val := sub[1], sub[2]
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') {
			val = val[1 : len(val)-1]
		}
		src := html.UnescapeString(strings.TrimSpace(val))
		if src == "" || strings.HasPrefix(src, FileURLPrefix) || strings.HasPrefix(src, "//") || strings.HasPrefix(src, "data:") ||
			(IsExternalURL(src) && !strings.HasPrefix(strings.ToLower(src), "file:")) {
			return m
		}
		abs, _ := ResolveLocal(docDir, src)
		if abs == "" {
			return m
		}
		return prefix + `"` + html.EscapeString(FileURL(abs)) + `"`
	})
}
