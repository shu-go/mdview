// Package markdown renders Markdown documents to HTML for mdview.
package markdown

import (
	"bytes"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	emoji "github.com/yuin/goldmark-emoji"
	emojiast "github.com/yuin/goldmark-emoji/ast"

	"github.com/shu-go/mdview/internal/safepath"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// FileURLPrefix is the URL path under which local files are served.
const FileURLPrefix = "/_mdv/file?p="

// FileURL returns the URL serving a local file. The file's modification time
// is part of the URL, so a re-render after the file changed loads it again
// instead of reusing the webview's in-memory image cache.
func FileURL(abs string) string {
	u := FileURLPrefix + url.QueryEscape(abs)
	if safepath.IsNetwork(abs) {
		return u // never touch network paths while rendering (NTLM leak); the server refuses them
	}
	if st, err := os.Stat(abs); err == nil {
		u += "&v=" + strconv.FormatInt(st.ModTime().UnixNano(), 36)
	}
	return u
}

// Heading is an entry of the document outline.
type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
}

// Result is a rendered document.
type Result struct {
	HTML     string    `json:"html"`
	Headings []Heading `json:"headings"`
	// Changes is the number of changed regions when rendered with a diff base.
	Changes int `json:"changes"`
}

type parsed struct {
	source []byte // original source (front matter intact)
	doc    ast.Node
	md     goldmark.Markdown
}

func newMarkdown(docDir string) goldmark.Markdown {
	return goldmark.New(
		goldmark.WithExtensions(
			extension.GFM,
			extension.Footnote,
			extension.DefinitionList,
			emoji.New(emoji.WithRenderingMethod(emoji.Unicode)),
		),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
			parser.WithASTTransformers(
				util.Prioritized(calloutTransformer{}, 100),
				util.Prioritized(linkTransformer{docDir: docDir}, 200),
			),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
			renderer.WithNodeRenderers(
				util.Prioritized(codeBlockRenderer{}, 100),
				util.Prioritized(calloutRenderer{}, 100),
				util.Prioritized(frontMatterRenderer{}, 100),
				util.Prioritized(diffRenderer{}, 100),
			),
		),
	)
}

func parse(source []byte, docPath, idPrefix string) *parsed {
	docDir := ""
	if docPath != "" {
		docDir = filepath.Dir(docPath)
	}
	md := newMarkdown(docDir)
	raw, body, _ := splitFrontMatter(source)
	pc := parser.NewContext(parser.WithIDs(newHeadingIDs(idPrefix)))
	doc := md.Parser().Parse(text.NewReader(body), parser.WithContext(pc))
	annotateLines(doc, source)
	if raw != "" {
		fm := &FrontMatter{Raw: raw}
		fm.SetPos(0)
		doc.InsertBefore(doc, doc.FirstChild(), fm)
	}
	return &parsed{source: source, doc: doc, md: md}
}

// annotateLines sets data-line (1-based source line) on top-level blocks so
// the frontend can open the editor at the viewed position.
func annotateLines(doc ast.Node, source []byte) {
	line, last := 1, 0
	for n := doc.FirstChild(); n != nil; n = n.NextSibling() {
		pos := n.Pos()
		if pos < 0 && n.Lines().Len() > 0 {
			pos = n.Lines().At(0).Start
		}
		if pos < last || pos > len(source) {
			continue
		}
		line += bytes.Count(source[last:pos], []byte{'\n'})
		last = pos
		n.SetAttributeString("data-line", []byte(strconv.Itoa(line)))
	}
}

func (p *parsed) render(n ast.Node) string {
	var buf bytes.Buffer
	_ = p.md.Renderer().Render(&buf, p.source, n)
	return buf.String()
}

// Render renders source. docPath is used to resolve relative links and images.
func Render(source []byte, docPath string) Result {
	p := parse(source, docPath, "")
	return Result{HTML: finalize(p.render(p.doc), docPath), Headings: collectHeadings(p.doc, p.source)}
}

// RenderDiff renders source, marking top-level blocks that differ from base:
// added blocks are wrapped in .mdv-diff-ins and removed ones (rendered from
// base) are inserted wrapped in .mdv-diff-del.
func RenderDiff(base, source []byte, docPath string) Result {
	if bytes.Equal(base, source) {
		return Render(source, docPath)
	}
	oldP := parse(base, docPath, "mdv-del-")
	newP := parse(source, docPath, "")
	changes := applyDiff(oldP, newP)
	return Result{HTML: finalize(newP.render(newP.doc), docPath), Headings: collectHeadings(newP.doc, newP.source), Changes: changes}
}

