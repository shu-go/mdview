package markdown

import (
	"bytes"
	"unicode/utf8"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// linkifyTransformer links bare http(s) URLs that directly follow a
// non-space character, e.g. "参照：https://example.com" or
// "「https://example.com」". GFM's linkify only starts after a space, '*',
// '_', '~', '(' or at a line head, which misses most URLs in Japanese text.
// URL matching and trailing punctuation handling are delegated to goldmark's
// linkify parser.
type linkifyTransformer struct{}

var (
	linkifyParser = extension.NewLinkifyParser()
	httpPrefix    = []byte("http://")
	httpsPrefix   = []byte("https://")
)

func (linkifyTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	source := reader.Source()
	var parents []ast.Node
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n.Kind() {
		case ast.KindLink, ast.KindAutoLink, ast.KindImage, ast.KindCodeSpan, ast.KindRawHTML:
			return ast.WalkSkipChildren, nil
		case ast.KindText:
			if p := n.Parent(); len(parents) == 0 || parents[len(parents)-1] != p {
				parents = append(parents, p)
			}
		}
		return ast.WalkContinue, nil
	})
	for _, p := range parents {
		linkifyChildren(p, source)
	}
}

// linkifyChildren scans runs of source-contiguous Text children of p.
func linkifyChildren(p ast.Node, source []byte) {
	for c := p.FirstChild(); c != nil; {
		t, ok := c.(*ast.Text)
		if !ok || t.IsRaw() {
			c = c.NextSibling()
			continue
		}
		// merge following Text nodes that continue it in the source (goldmark
		// splits text at punctuation such as '_' or '&')
		for {
			next, ok := t.NextSibling().(*ast.Text)
			if !ok || next.IsRaw() || t.SoftLineBreak() || t.HardLineBreak() || t.Segment.Stop != next.Segment.Start {
				break
			}
			if !bytes.Contains(t.Segment.Value(source), []byte("http")) && !bytes.Contains(next.Segment.Value(source), []byte("http")) {
				break // nothing to link; keep the tree as is
			}
			t.Segment = t.Segment.WithStop(next.Segment.Stop)
			t.SetSoftLineBreak(next.SoftLineBreak())
			t.SetHardLineBreak(next.HardLineBreak())
			p.RemoveChild(p, next)
		}
		c = linkifyText(p, t, source)
	}
}

// linkifyText replaces URLs in t with AutoLink nodes and returns the node
// following the processed text.
func linkifyText(p ast.Node, t *ast.Text, source []byte) ast.Node {
	for {
		v := t.Segment.Value(source)
		start, length := findURL(v)
		if start < 0 {
			return t.NextSibling()
		}
		seg := t.Segment
		urlSeg := text.NewSegment(seg.Start+start, seg.Start+start+length)
		link := ast.NewAutoLink(ast.AutoLinkURL, ast.NewTextSegment(urlSeg))
		if start > 0 {
			before := ast.NewTextSegment(seg.WithStop(urlSeg.Start))
			p.InsertBefore(p, t, before)
		}
		p.InsertBefore(p, t, link)
		if urlSeg.Stop == seg.Stop {
			// URL ends the text: t itself is no longer needed, but its line
			// break must survive
			if t.SoftLineBreak() || t.HardLineBreak() {
				rest := ast.NewTextSegment(seg.WithStart(seg.Stop))
				rest.SetSoftLineBreak(t.SoftLineBreak())
				rest.SetHardLineBreak(t.HardLineBreak())
				p.InsertBefore(p, t, rest)
			}
			next := t.NextSibling()
			p.RemoveChild(p, t)
			return next
		}
		t.Segment = seg.WithStart(urlSeg.Stop)
	}
}

// findURL returns the offset and length of the first linkable URL in v, or
// -1. A URL must not continue a word or a path ("xhttp://", "a/https://").
func findURL(v []byte) (int, int) {
	for off := 0; off < len(v); {
		i := bytes.Index(v[off:], []byte("http"))
		if i < 0 {
			return -1, 0
		}
		i += off
		off = i + 1
		rest := v[i:]
		if !bytes.HasPrefix(rest, httpPrefix) && !bytes.HasPrefix(rest, httpsPrefix) {
			continue
		}
		if i > 0 {
			if r, _ := utf8.DecodeLastRune(v[:i]); r < utf8.RuneSelf && (isASCIIAlnum(byte(r)) || r == '/') {
				continue
			}
		}
		if n := matchURL(rest); n > 0 {
			return i, n
		}
	}
	return -1, 0
}

// matchURL returns the length of the URL at the head of s using goldmark's
// linkify rules, or 0.
func matchURL(s []byte) int {
	root := ast.NewParagraph()
	node := linkifyParser.Parse(root, text.NewReader(s), parser.NewContext())
	link, ok := node.(*ast.AutoLink)
	if !ok {
		return 0
	}
	return len(link.Label(s))
}

func isASCIIAlnum(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}
