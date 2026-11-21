package workspace

import (
	"bytes"
	"errors"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"
)

// GrepQuery is a search over all files of the list.
type GrepQuery struct {
	Pattern       string `json:"pattern"`
	Regex         bool   `json:"regex"`
	CaseSensitive bool   `json:"caseSensitive"`
}

// GrepMatch is one matching line.
type GrepMatch struct {
	Line  int    `json:"line"`  // 1-based
	Text  string `json:"text"`  // the line (trimmed to a window around the match)
	Start int    `json:"start"` // match offset in Text (UTF-16 code units, for JS)
	End   int    `json:"end"`
}

// GrepFile is the matches of one file.
type GrepFile struct {
	FileItem
	Matches []GrepMatch `json:"matches"`
	More    bool        `json:"more"` // matches were truncated
}

// GrepResult is the result of a search, files in the order of Snapshot.
type GrepResult struct {
	Files     []GrepFile `json:"files"`
	Total     int        `json:"total"`
	Truncated bool       `json:"truncated"`
}

const (
	grepMaxPerFile = 200
	grepMaxTotal   = 5000
	grepContext    = 60 // characters kept before a match
	grepMaxText    = 240
)

// CompileGrep builds the regexp for a query.
func CompileGrep(q GrepQuery) (*regexp.Regexp, error) {
	if q.Pattern == "" {
		return nil, errors.New("empty pattern")
	}
	p := q.Pattern
	if !q.Regex {
		p = regexp.QuoteMeta(p)
	}
	if !q.CaseSensitive {
		p = "(?i)" + p
	}
	return regexp.Compile(p)
}

// Grep searches every file in the list (loaded content when available,
// otherwise the file on disk).
func (ws *Workspace) Grep(q GrepQuery) (GrepResult, error) {
	re, err := CompileGrep(q)
	if err != nil {
		return GrepResult{Files: []GrepFile{}}, err
	}
	snap := ws.Snapshot()
	res := GrepResult{Files: []GrepFile{}}
	for _, item := range snap.Files {
		if res.Total >= grepMaxTotal {
			res.Truncated = true
			break
		}
		ws.mu.Lock()
		var content []byte
		if d, ok := ws.docs[item.Path]; ok {
			content = d.current
		}
		ws.mu.Unlock()
		if content == nil {
			b, err := os.ReadFile(item.Path)
			if err != nil {
				continue
			}
			content = b
		}
		gf := GrepFile{FileItem: item, Matches: []GrepMatch{}}
		grepContent(content, re, &gf, grepMaxTotal-res.Total)
		if len(gf.Matches) > 0 {
			res.Total += len(gf.Matches)
			res.Files = append(res.Files, gf)
		}
	}
	return res, nil
}

func grepContent(content []byte, re *regexp.Regexp, gf *GrepFile, budget int) {
	line := 0
	for len(content) > 0 {
		line++
		var l []byte
		if i := bytes.IndexByte(content, '\n'); i >= 0 {
			l, content = content[:i], content[i+1:]
		} else {
			l, content = content, nil
		}
		l = bytes.TrimRight(l, "\r")
		loc := re.FindIndex(l)
		if loc == nil || loc[0] == loc[1] {
			continue
		}
		if len(gf.Matches) >= grepMaxPerFile || len(gf.Matches) >= budget {
			gf.More = true
			return
		}
		gf.Matches = append(gf.Matches, snippet(string(l), loc[0], loc[1], line))
	}
}

// snippet cuts a window of the line around the match and converts offsets
// to UTF-16 units.
func snippet(s string, start, end, line int) GrepMatch {
	from := start
	for n := 0; from > 0 && n < grepContext; n++ {
		_, size := utf8.DecodeLastRuneInString(s[:from])
		from -= size
	}
	to := len(s)
	if r := []rune(s[from:]); len(r) > grepMaxText {
		to = from + len(string(r[:grepMaxText]))
		if to < end {
			to = end
		}
	}
	prefix := ""
	if from > 0 {
		prefix = "…"
	}
	text := strings.TrimRight(prefix+s[from:to], " \t")
	off := utf16Len(prefix)
	m := GrepMatch{Line: line, Text: text}
	m.Start = off + utf16Len(s[from:start])
	m.End = m.Start + utf16Len(s[start:end])
	return m
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}
