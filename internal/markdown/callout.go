package markdown

import (
	"html"
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// KindCallout is the AST kind of a callout block (GitHub alerts / Obsidian callouts).
var KindCallout = ast.NewNodeKind("Callout")

// Callout is a blockquote that starts with `[!TYPE]`.
type Callout struct {
	ast.BaseBlock
	CalloutType string // normalised type, e.g. "note"
	Title       string // explicit title, or "" for the default
	Fold        string // "", "+" (foldable, open) or "-" (foldable, closed)
}

func (n *Callout) Kind() ast.NodeKind { return KindCallout }
func (n *Callout) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Type": n.CalloutType, "Title": n.Title}, nil)
}

var calloutAliases = map[string]string{
	"summary": "abstract", "tldr": "abstract",
	"hint":  "tip",
	"check": "success", "done": "success",
	"help": "question", "faq": "question",
	"fail": "failure", "missing": "failure",
	"error":     "danger",
	"cite":      "quote",
	"attention": "warning",
}

var calloutRe = regexp.MustCompile(`^\s*\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*?)\s*$`)

type calloutTransformer struct{}

func (calloutTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	source := reader.Source()
	var quotes []*ast.Blockquote
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if bq, ok := n.(*ast.Blockquote); ok && entering {
			quotes = append(quotes, bq)
		}
		return ast.WalkContinue, nil
	})
	// Innermost first is not required: we only touch each quote's own first paragraph.
	for _, bq := range quotes {
		para, ok := bq.FirstChild().(*ast.Paragraph)
		if !ok || para.Lines().Len() == 0 {
			continue
		}
		first := para.Lines().At(0)
		m := calloutRe.FindSubmatch(first.Value(source))
		if m == nil {
			continue
		}
		typ := strings.ToLower(string(m[1]))
		if a, ok := calloutAliases[typ]; ok {
			typ = a
		}
		c := &Callout{CalloutType: typ, Title: string(m[3]), Fold: string(m[2])}
		c.SetPos(bq.Pos())

		// Drop the inline nodes belonging to the marker line.
		for child := para.FirstChild(); child != nil; {
			next := child.NextSibling()
			start := firstTextStart(child)
			if start >= 0 && start >= first.Stop {
				break
			}
			para.RemoveChild(para, child)
			child = next
		}
		if para.ChildCount() == 0 {
			bq.RemoveChild(bq, para)
		}
		for ch := bq.FirstChild(); ch != nil; ch = bq.FirstChild() {
			c.AppendChild(c, ch)
		}
		bq.Parent().ReplaceChild(bq.Parent(), bq, c)
	}
}

// firstTextStart returns the source offset of the first text segment in n, or -1.
func firstTextStart(n ast.Node) int {
	if t, ok := n.(*ast.Text); ok {
		return t.Segment.Start
	}
	if p := n.Pos(); p >= 0 && n.Type() == ast.TypeInline {
		return p
	}
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		if s := firstTextStart(c); s >= 0 {
			return s
		}
	}
	return -1
}

type calloutRenderer struct{}

func (calloutRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindCallout, renderCallout)
}

func renderCallout(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	c := node.(*Callout)
	tag := "div"
	if c.Fold != "" {
		tag = "details"
	}
	if entering {
		title := c.Title
		if title == "" {
			title = strings.ToUpper(c.CalloutType[:1]) + c.CalloutType[1:]
		}
		open := ""
		if c.Fold == "+" {
			open = " open"
		}
		titleTag := "div"
		if tag == "details" {
			titleTag = "summary"
		}
		t := html.EscapeString(c.CalloutType)
		_, _ = w.WriteString(`<` + tag + ` class="mdv-callout mdv-callout-` + t + `" data-callout="` + t + `"` + lineAttribute(c) + open + ">\n")
		_, _ = w.WriteString(`<` + titleTag + ` class="mdv-callout-title"><span class="mdv-callout-icon"></span><span class="mdv-callout-title-text">` +
			html.EscapeString(title) + `</span></` + titleTag + ">\n")
		_, _ = w.WriteString(`<div class="mdv-callout-body">` + "\n")
	} else {
		_, _ = w.WriteString("</div>\n</" + tag + ">\n")
	}
	return ast.WalkContinue, nil
}
