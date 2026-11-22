package main

import (
	"net/url"
	"path/filepath"
	"strings"
	"testing"
)

func TestRewriteCSSURLs(t *testing.T) {
	dir := t.TempDir()
	want := func(rel string) string {
		return `url("/_mdv/file?p=` + url.QueryEscape(filepath.Join(dir, filepath.FromSlash(rel))) + `")`
	}
	cases := []struct{ in, out string }{
		{`a{background:url("bg.png")}`, `a{background:` + want("bg.png") + `}`},
		{`a{background:url('img/bg.png')}`, `a{background:` + want("img/bg.png") + `}`},
		{`a{background:url( ../bg.png )}`, `a{background:` + want("../bg.png") + `}`},
		{`a{background:url(data:image/png;base64,AAAA)}`, `a{background:url(data:image/png;base64,AAAA)}`},
		{`a{background:url("https://example.com/x.png")}`, `a{background:url("https://example.com/x.png")}`},
		{`a{background:url("/_mdv/file?p=C:/x.png")}`, `a{background:url("/_mdv/file?p=C:/x.png")}`},
		{`a{background:url("C:/x.png")}`, `a{background:url("C:/x.png")}`},
		{`a{filter:url(#f)}`, `a{filter:url(#f)}`},
	}
	for _, c := range cases {
		if got := rewriteCSSURLs(c.in, dir); got != c.out {
			t.Errorf("%s\n got  %s\n want %s", c.in, got, c.out)
		}
	}
	if got := rewriteCSSURLs(`url("bg.png?x=1")`, dir); !strings.Contains(got, url.QueryEscape(filepath.Join(dir, "bg.png"))+`"`) {
		t.Errorf("query not stripped: %s", got)
	}
}
