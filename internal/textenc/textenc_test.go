package textenc

import (
	"testing"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/unicode"
)

func TestDecode(t *testing.T) {
	const s = "日本語のテキスト ①～（髙）\r\nsecond line"
	sjis, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	le, _ := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewEncoder().Bytes([]byte(s))
	be, _ := unicode.UTF16(unicode.BigEndian, unicode.UseBOM).NewEncoder().Bytes([]byte(s))
	cases := []struct {
		name string
		in   []byte
		enc  string
	}{
		{"utf8", []byte(s), UTF8},
		{"utf8 bom", append([]byte{0xEF, 0xBB, 0xBF}, s...), UTF8BOM},
		{"sjis", sjis, ShiftJIS},
		{"utf16le", le, UTF16LE},
		{"utf16be", be, UTF16BE},
	}
	for _, c := range cases {
		if got := Detect(c.in); got != c.enc {
			t.Errorf("%s: Detect = %s, want %s", c.name, got, c.enc)
		}
		if got := string(Decode(c.in)); got != s {
			t.Errorf("%s: Decode = %q", c.name, got)
		}
		if IsBinary(c.in) {
			t.Errorf("%s: detected as binary", c.name)
		}
	}
}

func TestASCIIIsUTF8(t *testing.T) {
	if Detect([]byte("plain ascii")) != UTF8 {
		t.Error("ASCII should be UTF-8")
	}
}

func TestIsBinary(t *testing.T) {
	if !IsBinary([]byte("PK\x03\x04\x00\x00")) {
		t.Error("NUL bytes should be binary")
	}
	if IsBinary(nil) {
		t.Error("empty is text")
	}
}
