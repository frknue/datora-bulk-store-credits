package handler

import "testing"

func TestDeriveFinalStoreCreditStatus(t *testing.T) {
	cases := []struct {
		count, done, failed int
		want                string
	}{
		{10, 10, 0, "completed"},
		{10, 7, 3, "completed_with_errors"},
		{10, 0, 10, "failed"},
		{5, 0, 0, "failed"},
	}
	for _, c := range cases {
		got := deriveFinalStoreCreditStatus(c.count, c.done, c.failed)
		if got != c.want {
			t.Errorf("deriveFinalStoreCreditStatus(%d,%d,%d) = %q, want %q",
				c.count, c.done, c.failed, got, c.want)
		}
	}
}