// finalize resolves raw HTML media paths and sanitises the document HTML.
func finalize(s, docPath string) string {
	docDir := ""
	if docPath != "" {
		docDir = filepath.Dir(docPath)
	}
	return Sanitize(rewriteRawMedia(s, docDir))
}

func collectHeadings(doc ast.Node, source []byte) []Heading {
	hs := []Heading{}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n.Kind() {
		case KindDiffDeleted:
			return ast.WalkSkipChildren, nil
		case ast.KindHeading:
			h := n.(*ast.Heading)
			id, _ := h.AttributeString("id")
			idStr := ""
			if b, ok := id.([]byte); ok {
				idStr = string(b)
			}
			hs = append(hs, Heading{Level: h.Level, Text: plainText(h, source), ID: idStr})
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return hs
}

// plainText concatenates the text content of n.
func plainText(n ast.Node, source []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := c.(type) {
		case *ast.Text:
			b.Write(t.Segment.Value(source))
			if t.SoftLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(t.Value)
		case *ast.CodeSpan:
			for cc := t.FirstChild(); cc != nil; cc = cc.NextSibling() {
				if tt, ok := cc.(*ast.Text); ok {
					b.Write(tt.Segment.Value(source))
				}
			}
			return ast.WalkSkipChildren, nil
		case *emojiast.Emoji:
			if t.Value != nil && len(t.Value.Unicode) > 0 {
				b.WriteString(string(t.Value.Unicode))
			} else {
				b.WriteString(":" + string(t.ShortName) + ":")
			}
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(b.String())
}

var schemeRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.\-]*:`)
var winDriveRe = regexp.MustCompile(`^[a-zA-Z]:[\\/]`)

// IsExternalURL reports whether dest has a URL scheme (not a Windows drive).
func IsExternalURL(dest string) bool {
	return schemeRe.MatchString(dest) && !winDriveRe.MatchString(dest)
}

// ResolveLocal resolves a link destination relative to docDir. It returns the
// absolute path and the fragment (without '#').
func ResolveLocal(docDir, dest string) (string, string) {
	frag := ""
	if i := strings.IndexByte(dest, '#'); i >= 0 {
		frag = dest[i+1:]
		dest = dest[:i]
	}
	if i := strings.IndexByte(dest, '?'); i >= 0 {
		dest = dest[:i]
	}
	if u, err := url.PathUnescape(dest); err == nil {
		dest = u
	}
	if f, err := url.PathUnescape(frag); err == nil {
		frag = f
	}
	if dest == "" {
		return "", frag
	}
	if strings.HasPrefix(dest, "file://") {
		dest = strings.TrimPrefix(dest, "file://")
		if winDriveRe.MatchString(strings.TrimPrefix(dest, "/")) {
			dest = strings.TrimPrefix(dest, "/")
		}
	}
	p := filepath.FromSlash(dest)
	if !filepath.IsAbs(p) && docDir != "" {
		p = filepath.Join(docDir, p)
	}
	return filepath.Clean(p), frag
}

// linkTransformer annotates links and rewrites local image sources.
type linkTransformer struct{ docDir string }

func (t linkTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch l := n.(type) {
		case *ast.Link:
			dest := string(l.Destination)
			switch {
			case strings.HasPrefix(dest, "#"):
				frag := dest[1:]
				if u, err := url.PathUnescape(frag); err == nil {
					frag = u
				}
				l.SetAttributeString("data-mdv-anchor", []byte(frag))
			case IsExternalURL(dest) && !strings.HasPrefix(dest, "file:"):
				l.SetAttributeString("data-mdv-external", []byte("1"))
			default:
				abs, frag := ResolveLocal(t.docDir, dest)
				if abs != "" {
					l.SetAttributeString("data-mdv-path", []byte(abs))
				}
				if frag != "" {
					l.SetAttributeString("data-mdv-anchor", []byte(frag))
				}
			}
		case *ast.AutoLink:
			// rendered with href; the frontend treats scheme URLs as external
		case *ast.Image:
			dest := string(l.Destination)
			if dest != "" && !IsExternalURL(dest) && !strings.HasPrefix(dest, "//") {
				abs, _ := ResolveLocal(t.docDir, dest)
				if abs != "" {
					l.Destination = []byte(FileURL(abs))
				}
			} else if strings.HasPrefix(dest, "file:") {
				abs, _ := ResolveLocal(t.docDir, dest)
				l.Destination = []byte(FileURL(abs))
			}
		}
		return ast.WalkContinue, nil
	})
}
