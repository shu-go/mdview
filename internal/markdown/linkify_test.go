package markdown

import (
	"strings"
	"testing"
)

func TestLinkifyAfterNonSpace(t *testing.T) {
	cases := []struct{ src, want string }{
		{"see https://example.com/a?b=1 here", `<a href="https://example.com/a?b=1">https://example.com/a?b=1</a> here`},
		{"参照：https://example.com/a。", `参照：<a href="https://example.com/a">https://example.com/a</a>。`},
		{"「https://example.com」", `「<a href="https://example.com">https://example.com</a>」`},
		{"日本語http://example.com/x.です", `日本語<a href="http://example.com/x">http://example.com/x</a>.です`},
		{"URL:https://example.com/a_(b), next", `URL:<a href="https://example.com/a_(b)">https://example.com/a_(b)</a>, next`},
		{"値はhttps://example.com/?a=1&b=2_c です", `値は<a href="https://example.com/?a=1&amp;b=2_c">https://example.com/?a=1&amp;b=2_c</a> です`},
		{"→https://a.example/ と→https://b.example/", `→<a href="https://a.example/">https://a.example/</a> と→<a href="https://b.example/">https://b.example/</a>`},
		{"**太字https://example.com**", `<strong>太字<a href="https://example.com">https://example.com</a></strong>`},
	}
	for _, c := range cases {
		mustContain(t, Render([]byte(c.src), "").HTML, c.want)
	}
}

func TestLinkifyKeepsLineBreaks(t *testing.T) {
	s := Render([]byte("前https://example.com\n次の行"), "").HTML
	mustContain(t, s, "前<a href=\"https://example.com\">https://example.com</a>\n次の行")
	s = Render([]byte("前https://example.com  \n次の行"), "").HTML
	mustContain(t, s, "https://example.com</a><br>")
}

func TestLinkifyHeadingText(t *testing.T) {
	r := Render([]byte("# 参照：https://example.com"), "")
	if len(r.Headings) != 1 || r.Headings[0].Text != "参照：https://example.com" {
		t.Errorf("headings = %+v", r.Headings)
	}
}

func TestLinkifyNotInWordsOrCode(t *testing.T) {
	for _, src := range []string{
		"xhttps://example.com",
		"a/https://example.com",
		"`あhttps://example.com`",
		"[あhttps://example.com](other.md)",
		"![あhttps://example.com](a.png)",
		"httpsは文字列",
		"あhttp://",
	} {
		s := Render([]byte(src), "").HTML
		if strings.Contains(s, "<a href=\"http") {
			t.Errorf("%q: unexpected link\n%s", src, s)
		}
	}
}
