package db

import "testing"

func TestStoreCreditJobStatusConstants(t *testing.T) {
	cases := map[StoreCreditJobStatus]string{
		StoreCreditJobStatusPending:             "pending",
		StoreCreditJobStatusScheduled:           "scheduled",
		StoreCreditJobStatusRunning:             "running",
		StoreCreditJobStatusCompleted:           "completed",
		StoreCreditJobStatusCompletedWithErrors: "completed_with_errors",
		StoreCreditJobStatusFailed:              "failed",
	}
	for status, want := range cases {
		if string(status) != want {
			t.Errorf("status %q = %q, want %q", status, string(status), want)
		}
	}
}

func TestStoreCreditRecipientStatusConstants(t *testing.T) {
	cases := map[StoreCreditRecipientStatus]string{
		StoreCreditRecipientStatusPending:   "pending",
		StoreCreditRecipientStatusSucceeded: "succeeded",
		StoreCreditRecipientStatusFailed:    "failed",
	}
	for s, want := range cases {
		if string(s) != want {
			t.Errorf("recipient status %q = %q, want %q", s, string(s), want)
		}
	}
}
