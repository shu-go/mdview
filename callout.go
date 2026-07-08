package main

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// GitHub-style alert callouts: a blockquote whose first line is a
// "[!TYPE]" marker, e.g.:
//
//	> [!NOTE]
//	> Highlights information that users should take into account.

var calloutMarkerRe = regexp.MustCompile(`^\[!([A-Za-z]+)\]\s*$`)

var calloutLabels = map[string]string{
	"note":      "Note",
	"tip":       "Tip",
	"important": "Important",
	"warning":   "Warning",
	"caution":   "Caution",
}

// calloutKind is the NodeKind for callout blocks.
var calloutKind = ast.NewNodeKind("Callout")

// calloutNode replaces a Blockquote node once its "[!TYPE]" marker is recognized.
type calloutNode struct {
	ast.BaseBlock
	Variant string
}

func newCalloutNode(variant string) *calloutNode {
	return &calloutNode{Variant: variant}
}

func (n *calloutNode) Kind() ast.NodeKind {
	return calloutKind
}

func (n *calloutNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Variant": n.Variant}, nil)
}

// calloutASTTransformer rewrites recognized blockquotes into calloutNodes.
type calloutASTTransformer struct{}

func (t *calloutASTTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	var targets []*ast.Blockquote
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			if bq, ok := n.(*ast.Blockquote); ok {
				targets = append(targets, bq)
			}
		}
		return ast.WalkContinue, nil
	})

	source := reader.Source()
	for _, bq := range targets {
		variant, ok := stripCalloutMarker(bq, source)
		if !ok {
			continue
		}
		callout := newCalloutNode(variant)
		for c := bq.FirstChild(); c != nil; {
			next := c.NextSibling()
			bq.RemoveChild(bq, c)
			callout.AppendChild(callout, c)
			c = next
		}
		parent := bq.Parent()
		if parent != nil {
			parent.ReplaceChild(parent, bq, callout)
		}
	}
}

// stripCalloutMarker checks whether bq's first paragraph starts with a
// "[!TYPE]" marker line and, if so, removes that line from the paragraph
// (and the paragraph itself, if it becomes empty) and returns the variant.
func stripCalloutMarker(bq *ast.Blockquote, source []byte) (string, bool) {
	first, ok := bq.FirstChild().(*ast.Paragraph)
	if !ok {
		return "", false
	}
	lines := first.Lines()
	if lines.Len() == 0 {
		return "", false
	}
	line := lines.At(0)
	trimmed := bytes.TrimSpace(line.Value(source))
	m := calloutMarkerRe.FindSubmatch(trimmed)
	if m == nil {
		return "", false
	}
	variant := strings.ToLower(string(m[1]))
	if _, known := calloutLabels[variant]; !known {
		return "", false
	}

	child := first.FirstChild()
	for child != nil {
		next := child.NextSibling()
		txt, isText := child.(*ast.Text)
		if !isText || txt.Segment.Start >= line.Stop {
			break
		}
		first.RemoveChild(first, child)
		brk := txt.SoftLineBreak() || txt.HardLineBreak()
		child = next
		if brk {
			break
		}
	}

	if first.ChildCount() == 0 {
		bq.RemoveChild(bq, first)
	}

	return variant, true
}

// calloutHTMLRenderer renders calloutNodes to HTML.
type calloutHTMLRenderer struct{}

func (r *calloutHTMLRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(calloutKind, r.renderCallout)
}

func (r *calloutHTMLRenderer) renderCallout(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	node := n.(*calloutNode)
	if entering {
		fmt.Fprintf(w, "<div class=\"markdown-callout markdown-callout-%s\">\n", node.Variant)
		fmt.Fprintf(w, "<p class=\"markdown-callout-title\">%s</p>\n", calloutLabels[node.Variant])
	} else {
		_, _ = w.WriteString("</div>\n")
	}
	return ast.WalkContinue, nil
}

type calloutExtension struct{}

// Callout is a goldmark extension that renders GitHub-style alert
// blockquotes ("> [!NOTE]", "> [!TIP]", "> [!IMPORTANT]", "> [!WARNING]",
// "> [!CAUTION]") as callout boxes.
var Callout = &calloutExtension{}

func (e *calloutExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(
		util.Prioritized(&calloutASTTransformer{}, 100),
	))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(
		util.Prioritized(&calloutHTMLRenderer{}, 500),
	))
}
