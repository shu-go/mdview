package main

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// headingIDASTTransformer assigns GitHub-style "id" attributes to headings,
// preserving non-ASCII characters (e.g. Japanese) so in-document links like
// "[text](#見出し)" resolve. goldmark's built-in parser.WithAutoHeadingID()
// strips all non-ASCII characters, which breaks such links.

var slugStripRe = regexp.MustCompile(`[^\p{L}\p{N}\p{M}\s_-]+`)
var slugSpaceRe = regexp.MustCompile(`\s+`)

func slugify(s string) string {
	s = strings.ToLower(s)
	s = slugStripRe.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	s = slugSpaceRe.ReplaceAllString(s, "-")
	return s
}

// headingPlainText concatenates the text content of a heading node, the same
// way a browser's el.textContent would for the rendered <h1>-<h6>.
func headingPlainText(n ast.Node, source []byte) string {
	var buf bytes.Buffer
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			if t, ok := c.(*ast.Text); ok {
				buf.Write(t.Segment.Value(source))
			}
		}
		return ast.WalkContinue, nil
	})
	return buf.String()
}

type headingIDASTTransformer struct{}

func (t *headingIDASTTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	source := reader.Source()
	seen := make(map[string]int)
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		h, ok := n.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		if _, exists := h.AttributeString("id"); exists {
			return ast.WalkContinue, nil
		}

		slug := slugify(headingPlainText(h, source))
		if slug == "" {
			slug = "heading"
		}
		if count, dup := seen[slug]; dup {
			seen[slug] = count + 1
			slug = fmt.Sprintf("%s-%d", slug, count)
		} else {
			seen[slug] = 1
		}
		h.SetAttributeString("id", []byte(slug))
		return ast.WalkContinue, nil
	})
}

type headingIDExtension struct{}

// HeadingID is a goldmark extension that assigns Unicode-safe "id"
// attributes to headings for anchor-link navigation.
var HeadingID = &headingIDExtension{}

func (e *headingIDExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(
		util.Prioritized(&headingIDASTTransformer{}, 500),
	))
}
