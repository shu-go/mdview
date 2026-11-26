package markdown

import (
	"bytes"
	"hash/fnv"
	"html"
	"strconv"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Plain text files are shown as blocks of lines: paragraphs separated by
// blank lines, long paragraphs cut into chunks. Each block is a top-level AST
// node, so the block diff, data-line and the frontend (inline diff, search,
// scroll marks) work as for Markdown. http(s) URLs become links.

// KindTextBlock is a block of plain text lines.
var KindTextBlock = ast.NewNodeKind("TextBlock")

type textBlock struct {
	ast.BaseBlock
	cont bool // continues the previous block's paragraph (a chunk cut)
}

func (n *textBlock) Kind() ast.NodeKind            { return KindTextBlock }
func (n *textBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// Chunking of long paragraphs. Cuts are content defined (after a line whose
// hash hits) so that inserting a line only changes the chunk around it; the
// maximum bounds paragraphs without such lines.
const (
	textChunkMin  = 16
	textChunkMax  = 64
	textChunkMask = 15 // cut after a line when hash&mask == 0 (1 in 16)
)

type textBlockRenderer struct{}

func (textBlockRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindTextBlock, renderTextBlock)
}

func renderTextBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	class := "mdv-text-block"
	if node.(*textBlock).cont {
		class += " mdv-text-block-cont"
	}
	_, _ = w.WriteString(`<p class="` + class + `"` + lineAttribute(node) + `>`)
	// Each line carries its number in data-line; the stylesheet shows it
	// (::before), so it is neither text (search, copy, inline diff) nor part
	// of the block diff key (data-line is stripped there).
	for ln := node.FirstChild(); ln != nil; ln = ln.NextSibling() {
		_, _ = w.WriteString(`<span class="mdv-text-line"` + lineAttribute(ln) + `>`)
		for c := ln.FirstChild(); c != nil; c = c.NextSibling() {
			switch t := c.(type) {
			case *ast.Text:
				_, _ = w.WriteString(html.EscapeString(string(t.Segment.Value(source))))
			case *ast.AutoLink:
				u := html.EscapeString(string(t.URL(source)))
				_, _ = w.WriteString(`<a href="` + u + `">` + html.EscapeString(string(t.Label(source))) + `</a>`)
			}
		}
		_, _ = w.WriteString("\n</span>")
	}
	_, _ = w.WriteString("</p>\n")
	return ast.WalkSkipChildren, nil
}

// KindTextLine is one line of a text block; its children are the line's
// text and links.
var KindTextLine = ast.NewNodeKind("TextLine")

type textLineNode struct{ ast.BaseInline }

func (n *textLineNode) Kind() ast.NodeKind            { return KindTextLine }
func (n *textLineNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

func newTextRenderer() goldmark.Markdown {
	return goldmark.New(goldmark.WithRendererOptions(renderer.WithNodeRenderers(
		util.Prioritized(textBlockRenderer{}, 100),
		util.Prioritized(diffRenderer{}, 100),
	)))
}

type srcLine struct {
	seg   text.Segment // without the line break
	line  int          // 1-based
	blank bool
}

func splitLines(source []byte) []srcLine {
	var lines []srcLine
	for start, n := 0, 1; start < len(source); n++ {
		end := bytes.IndexByte(source[start:], '\n')
		next := len(source)
		if end < 0 {
			end = len(source)
		} else {
			end += start
			next = end + 1
		}
		stop := end
		if stop > start && source[stop-1] == '\r' {
			stop--
		}
		lines = append(lines, srcLine{
			seg:   text.NewSegment(start, stop),
			line:  n,
			blank: len(bytes.TrimSpace(source[start:stop])) == 0,
		})
		start = next
	}
	return lines
}

func cutAfter(v []byte) bool {
	h := fnv.New32a()
	_, _ = h.Write(bytes.TrimSpace(v))
	return h.Sum32()&textChunkMask == 0
}

// parseText builds the block tree of a plain text document.
func parseText(source []byte) *parsed {
	doc := ast.NewDocument()
	var cur *textBlock
	var count int
	cut := false // the previous block ended at a chunk cut, not a blank line
	flush := func() {
		if cur != nil {
			doc.AppendChild(doc, cur)
		}
		cur, count = nil, 0
	}
	for _, l := range splitLines(source) {
		if l.blank {
			flush()
			cut = false
			continue
		}
		if cur == nil {
			cur = &textBlock{cont: cut}
			cut = false
			cur.SetAttributeString("data-line", []byte(strconv.Itoa(l.line)))
		}
		ln := &textLineNode{}
		ln.SetAttributeString("data-line", []byte(strconv.Itoa(l.line)))
		ln.AppendChild(ln, ast.NewTextSegment(l.seg))
		linkifyChildren(ln, source)
		cur.AppendChild(cur, ln)
		count++
		if count >= textChunkMax || (count >= textChunkMin && cutAfter(l.seg.Value(source))) {
			flush()
			cut = true
		}
	}
	flush()
	return &parsed{source: source, doc: doc, md: newTextRenderer()}
}

// RenderText renders a plain text document.
func RenderText(source []byte) Result {
	p := parseText(source)
	return Result{HTML: Sanitize(p.render(p.doc)), Headings: []Heading{}}
}

// RenderTextDiff renders a plain text document, marking the blocks that
// differ from base (see RenderDiff).
func RenderTextDiff(base, source []byte) Result {
	if bytes.Equal(base, source) {
		return RenderText(source)
	}
	oldP, newP := parseText(base), parseText(source)
	changes := applyDiff(oldP, newP)
	return Result{HTML: Sanitize(newP.render(newP.doc)), Headings: []Heading{}, Changes: changes}
}
