package markdown

import (
	"regexp"
	"sync"

	"github.com/microcosm-cc/bluemonday"
)

// Raw HTML in Markdown is allowed (READMEs use <details>, <img width>, <kbd>,
// ...), but scripts and event handlers are not: the page can call the Go
// bindings, so a malicious document must not be able to run code.
var (
	policyOnce sync.Once
	policy     *bluemonday.Policy
)

func sanitizer() *bluemonday.Policy {
	policyOnce.Do(func() {
		p := bluemonday.UGCPolicy()
		p.AllowAttrs("class", "id", "title", "dir", "lang", "align").Globally()
		// Only the data attributes mdview itself generates; in particular not
		// the Wails runtime's data-wml-* action attributes.
		p.AllowAttrs("data-lang", "data-callout", "data-line").Globally()
		p.AllowAttrs("data-mdv-anchor", "data-mdv-path", "data-mdv-external").OnElements("a")
		p.AllowAttrs("open").OnElements("details")
		p.AllowElements("details", "summary", "button", "kbd", "mark", "ins", "del", "sub", "sup", "s", "u", "small", "abbr", "picture", "source", "video", "audio", "figure", "figcaption", "center", "font")
		p.AllowAttrs("type").OnElements("button")
		p.AllowAttrs("type", "checked", "disabled").OnElements("input")
		p.AllowElements("input")
		p.AllowAttrs("width", "height", "align", "alt", "loading").OnElements("img")
		p.AllowAttrs("src", "srcset", "type", "media").OnElements("source")
		p.AllowAttrs("src", "controls", "width", "height", "poster", "loop", "muted", "autoplay").OnElements("video", "audio")
		p.AllowAttrs("color", "size", "face").OnElements("font")
		p.AllowAttrs("start", "reversed", "type").OnElements("ol")
		p.AllowAttrs("colspan", "rowspan", "align", "valign").OnElements("td", "th")
		p.AllowAttrs("style").Matching(regexp.MustCompile(`^[\w\s:;%#.,()'"-]*$`)).Globally()
		p.AllowURLSchemes("http", "https", "mailto")
		p.AllowRelativeURLs(true)
		p.RequireNoFollowOnLinks(false)
		p.AllowDataURIImages()
		policy = p
	})
	return policy
}

// Sanitize removes scripts, event handlers and other unsafe markup.
func Sanitize(html string) string {
	return sanitizer().Sanitize(html)
}
