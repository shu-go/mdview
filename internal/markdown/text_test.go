package markdown

import (
	"fmt"
	"strings"
	"testing"
)

func TestRenderTextBlocks(t *testing.T) {
	src := "first line\r\n  indented <b>&amp;\r\n\r\n\r\nsecond # not a heading\n*not em*\n"
	r := RenderText([]byte(src))
	want := `<p class="mdv-text-block" data-line="1">first line` + "\n" + `  indented &lt;b&gt;&amp;amp;</p>` + "\n" +
		`<p class="mdv-text-block" data-line="5">second # not a heading` + "\n" + `*not em*</p>` + "\n"
	if r.HTML != want {
		t.Errorf("got\n%s\nwant\n%s", r.HTML, want)
	}
	if len(r.Headings) != 0 || r.Changes != 0 {
		t.Errorf("headings %v changes %d", r.Headings, r.Changes)
	}
}

func TestRenderTextLinks(t *testing.T) {
	r := RenderText([]byte("参照：https://example.com/a?b=1&c=2。\njavascript:alert(1) http//x\n"))
	mustContain(t, r.HTML, `参照：<a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>。`, "javascript:alert(1) http//x")
	if strings.Count(r.HTML, "<a ") != 1 {
		t.Errorf("only the http URL is a link:\n%s", r.HTML)
	}
}

func TestRenderTextChunks(t *testing.T) {
	var b strings.Builder
	for i := 1; i <= 300; i++ {
		fmt.Fprintf(&b, "log line %d\n", i)
	}
	r := RenderText([]byte(b.String()))
	n := strings.Count(r.HTML, `<p class="mdv-text-block`)
	if n < 300/textChunkMax || n > 300/textChunkMin {
		t.Errorf("unexpected number of chunks: %d", n)
	}
	if strings.Count(r.HTML, `class="mdv-text-block"`) != 1 || strings.Count(r.HTML, "mdv-text-block-cont") != n-1 {
		t.Errorf("chunks after the first continue the paragraph:\n%s", r.HTML)
	}
	if strings.Count(r.HTML, "log line") != 300 {
		t.Error("lines lost")
	}
}

func TestRenderTextDiff(t *testing.T) {
	var b strings.Builder
	for i := 1; i <= 300; i++ {
		fmt.Fprintf(&b, "log line %d\n", i)
	}
	base := b.String()
	// a line inserted near the top changes only the chunk around it
	changed := strings.Replace(base, "log line 5\n", "log line 5\ninserted\n", 1)
	r := RenderTextDiff([]byte(base), []byte(changed))
	if r.Changes != 1 || strings.Count(r.HTML, "mdv-diff-ins") != 1 || strings.Count(r.HTML, "mdv-diff-del") != 1 {
		t.Errorf("one changed chunk expected: changes=%d\n%s", r.Changes, r.HTML)
	}
	r = RenderTextDiff([]byte("a\n\nb\n"), []byte("a\n\nb\n\nc\n"))
	if r.Changes != 1 || !strings.Contains(r.HTML, `<div class="mdv-diff-ins">`+"\n"+`<p class="mdv-text-block" data-line="5">c</p>`) {
		t.Errorf("appended block:\n%s", r.HTML)
	}
}
