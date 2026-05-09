package shopify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

const storeCreditAccountCreditMutation = `
mutation IssueStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
    storeCreditAccountTransaction {
      id
      amount { amount currencyCode }
      account { id balance { amount currencyCode } }
    }
    userErrors { field message }
  }
}
`

// StoreCreditResult captures the persisted fields from a successful mutation.
type StoreCreditResult struct {
	AccountID     string
	TransactionID string
}

// StoreCreditUserError mirrors the Shopify userErrors payload.
type StoreCreditUserError struct {
	Field   []string `json:"field"`
	Message string   `json:"message"`
}

func buildStoreCreditVariables(
	customerGID, amount, currency, expiresAt string, notify bool,
) map[string]interface{} {
	credit := map[string]interface{}{
		"creditAmount": map[string]string{
			"amount":       amount,
			"currencyCode": currency,
		},
		"notify": notify,
	}
	if expiresAt != "" {
		credit["expiresAt"] = expiresAt
	}
	return map[string]interface{}{
		"id":          customerGID,
		"creditInput": credit,
	}
}

// IssueStoreCredit calls the storeCreditAccountCredit mutation for a single customer.
//
// shopDomain is the myshopify.com host. accessToken is the shop's offline access token.
// customerGID should be the full gid://shopify/Customer/NNN form.
// amount is a decimal string (e.g. "25.00"). currency is ISO 4217 (e.g. "EUR").
// expiresAt is an RFC3339 timestamp string, or "" for no expiry.
func IssueStoreCredit(
	ctx context.Context,
	shopDomain, accessToken, customerGID, amount, currency, expiresAt string,
	notify bool,
) (*StoreCreditResult, []StoreCreditUserError, error) {
	apiVersion := os.Getenv("SHOPIFY_API_VERSION")
	if apiVersion == "" {
		apiVersion = "2026-01"
	}
	url := fmt.Sprintf("https://%s/admin/api/%s/graphql.json", shopDomain, apiVersion)

	body := map[string]interface{}{
		"query":     storeCreditAccountCreditMutation,
		"variables": buildStoreCreditVariables(customerGID, amount, currency, expiresAt, notify),
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(raw))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)

	resp, err := shopifyClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode >= 500 {
		return nil, nil, fmt.Errorf("shopify 5xx: %d %s", resp.StatusCode, string(respBody))
	}
	if resp.StatusCode == 429 {
		return nil, nil, fmt.Errorf("shopify rate limited: %s", string(respBody))
	}
	if resp.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("shopify %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed struct {
		Data struct {
			StoreCreditAccountCredit struct {
				StoreCreditAccountTransaction *struct {
					ID      string `json:"id"`
					Account struct {
						ID string `json:"id"`
					} `json:"account"`
				} `json:"storeCreditAccountTransaction"`
				UserErrors []StoreCreditUserError `json:"userErrors"`
			} `json:"storeCreditAccountCredit"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, nil, fmt.Errorf("decode: %w", err)
	}

	payload := parsed.Data.StoreCreditAccountCredit
	if len(payload.UserErrors) > 0 {
		return nil, payload.UserErrors, nil
	}
	if payload.StoreCreditAccountTransaction == nil {
		return nil, nil, fmt.Errorf("unexpected empty transaction in response: %s", string(respBody))
	}

	return &StoreCreditResult{
		AccountID:     payload.StoreCreditAccountTransaction.Account.ID,
		TransactionID: payload.StoreCreditAccountTransaction.ID,
	}, nil, nil
}
