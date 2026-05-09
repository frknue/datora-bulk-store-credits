package shopify

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildStoreCreditVariables_WithExpiry(t *testing.T) {
	vars := buildStoreCreditVariables("gid://shopify/Customer/123", "25.00", "USD", "2028-12-31T00:00:00Z", true)

	raw, err := json.Marshal(vars)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	s := string(raw)
	for _, want := range []string{
		`"id":"gid://shopify/Customer/123"`,
		`"amount":"25.00"`,
		`"currencyCode":"USD"`,
		`"expiresAt":"2028-12-31T00:00:00Z"`,
		`"notify":true`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("vars missing %q in %s", want, s)
		}
	}
}

func TestBuildStoreCreditVariables_NoExpiry(t *testing.T) {
	vars := buildStoreCreditVariables("gid://shopify/Customer/123", "25.00", "USD", "", false)
	raw, _ := json.Marshal(vars)
	s := string(raw)
	if strings.Contains(s, "expiresAt") {
		t.Errorf("expected no expiresAt key, got %s", s)
	}
	if !strings.Contains(s, `"notify":false`) {
		t.Errorf("expected notify=false, got %s", s)
	}
}
