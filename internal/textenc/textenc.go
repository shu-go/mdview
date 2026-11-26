// Package textenc detects the character encoding of text files and converts
// them to UTF-8: BOMs (UTF-8, UTF-16LE/BE) first, then valid UTF-8, and
// anything else as Shift_JIS (Windows-31J / CP932).
package textenc

import (
	"bytes"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/unicode"
)

// Encoding names returned by Detect.
const (
	UTF8     = "UTF-8"
	UTF8BOM  = "UTF-8 BOM"
	UTF16LE  = "UTF-16LE"
	UTF16BE  = "UTF-16BE"
	ShiftJIS = "Shift_JIS"
)

var (
	bomUTF8    = []byte{0xEF, 0xBB, 0xBF}
	bomUTF16LE = []byte{0xFF, 0xFE}
	bomUTF16BE = []byte{0xFE, 0xFF}
)

// Detect returns the encoding of b.
func Detect(b []byte) string {
	switch {
	case bytes.HasPrefix(b, bomUTF8):
		return UTF8BOM
	case bytes.HasPrefix(b, bomUTF16LE):
		return UTF16LE
	case bytes.HasPrefix(b, bomUTF16BE):
		return UTF16BE
	case utf8.Valid(b):
		return UTF8
	}
	return ShiftJIS
}

// Decode returns b converted to UTF-8 (without BOM). UTF-8 input is returned
// as is (the same slice).
func Decode(b []byte) []byte {
	var dec *encoding.Decoder
	switch Detect(b) {
	case UTF8:
		return b
	case UTF8BOM:
		return b[len(bomUTF8):]
	case UTF16LE:
		dec = unicode.UTF16(unicode.LittleEndian, unicode.ExpectBOM).NewDecoder()
	case UTF16BE:
		dec = unicode.UTF16(unicode.BigEndian, unicode.ExpectBOM).NewDecoder()
	default:
		dec = japanese.ShiftJIS.NewDecoder()
	}
	out, err := dec.Bytes(b)
	if err != nil {
		// invalid sequences are replaced by the decoder; an error here means
		// something unexpected: show the bytes as UTF-8 with replacements
		return bytes.ToValidUTF8(b, []byte("�"))
	}
	return out
}

// BinaryCheckSize is how much of a file IsBinary looks at.
const BinaryCheckSize = 8192

// IsBinary reports whether b looks like a binary file: a NUL byte within the
// first BinaryCheckSize bytes (UTF-16 text, which has NULs, is recognised by
// its BOM).
func IsBinary(b []byte) bool {
	if bytes.HasPrefix(b, bomUTF16LE) || bytes.HasPrefix(b, bomUTF16BE) {
		return false
	}
	head := b
	if len(head) > BinaryCheckSize {
		head = head[:BinaryCheckSize]
	}
	return bytes.IndexByte(head, 0) >= 0
}
