package markdown

import (
	"strings"

	"github.com/yuin/goldmark/ast"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// KindDiffInserted wraps a block that was added (or changed) since the base.
var KindDiffInserted = ast.NewNodeKind("DiffInserted")

// KindDiffDeleted holds pre-rendered HTML of a block removed since the base.
var KindDiffDeleted = ast.NewNodeKind("DiffDeleted")

type diffInserted struct{ ast.BaseBlock }

func (n *diffInserted) Kind() ast.NodeKind            { return KindDiffInserted }
func (n *diffInserted) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type diffDeleted struct {
	ast.BaseBlock
	HTML string
}

func (n *diffDeleted) Kind() ast.NodeKind            { return KindDiffDeleted }
func (n *diffDeleted) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type diffRenderer struct{}

func (diffRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindDiffInserted, func(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(`<div class="mdv-diff-ins">` + "\n")
		} else {
			_, _ = w.WriteString("</div>\n")
		}
		return ast.WalkContinue, nil
	})
	reg.Register(KindDiffDeleted, func(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(`<div class="mdv-diff-del">` + "\n")
			_, _ = w.WriteString(node.(*diffDeleted).HTML)
			_, _ = w.WriteString("</div>\n")
		}
		return ast.WalkSkipChildren, nil
	})
}

type block struct {
	node ast.Node
	html string
	key  string
}

// topBlocks returns the top-level blocks taking part in the diff, each with
// its rendered HTML. The key used for comparison is the HTML with the deleted
// side's heading-id prefix removed, so only visible changes count.
func (p *parsed) topBlocks() []block {
	var bs []block
	for n := p.doc.FirstChild(); n != nil; n = n.NextSibling() {
		if n.Kind() == extast.KindFootnoteList {
			continue
		}
		h := p.render(n)
		bs = append(bs, block{node: n, html: h, key: strings.ReplaceAll(h, `id="mdv-del-`, `id="`)})
	}
	return bs
}

type opKind int

const (
	opEqual opKind = iota
	opDel
	opIns
)

type op struct {
	kind opKind
	i, j int // index into old / new
}

// diffOps computes an edit script turning a into b (LCS based).
func diffOps(a, b []string) []op {
	// common prefix / suffix
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre] == b[pre] {
		pre++
	}
	suf := 0
	for suf < len(a)-pre && suf < len(b)-pre && a[len(a)-1-suf] == b[len(b)-1-suf] {
		suf++
	}
	ma, mb := a[pre:len(a)-suf], b[pre:len(b)-suf]
	n, m := len(ma), len(mb)
	// lcs[i][j] = LCS length of ma[i:], mb[j:]
	lcs := make([]int32, (n+1)*(m+1))
	at := func(i, j int) int32 { return lcs[i*(m+1)+j] }
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			v := at(i+1, j)
			if ma[i] == mb[j] {
				v = at(i+1, j+1) + 1
			} else if w := at(i, j+1); w > v {
				v = w
			}
			lcs[i*(m+1)+j] = v
		}
	}
	ops := make([]op, 0, len(a)+len(b))
	for k := 0; k < pre; k++ {
		ops = append(ops, op{opEqual, k, k})
	}
	i, j := 0, 0
	for i < n || j < m {
		switch {
		case i < n && j < m && ma[i] == mb[j]:
			ops = append(ops, op{opEqual, pre + i, pre + j})
			i++
			j++
		case j < m && (i == n || at(i, j+1) > at(i+1, j)):
			// ties go to deletion so deletions precede insertions in a run
			ops = append(ops, op{opIns, pre + i, pre + j})
			j++
		default:
			ops = append(ops, op{opDel, pre + i, pre + j})
			i++
		}
	}
	for k := 0; k < suf; k++ {
		ops = append(ops, op{opEqual, len(a) - suf + k, len(b) - suf + k})
	}
	return ops
}

// applyDiff marks newP's AST with the differences from oldP and returns the
// number of change regions.
func applyDiff(oldP, newP *parsed) int {
	ob, nb := oldP.topBlocks(), newP.topBlocks()
	ka := make([]string, len(ob))
	for i, b := range ob {
		ka[i] = b.key
	}
	kb := make([]string, len(nb))
	for i, b := range nb {
		kb[i] = b.key
	}
	ops := diffOps(ka, kb)

	doc := newP.doc
	changes := 0
	inRun := false
	for _, o := range ops {
		if o.kind == opEqual {
			inRun = false
			continue
		}
		if !inRun {
			changes++
			inRun = true
		}
		switch o.kind {
		case opIns:
			n := nb[o.j].node
			w := &diffInserted{}
			doc.ReplaceChild(doc, n, w)
			w.AppendChild(w, n)
			nb[o.j].node = w
		case opDel:
			d := &diffDeleted{HTML: ob[o.i].html}
			if o.j < len(nb) {
				doc.InsertBefore(doc, nb[o.j].node, d)
			} else if len(nb) > 0 {
				doc.InsertAfter(doc, lastInserted(nb[len(nb)-1].node), d)
			} else if fc := doc.FirstChild(); fc != nil {
				doc.InsertBefore(doc, fc, d)
			} else {
				doc.AppendChild(doc, d)
			}
		}
	}
	return changes
}

// lastInserted returns the last node of a run of trailing deleted blocks
// following n, so consecutive deletions at the end keep their order.
func lastInserted(n ast.Node) ast.Node {
	for n.NextSibling() != nil && n.NextSibling().Kind() == KindDiffDeleted {
		n = n.NextSibling()
	}
	return n
}
