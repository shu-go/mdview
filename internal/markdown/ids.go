package markdown

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
)

// headingIDs generates GitHub-like heading IDs that keep non-ASCII letters
// (e.g. Japanese), unlike goldmark's default generator which drops them.
type headingIDs struct {
	prefix string
	used   map[string]int
}

var _ parser.IDs = (*headingIDs)(nil)

func newHeadingIDs(prefix string) *headingIDs {
	return &headingIDs{prefix: prefix, used: map[string]int{}}
}

// Slugify converts heading text into an anchor slug: lower-cased, spaces to
// '-', punctuation removed, letters/digits of any script kept.
func Slugify(text string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(text)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.Is(unicode.Mn, r):
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '\t':
			b.WriteRune('-')
		case r == '_':
			b.WriteRune('_')
		}
	}
	return b.String()
}

func (s *headingIDs) Generate(value []byte, kind ast.NodeKind) []byte {
	base := Slugify(string(value))
	if base == "" {
		base = "heading"
	}
	base = s.prefix + base
	id := base
	if n, ok := s.used[base]; ok {
		for {
			n++
			id = base + "-" + strconv.Itoa(n)
			if _, dup := s.used[id]; !dup {
				break
			}
		}
		s.used[base] = n
	}
	s.used[id] = 0
	return []byte(id)
}

func (s *headingIDs) Put(value []byte) {
	s.used[string(value)] = 0
}
