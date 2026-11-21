package markdown

import (
	"html"
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
	"gopkg.in/yaml.v3"
)

// KindFrontMatter is the AST kind of the front matter block.
var KindFrontMatter = ast.NewNodeKind("FrontMatter")

// FrontMatter holds the raw YAML front matter of a document.
type FrontMatter struct {
	ast.BaseBlock
	Raw string
}

func (n *FrontMatter) Kind() ast.NodeKind            { return KindFrontMatter }
func (n *FrontMatter) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

var frontMatterRe = regexp.MustCompile(`^---[ \t]*\r?\n((?s:.*?))\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)`)

// splitFrontMatter returns the raw front matter and a copy of source with the
// front matter blanked out (newlines kept), so source offsets stay valid.
func splitFrontMatter(source []byte) (raw string, body []byte, end int) {
	loc := frontMatterRe.FindSubmatchIndex(source)
	if loc == nil {
		return "", source, 0
	}
	raw = string(source[loc[2]:loc[3]])
	body = make([]byte, len(source))
	copy(body, source)
	for i := 0; i < loc[1]; i++ {
		if body[i] != '\n' && body[i] != '\r' {
			body[i] = ' '
		}
	}
	return raw, body, loc[1]
}

type frontMatterRenderer struct{}

func (frontMatterRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindFrontMatter, func(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(RenderFrontMatter(node.(*FrontMatter).Raw))
		}
		return ast.WalkSkipChildren, nil
	})
}

// RenderFrontMatter renders YAML front matter as a key/value table. Values that
// are not scalars (or lists of scalars) are shown as YAML.
func RenderFrontMatter(raw string) string {
	var b strings.Builder
	b.WriteString(`<details class="mdv-frontmatter" open><summary class="mdv-frontmatter-title">Front matter</summary>` + "\n")
	var root yaml.Node
	err := yaml.Unmarshal([]byte(raw), &root)
	if err != nil || len(root.Content) == 0 || root.Content[0].Kind != yaml.MappingNode {
		b.WriteString(`<pre class="mdv-frontmatter-raw">` + html.EscapeString(raw) + "</pre>\n</details>\n")
		return b.String()
	}
	m := root.Content[0]
	b.WriteString(`<table class="mdv-frontmatter-table"><tbody>` + "\n")
	for i := 0; i+1 < len(m.Content); i += 2 {
		k, v := m.Content[i], m.Content[i+1]
		b.WriteString(`<tr><th class="mdv-frontmatter-key">` + html.EscapeString(k.Value) + `</th><td class="mdv-frontmatter-value">`)
		b.WriteString(renderYAMLValue(v))
		b.WriteString("</td></tr>\n")
	}
	b.WriteString("</tbody></table>\n</details>\n")
	return b.String()
}

func renderYAMLValue(v *yaml.Node) string {
	switch v.Kind {
	case yaml.ScalarNode:
		return html.EscapeString(v.Value)
	case yaml.AliasNode:
		if v.Alias != nil {
			return renderYAMLValue(v.Alias)
		}
	case yaml.SequenceNode:
		allScalar := true
		for _, c := range v.Content {
			if c.Kind != yaml.ScalarNode {
				allScalar = false
				break
			}
		}
		if allScalar {
			var b strings.Builder
			for _, c := range v.Content {
				b.WriteString(`<span class="mdv-frontmatter-item">` + html.EscapeString(c.Value) + `</span>`)
			}
			return b.String()
		}
	}
	out, err := yaml.Marshal(v)
	if err != nil {
		return ""
	}
	return `<pre class="mdv-frontmatter-raw">` + html.EscapeString(strings.TrimRight(string(out), "\n")) + `</pre>`
}
