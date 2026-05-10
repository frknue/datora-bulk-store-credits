package shopify

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// refreshSafetyWindow is the cushion before "expires" at which we proactively
// refresh an offline token. Avoids racing the deadline mid-batch.
const refreshSafetyWindow = 60 * time.Second

// IsAuthError reports whether err looks like a Shopify 401 from one of the
// IssueStoreCredit-style helpers in this package. Used to drive force-refresh
// retries.
func IsAuthError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "shopify 401") ||
		strings.Contains(msg, "Invalid API key or access token")
}

// RefreshedSession captures the response from Shopify's offline token refresh.
type RefreshedSession struct {
	AccessToken           string
	Scope                 string
	ExpiresAt             time.Time
	RefreshToken          string
	RefreshTokenExpiresAt time.Time
}

// RefreshOfflineToken exchanges a refresh token for a fresh expiring offline
// access token. See https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
func RefreshOfflineToken(
	ctx context.Context,
	shop, clientID, clientSecret, refreshToken string,
) (*RefreshedSession, error) {
	url := fmt.Sprintf("https://%s/admin/oauth/access_token", shop)
	payload := map[string]string{
		"client_id":     clientID,
		"client_secret": clientSecret,
		"refresh_token": refreshToken,
		"grant_type":    "refresh_token",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := shopifyClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("oauth refresh %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed struct {
		AccessToken           string `json:"access_token"`
		Scope                 string `json:"scope"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshToken          string `json:"refresh_token"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	now := time.Now().UTC()
	return &RefreshedSession{
		AccessToken:           parsed.AccessToken,
		Scope:                 parsed.Scope,
		ExpiresAt:             now.Add(time.Duration(parsed.ExpiresIn) * time.Second),
		RefreshToken:          parsed.RefreshToken,
		RefreshTokenExpiresAt: now.Add(time.Duration(parsed.RefreshTokenExpiresIn) * time.Second),
	}, nil
}

// GetValidAccessToken returns a usable offline access token for shop. It reads
// the latest offline Session row, refreshes via OAuth if the stored token has
// expired (or is within refreshSafetyWindow of expiring), persists the new
// values, and returns the access token.
//
// A NULL "expires" indicates a row written before this app enabled the
// expiringOfflineAccessTokens future flag. Such tokens are rejected by Shopify
// for apps subject to the April 2026 enforcement, so we treat them as needing
// refresh rather than returning them as-is.
func GetValidAccessToken(ctx context.Context, sqlDB *sql.DB, shop string) (string, error) {
	token, refresh, expires, err := readSession(ctx, sqlDB, shop)
	if err != nil {
		return "", err
	}
	if expires.Valid && time.Until(expires.Time) > refreshSafetyWindow {
		return token, nil
	}
	if !refresh.Valid || refresh.String == "" {
		return "", fmt.Errorf("session for %s has no refresh token; reinstall the app to mint an expiring token", shop)
	}
	return refreshSessionWithLock(ctx, sqlDB, shop, "")
}

// ForceRefreshAccessToken refreshes the offline access token for shop, used
// from a 401-retry path. previousToken is the access token that just received a
// 401 from Shopify; if another caller has already rotated the row to a
// different value while we waited on the advisory lock, we return that one
// without making a redundant refresh call. Pass "" if the caller has no prior
// token to compare against.
func ForceRefreshAccessToken(
	ctx context.Context, sqlDB *sql.DB, shop, previousToken string,
) (string, error) {
	return refreshSessionWithLock(ctx, sqlDB, shop, previousToken)
}

// readSession returns the latest offline Session row for shop.
func readSession(
	ctx context.Context,
	q interface {
		QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	},
	shop string,
) (token string, refresh sql.NullString, expires sql.NullTime, err error) {
	err = q.QueryRowContext(ctx, `
		SELECT "accessToken", "refreshToken", "expires"
		FROM public."Session"
		WHERE shop = $1 AND "isOnline" = false
		ORDER BY "expires" IS NULL DESC, "expires" DESC
		LIMIT 1
	`, shop).Scan(&token, &refresh, &expires)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", refresh, expires, fmt.Errorf("no offline session for %s", shop)
		}
		return "", refresh, expires, err
	}
	if token == "" {
		return "", refresh, expires, errors.New("empty access token")
	}
	return token, refresh, expires, nil
}

// refreshSessionWithLock acquires a transaction-scoped Postgres advisory lock
// keyed on shop, re-reads the Session row inside the transaction, and refreshes
// via OAuth if a refresh is still needed. Shopify rotates the refresh token on
// each call, so without this lock concurrent refreshes would race and one
// would receive invalid_grant.
//
// The "still needed" check has two modes:
//   - previousToken == "": proactive refresh path. Skip if the row's expires is
//     still beyond the safety window (another caller refreshed during our wait).
//   - previousToken != "": 401-retry path. Skip only if the row's accessToken
//     differs from previousToken. A future-dated expires is not enough — the
//     caller already proved Shopify rejected that token.
func refreshSessionWithLock(
	ctx context.Context, sqlDB *sql.DB, shop, previousToken string,
) (string, error) {
	clientID := os.Getenv("SHOPIFY_API_KEY")
	clientSecret := os.Getenv("SHOPIFY_API_SECRET")
	if clientID == "" || clientSecret == "" {
		return "", errors.New("SHOPIFY_API_KEY / SHOPIFY_API_SECRET not set")
	}

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, shop); err != nil {
		return "", fmt.Errorf("acquire shop refresh lock: %w", err)
	}

	token, refresh, expires, err := readSession(ctx, tx, shop)
	if err != nil {
		return "", err
	}

	if previousToken == "" {
		if expires.Valid && time.Until(expires.Time) > refreshSafetyWindow {
			if err := tx.Commit(); err != nil {
				return "", fmt.Errorf("commit after lost-race read: %w", err)
			}
			return token, nil
		}
	} else if token != previousToken {
		if err := tx.Commit(); err != nil {
			return "", fmt.Errorf("commit after lost-race read: %w", err)
		}
		return token, nil
	}

	if !refresh.Valid || refresh.String == "" {
		return "", fmt.Errorf("session for %s has no refresh token; reinstall the app to mint an expiring token", shop)
	}

	refreshed, err := RefreshOfflineToken(ctx, shop, clientID, clientSecret, refresh.String)
	if err != nil {
		return "", fmt.Errorf("refresh token: %w", err)
	}
	if refreshed.AccessToken == "" || refreshed.RefreshToken == "" {
		return "", errors.New("oauth refresh returned empty token(s)")
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE public."Session"
		SET "accessToken"         = $1,
		    "refreshToken"        = $2,
		    "expires"             = $3,
		    "refreshTokenExpires" = $4,
		    "scope"               = $5
		WHERE shop = $6 AND "isOnline" = false
	`, refreshed.AccessToken, refreshed.RefreshToken, refreshed.ExpiresAt,
		refreshed.RefreshTokenExpiresAt, refreshed.Scope, shop); err != nil {
		return "", fmt.Errorf("persist refreshed session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit refreshed session: %w", err)
	}
	return refreshed.AccessToken, nil
}
