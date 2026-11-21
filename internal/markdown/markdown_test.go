package markdown

import (
	"html"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustContain(t *testing.T, s string, subs ...string) {
	t.Helper()
	stripped := lineAttrRe.ReplaceAllString(s, "")
	for _, sub := range subs {
		if !strings.Contains(s, sub) && !strings.Contains(stripped, sub) {
			t.Errorf("output does not contain %q\n---\n%s", sub, s)
		}
	}
}

func mustNotContain(t *testing.T, s string, subs ...string) {
	t.Helper()
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			t.Errorf("output unexpectedly contains %q\n---\n%s", sub, s)
		}
	}
}

func TestHeadingsAndIDs(t *testing.T) {
	r := Render([]byte("# はじめに\n\n## Hello World\n\n## Hello World\n\n### `code` and *em*\n"), "")
	if len(r.Headings) != 4 {
		t.Fatalf("headings = %+v", r.Headings)
	}
	want := []Heading{
		{1, "はじめに", "はじめに"},
		{2, "Hello World", "hello-world"},
		{2, "Hello World", "hello-world-1"},
		{3, "code and em", "code-and-em"},
	}
	for i, w := range want {
		if r.Headings[i] != w {
			t.Errorf("heading %d = %+v, want %+v", i, r.Headings[i], w)
		}
	}
	mustContain(t, r.HTML, `id="はじめに"`, `id="hello-world-1"`)
}

func TestEmoji(t *testing.T) {
	r := Render([]byte("hi :smile: :+1:\n"), "")
	mustContain(t, r.HTML, "😄", "👍")
}

func TestCallout(t *testing.T) {
	r := Render([]byte("> [!NOTE]\n> body text\n\n> [!tip]- Custom *title*\n> folded\n\n> plain quote\n"), "")
	mustContain(t, r.HTML,
		`<div class="mdv-callout mdv-callout-note" data-callout="note">`,
		`<span class="mdv-callout-title-text">Note</span>`,
		"<p>body text</p>",
		`<details class="mdv-callout mdv-callout-tip" data-callout="tip">`,
		`<summary class="mdv-callout-title">`,
		"Custom *title*",
		"<p>plain quote</p>\n</blockquote>",
	)
	mustNotContain(t, r.HTML, "[!NOTE]")
}

func TestCalloutTitleOnly(t *testing.T) {
	r := Render([]byte("> [!warning] Only title\n"), "")
	mustContain(t, r.HTML, `mdv-callout-warning`, "Only title")
	mustNotContain(t, r.HTML, "<p>")
}

func TestFrontMatter(t *testing.T) {
	src := "---\ntitle: Doc\ntags: [a, b]\nnested:\n  x: 1\n---\n# Body\n"
	r := Render([]byte(src), "")
	mustContain(t, r.HTML,
		`<details class="mdv-frontmatter" open="">`,
		`<th class="mdv-frontmatter-key">title</th><td class="mdv-frontmatter-value">Doc</td>`,
		`<span class="mdv-frontmatter-item">a</span>`,
		`<pre class="mdv-frontmatter-raw">x: 1</pre>`,
		`<h1 id="body">Body</h1>`,
	)
	mustNotContain(t, r.HTML, "<hr")
}

func TestCodeBlock(t *testing.T) {
	r := Render([]byte("```go\nfunc main() {}\n```\n\n```mermaid\ngraph TD; A-->B\n```\n"), "")
	mustContain(t, r.HTML,
		`<div class="mdv-code" data-lang="go">`,
		`<button class="mdv-code-copy"`,
		`class="chroma"`,
		`<div class="mdv-mermaid"><pre class="mdv-mermaid-source">graph TD; A--&gt;B`,
	)
}

func TestLinksAndImages(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "docs")
	doc := filepath.Join(dir, "a.md")
	src := "[x](#sec) [y](other.md#h-1) [z](https://example.com) ![i](img/p%20q.png) ![r](https://e.com/a.png)\n"
	r := Render([]byte(src), doc)
	mustContain(t, r.HTML,
		`data-mdv-anchor="sec"`,
		`data-mdv-path="`+filepath.Join(dir, "other.md")+`"`,
		`data-mdv-anchor="h-1"`,
		`data-mdv-external="1"`,
		`src="`+FileURL(filepath.Join(dir, "img", "p q.png"))+`"`,
		`src="https://e.com/a.png"`,
	)
}

func TestRawHTMLImages(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "docs")
	doc := filepath.Join(dir, "a.md")
	abs := filepath.Join(dir, "img", "x.png")
	src := `<img src="img/sp ace/a b.png" width="50"> <img src="` + abs + `"> <img src='file:///` + filepath.ToSlash(abs) + `'> <img src="https://e.com/a.png"> <video src="v.mp4"></video>` + "\n"
	r := Render([]byte(src), doc)
	mustContain(t, r.HTML,
		`src="`+html.EscapeString(FileURL(filepath.Join(dir, "img", "sp ace", "a b.png")))+`"`,
		`src="`+html.EscapeString(FileURL(abs))+`"`,
		`src="https://e.com/a.png"`,
		`src="`+html.EscapeString(FileURL(filepath.Join(dir, "v.mp4")))+`"`,
	)
	if strings.Count(r.HTML, html.EscapeString(FileURL(abs))) != 2 {
		t.Errorf("absolute and file: forms should both resolve:\n%s", r.HTML)
	}
}

func TestFileURLChangesWithFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.png")
	os.WriteFile(p, []byte("1"), 0o644)
	u1 := FileURL(p)
	later := time.Now().Add(2 * time.Second)
	os.Chtimes(p, later, later)
	u2 := FileURL(p)
	if u1 == u2 || !strings.Contains(u1, "&v=") {
		t.Errorf("URL should change with the file: %s / %s", u1, u2)
	}
	if !strings.HasPrefix(FileURL(p+".missing"), FileURLPrefix) {
		t.Error("missing file still gets a URL")
	}
}

func TestDiff(t *testing.T) {
	base := "# T\n\npara one\n\npara two\n\npara three\n"
	cur := "# T\n\npara one\n\npara 2\n\npara three\n\nnew last\n"
	r := RenderDiff([]byte(base), []byte(cur), "")
	mustContain(t, r.HTML,
		"<div class=\"mdv-diff-del\">\n<p>para two</p>",
		"<div class=\"mdv-diff-ins\">\n<p>para 2</p>",
		"<div class=\"mdv-diff-ins\">\n<p>new last</p>",
	)
	if r.Changes != 2 {
		t.Errorf("changes = %d, want 2", r.Changes)
	}
	// deletion must come before insertion
	if strings.Index(r.HTML, "para two") > strings.Index(r.HTML, "para 2") {
		t.Errorf("deleted block should precede inserted block:\n%s", r.HTML)
	}
	if len(r.Headings) != 1 {
		t.Errorf("headings = %+v", r.Headings)
	}
}

func TestDiffDeleteHeadingAndTail(t *testing.T) {
	base := "# A\n\nx\n\n## B\n\ny\n"
	cur := "# A\n\nx\n"
	r := RenderDiff([]byte(base), []byte(cur), "")
	mustContain(t, r.HTML, `<h2 id="mdv-del-b">B</h2>`, "<p>y</p>")
	if len(r.Headings) != 1 {
		t.Errorf("deleted headings must not be in outline: %+v", r.Headings)
	}
	if strings.Index(r.HTML, ">B<") > strings.Index(r.HTML, "<p>y</p>") {
		t.Errorf("deleted blocks out of order:\n%s", r.HTML)
	}
}

func TestDataLine(t *testing.T) {
	src := "---\na: 1\n---\n# H\n\npara\n\n```go\nx\n```\n\n- item\n"
	r := Render([]byte(src), "")
	mustContain(t, r.HTML, `<h1 id="h" data-line="4">`, `<p data-line="6">`, `<div class="mdv-code" data-lang="go" data-line="8">`, `<ul data-line="12">`)
}

func TestDiffIgnoresLineShift(t *testing.T) {
	r := RenderDiff([]byte("a\n\nb\n\nc\n"), []byte("new\n\na\n\nb\n\nc\n"), "")
	if r.Changes != 1 || strings.Count(r.HTML, "mdv-diff-ins") != 1 {
		t.Errorf("only the inserted block should be marked: %d\n%s", r.Changes, r.HTML)
	}
}

func TestDiffIdentical(t *testing.T) {
	r := RenderDiff([]byte("a\n"), []byte("a\n"), "")
	mustNotContain(t, r.HTML, "mdv-diff")
	if r.Changes != 0 {
		t.Error("changes")
	}
}

func TestSanitize(t *testing.T) {
	src := "<img src=x onerror=\"alert(1)\"> <script>alert(2)</script>\n\n<details open><summary>S</summary>\n\nbody\n</details>\n\n<a href=\"javascript:alert(3)\">j</a> <kbd>Ctrl</kbd>\n"
	r := Render([]byte(src), "")
	mustNotContain(t, r.HTML, "onerror", "<script", "javascript:")
	mustContain(t, r.HTML, "<details open=\"\">", "<summary>S</summary>", "<kbd>Ctrl</kbd>")
	r = Render([]byte(`<a href="#" data-wml-openURL="x" data-foo="1">w</a>`+"\n"), "")
	mustNotContain(t, r.HTML, "data-wml", "data-foo")
	// generated markup survives
	r = Render([]byte("> [!NOTE]\n> x\n\n```go\nx\n```\n"), "")
	mustContain(t, r.HTML, `data-callout="note"`, `<button class="mdv-code-copy" type="button"`, `class="chroma"`)
}

func TestDiffOps(t *testing.T) {
	ops := diffOps([]string{"a", "b", "c"}, []string{"a", "x", "c", "d"})
	var s []string
	for _, o := range ops {
		s = append(s, [...]string{"=", "-", "+"}[o.kind])
	}
	if got := strings.Join(s, ""); got != "=-+=+" {
		t.Errorf("ops = %s", got)
	}
}
