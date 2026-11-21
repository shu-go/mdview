package markdown

import (
	"bytes"
	"html"
	"strings"

	"github.com/alecthomas/chroma/v2"
	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// codeBlockRenderer renders fenced/indented code blocks with chroma (CSS
// classes, colours come from the stylesheet) and mermaid blocks as
// placeholders that the frontend turns into SVG with pele.
type codeBlockRenderer struct{}

func (codeBlockRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindFencedCodeBlock, renderCodeBlock)
	reg.Register(ast.KindCodeBlock, renderCodeBlock)
}

var codeFormatter = chromahtml.New(chromahtml.WithClasses(true), chromahtml.PreventSurroundingPre(false))

func codeLanguage(n ast.Node, source []byte) string {
	fc, ok := n.(*ast.FencedCodeBlock)
	if !ok || fc.Info == nil {
		return ""
	}
	info := string(fc.Info.Segment.Value(source))
	if i := strings.IndexAny(info, " \t{"); i >= 0 {
		info = info[:i]
	}
	return strings.ToLower(strings.TrimSpace(info))
}

func renderCodeBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	var buf bytes.Buffer
	lines := node.Lines()
	for i := 0; i < lines.Len(); i++ {
		seg := lines.At(i)
		buf.Write(seg.Value(source))
	}
	code := buf.String()
	lang := codeLanguage(node, source)

	if lang == "mermaid" {
		_, _ = w.WriteString(`<div class="mdv-mermaid"><pre class="mdv-mermaid-source">`)
		_, _ = w.WriteString(html.EscapeString(code))
		_, _ = w.WriteString("</pre></div>\n")
		return ast.WalkSkipChildren, nil
	}

	label := lang
	if label == "" {
		label = "text"
	}
	_, _ = w.WriteString(`<div class="mdv-code" data-lang="` + html.EscapeString(label) + `">`)
	_, _ = w.WriteString(`<div class="mdv-code-header"><span class="mdv-code-lang">` + html.EscapeString(label) +
		`</span><button class="mdv-code-copy" type="button" title="Copy">Copy</button></div>`)

	var lexer chroma.Lexer
	if lang != "" {
		lexer = lexers.Get(lang)
	}
	if lexer == nil {
		lexer = lexers.Fallback
	}
	lexer = chroma.Coalesce(lexer)
	it, err := lexer.Tokenise(nil, code)
	if err == nil {
		var out bytes.Buffer
		if err = codeFormatter.Format(&out, styles.Fallback, it); err == nil {
			_, _ = w.Write(out.Bytes())
		}
	}
	if err != nil {
		_, _ = w.WriteString(`<pre class="chroma"><code>` + html.EscapeString(code) + `</code></pre>`)
	}
	_, _ = w.WriteString("</div>\n")
	return ast.WalkSkipChildren, nil
}
