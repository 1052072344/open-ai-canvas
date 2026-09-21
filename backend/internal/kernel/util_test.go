package kernel

import (
	"testing"
	"unicode/utf8"
)

func TestTruncateRunesRespectsLimit(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		limit int
		want  string
	}{
		{name: "unchanged", value: "影策", limit: 2, want: "影策"},
		{name: "ellipsis included in limit", value: "一二三四五", limit: 4, want: "一..."},
		{name: "small limit", value: "abcdef", limit: 2, want: "ab"},
		{name: "zero limit", value: "abcdef", limit: 0, want: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := TruncateRunes(test.value, test.limit)
			if got != test.want {
				t.Fatalf("TruncateRunes(%q, %d) = %q, want %q", test.value, test.limit, got, test.want)
			}
			if utf8.RuneCountInString(got) > test.limit {
				t.Fatalf("TruncateRunes(%q, %d) produced %d runes", test.value, test.limit, utf8.RuneCountInString(got))
			}
		})
	}
}
