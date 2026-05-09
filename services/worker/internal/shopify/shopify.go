package shopify

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/db"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/models"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/utils"
	"github.com/go-redis/redis/v8"
)

// shopifyClient is a pre-configured HTTP client for Shopify API calls.
// It uses proper timeouts and connection pooling to handle long-running
// bulk operations (thousands of gift cards) reliably.
var shopifyClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConns:          20,
		MaxIdleConnsPerHost:   10,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
	},
}

// GraphQL mutation for creating a gift card
const giftCardCreateMutation = `
mutation giftCardCreate($input: GiftCardCreateInput!) {
  giftCardCreate(input: $input) {
    giftCard {
      id
      balance {
        amount
        currencyCode
      }
      initialValue {
        amount
        currencyCode
      }
      lastCharacters
      note
      expiresOn
      createdAt
    }
    giftCardCode
    userErrors {
      field
      message
      code
    }
  }
}
`

// GraphQL mutation for sending gift card notification to recipient
const giftCardSendNotificationMutation = `
mutation giftCardSendNotificationToRecipient($id: ID!) {
  giftCardSendNotificationToRecipient(id: $id) {
    giftCard {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}
`

// GraphQL mutation for deactivating a gift card
const giftCardDeactivateMutation = `
mutation giftCardDeactivate($id: ID!) {
  giftCardDeactivate(id: $id) {
    giftCard {
      id
      deactivatedAt
    }
    userErrors {
      field
      message
      code
    }
  }
}
`

// GiftCardDeactivatePayload represents the payload returned by giftCardDeactivate mutation
type GiftCardDeactivatePayload struct {
	GiftCard   *struct {
		ID            string  `json:"id"`
		DeactivatedAt *string `json:"deactivatedAt"`
	} `json:"giftCard"`
	UserErrors []GraphQLUserError `json:"userErrors"`
}

// GraphQLDeactivateResponse represents the top-level GraphQL response for gift card deactivation
type GraphQLDeactivateResponse struct {
	Data struct {
		GiftCardDeactivate GiftCardDeactivatePayload `json:"giftCardDeactivate"`
	} `json:"data"`
	Errors []GraphQLError `json:"errors,omitempty"`
}

// GiftCardCreateInput defines the GraphQL input structure for creating a gift card
type GiftCardCreateInput struct {
	InitialValue        string                  `json:"initialValue"`
	Code                string                  `json:"code"`
	Note                string                  `json:"note,omitempty"`
	ExpiresOn           *string                 `json:"expiresOn,omitempty"`
	CustomerID          *string                 `json:"customerId,omitempty"`
	RecipientAttributes *GiftCardRecipientInput `json:"recipientAttributes,omitempty"`
}

// GiftCardRecipientInput defines the recipient fields supported by giftCardCreate.
type GiftCardRecipientInput struct {
	ID                 string  `json:"id"`
	SendNotificationAt *string `json:"sendNotificationAt,omitempty"`
	Message            *string `json:"message,omitempty"`
}

// GraphQLRequest wraps the GraphQL query and variables
type GraphQLRequest struct {
	Query     string                 `json:"query"`
	Variables map[string]interface{} `json:"variables"`
}

// GraphQLGiftCard represents the gift card returned by GraphQL
type GraphQLGiftCard struct {
	ID             string         `json:"id"`
	Balance        models.MoneyV2 `json:"balance"`
	InitialValue   models.MoneyV2 `json:"initialValue"`
	LastCharacters string         `json:"lastCharacters"`
	Note           *string        `json:"note,omitempty"`
	ExpiresOn      *string        `json:"expiresOn,omitempty"`
	CreatedAt      string         `json:"createdAt"`
}

// GraphQLUserError represents a user error in the GraphQL response
type GraphQLUserError struct {
	Field   []string `json:"field"`
	Message string   `json:"message"`
	Code    *string  `json:"code,omitempty"`
}

// GiftCardCreatePayload represents the payload returned by giftCardCreate mutation
type GiftCardCreatePayload struct {
	GiftCard     *GraphQLGiftCard   `json:"giftCard"`
	GiftCardCode *string            `json:"giftCardCode"`
	UserErrors   []GraphQLUserError `json:"userErrors"`
}

// GiftCardNotificationPayload represents the payload returned by giftCardSendNotificationToRecipient
type GiftCardNotificationPayload struct {
	GiftCard   *struct{ ID string } `json:"giftCard"`
	UserErrors []GraphQLUserError   `json:"userErrors"`
}

// GraphQLError represents an error in the GraphQL response
type GraphQLError struct {
	Message    string                 `json:"message"`
	Extensions map[string]interface{} `json:"extensions,omitempty"`
}

// GraphQLResponse represents the top-level GraphQL response for gift card creation
type GraphQLResponse struct {
	Data struct {
		GiftCardCreate GiftCardCreatePayload `json:"giftCardCreate"`
	} `json:"data"`
	Errors []GraphQLError `json:"errors,omitempty"`
}

type giftCardFallback struct {
	Value     float64
	Note      *string
	ExpiresOn *string
}

// GraphQLNotificationResponse represents the response for sending notification
type GraphQLNotificationResponse struct {
	Data struct {
		GiftCardSendNotificationToRecipient GiftCardNotificationPayload `json:"giftCardSendNotificationToRecipient"`
	} `json:"data"`
	Errors []GraphQLError `json:"errors,omitempty"`
}

// CreateGiftCards implements the logic of creating gift cards
// with rate limiting, job status updates in Redis, and error handling.
func CreateGiftCards(ctx context.Context, sqlDB *sql.DB, redisClient *redis.Client, job models.JobData, token string) ([]models.GiftCard, error) {
	// Extract customer IDs if available (filtering out empty entries).
	var customerIDs []string
	if job.CustomerIDs != nil && strings.TrimSpace(*job.CustomerIDs) != "" {
		for _, id := range strings.Split(*job.CustomerIDs, ",") {
			if trimmed := strings.TrimSpace(id); trimmed != "" {
				customerIDs = append(customerIDs, trimmed)
			}
		}
	}

	// Determine the number of gift cards to create.
	jobCount := job.Count
	if len(customerIDs) > 0 {
		jobCount = len(customerIDs)
	}

	// Set initial job status in Redis with 24-hour TTL to prevent key leaks.
	// The caller is responsible for setting DB status to running (via ClaimJob).
	redisKey := fmt.Sprintf("job_status:%s", job.ID)
	redisClient.HSet(ctx, redisKey, map[string]interface{}{
		"status": "running",
		"done":   0,
		"total":  jobCount,
	})
	redisClient.Expire(ctx, redisKey, 24*time.Hour)

	// If there are already gift cards attached to the job, decrypt them.
	giftCards := job.GiftCards
	for i := range giftCards {
		decrypted, err := utils.DecryptGiftCard(giftCards[i].Code)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt gift card: %w", err)
		}
		giftCards[i].Code = decrypted
	}
	createdCount := len(giftCards)

	// Always use GraphQL API.
	apiURL := fmt.Sprintf("https://%s/admin/api/2026-01/graphql.json", job.ShopName)

	// Loop to create the remaining gift cards.
	for i := createdCount; i < jobCount; i++ {
		currentStatus, err := db.GetJobStatus(ctx, sqlDB, job.ID)
		if err != nil {
			return nil, fmt.Errorf("failed to get job status: %w", err)
		}
		if currentStatus == string(db.JobStatusCancelled) {
			redisClient.HSet(ctx, redisKey, map[string]interface{}{
				"status": "cancelled",
				"done":   i,
				"total":  jobCount,
			})
			redisClient.Expire(ctx, redisKey, 24*time.Hour)
			return giftCards, nil
		}

		// Generate a gift card code.
		prefix := ""
		if job.Prefix != nil {
			prefix = *job.Prefix
		}
		postfix := ""
		if job.Postfix != nil {
			postfix = *job.Postfix
		}

		// Build the base input (shared across code collision retries).
		var currentCustomerID string
		if i < len(customerIDs) {
			currentCustomerID = customerIDs[i]
		}

		// Retry loop for code collisions ("Code has already been taken").
		// High retry count for large jobs (75k+) where collisions are more likely.
		const maxCodeRetries = 50
		var createdGC models.GiftCard
		var createErr error

		for codeAttempt := 0; codeAttempt < maxCodeRetries; codeAttempt++ {
			giftCardCode, err := utils.GenerateGiftCardCode(job.CodeLength, prefix, postfix)
			if err != nil {
				return nil, fmt.Errorf("failed to generate gift card code: %w", err)
			}

			input := GiftCardCreateInput{
				InitialValue: fmt.Sprintf("%.2f", job.Value),
				Code:         giftCardCode,
				ExpiresOn:    job.ExpireDate,
			}

			if job.Note != nil && *job.Note != "" {
				input.Note = *job.Note
			}

			if currentCustomerID != "" {
				recipientGID := fmt.Sprintf("gid://shopify/Customer/%s", currentCustomerID)
				input.RecipientAttributes = &GiftCardRecipientInput{
					ID: recipientGID,
				}

				if job.ScheduledTimestamp != nil && *job.ScheduledTimestamp != "" {
					input.RecipientAttributes.SendNotificationAt = job.ScheduledTimestamp
				}
				if job.ScheduledMessage != nil && *job.ScheduledMessage != "" {
					input.RecipientAttributes.Message = job.ScheduledMessage
				}
			}

			reqBody := GraphQLRequest{
				Query: giftCardCreateMutation,
				Variables: map[string]interface{}{
					"input": input,
				},
			}

			var hadNetworkError bool
			createdGC, hadNetworkError, createErr = createWithRateLimiting(ctx, apiURL, reqBody, token, giftCardFallback{
				Value:     job.Value,
				Note:      job.Note,
				ExpiresOn: job.ExpireDate,
			})

			if createErr == nil {
				break
			}

			isCodeTaken := strings.Contains(createErr.Error(), "Code has already been taken")
			if !isCodeTaken {
				// Not a code collision — fail immediately.
				break
			}

			if hadNetworkError {
				// "Code already taken" after a network error means the original
				// request likely succeeded. Treat this as success to avoid
				// creating a duplicate gift card with a new code.
				fmt.Printf("Code taken after network error on card %d — treating as success (original request likely succeeded)\n", i+1)
				createdGC = buildFallbackGiftCard(giftCardCode, giftCardFallback{
					Value:     job.Value,
					Note:      job.Note,
					ExpiresOn: job.ExpireDate,
				})
				createErr = nil
				break
			}

			// True code collision (no prior network error) — regenerate and retry.
			fmt.Printf("Code collision on card %d (attempt %d/%d), regenerating code...\n", i+1, codeAttempt+1, maxCodeRetries)
		}

		// Handle creation errors after all retries exhausted.
		if createErr != nil {
			redisClient.HSet(ctx, redisKey, map[string]interface{}{
				"status": "failed",
				"done":   i,
				"total":  jobCount,
			})
			redisClient.Expire(ctx, redisKey, 24*time.Hour)
			errMsg := createErr.Error()
			if errSave := db.SaveErrorMessage(ctx, sqlDB, job.ID, &errMsg); errSave != nil {
				fmt.Printf("failed to save error message: %v\n", errSave)
			}
			if errSave := db.SaveGiftCardsToDb(ctx, sqlDB, giftCards, job); errSave != nil {
				fmt.Printf("failed to save gift cards: %v\n", errSave)
			}
			return nil, createErr
		}

		// Send the notification immediately when the job isn't scheduled.
		if currentCustomerID != "" && (job.ScheduledTimestamp == nil || *job.ScheduledTimestamp == "") {
			giftCardGID := fmt.Sprintf("gid://shopify/GiftCard/%.0f", createdGC.ID)

			notifReqBody := GraphQLRequest{
				Query: giftCardSendNotificationMutation,
				Variables: map[string]interface{}{
					"id": giftCardGID,
				},
			}

			if err := sendNotificationWithRateLimiting(ctx, apiURL, notifReqBody, token); err != nil {
				// Log but don't fail the whole job for notification errors
				fmt.Printf("Warning: failed to send notification for gift card %.0f to customer %s: %v\n", createdGC.ID, currentCustomerID, err)
			}
		}

		// Append the newly created gift card.
		giftCards = append(giftCards, createdGC)

		// Update Redis job status.
		redisClient.HSet(ctx, redisKey, map[string]interface{}{
			"status": "running",
			"done":   i + 1,
			"total":  jobCount,
		})
		redisClient.Expire(ctx, redisKey, 24*time.Hour)

		// Checkpoint partial results every 25 cards so that crashes don't
		// lose all progress. Errors are logged but don't fail the job.
		const checkpointInterval = 25
		if len(giftCards)%checkpointInterval == 0 {
			if cpErr := db.CheckpointGiftCards(ctx, sqlDB, giftCards, job); cpErr != nil {
				fmt.Printf("Warning: checkpoint failed for job %s at %d cards: %v\n", job.ID, len(giftCards), cpErr)
			}
		}
	}

	currentStatus, err := db.GetJobStatus(ctx, sqlDB, job.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get final job status: %w", err)
	}
	if currentStatus == string(db.JobStatusCancelled) {
		redisClient.HSet(ctx, redisKey, map[string]interface{}{
			"status": "cancelled",
			"done":   len(giftCards),
			"total":  jobCount,
		})
		redisClient.Expire(ctx, redisKey, 24*time.Hour)
		return giftCards, nil
	}

	// Terminal Redis status (completed/failed) is set by the handler after DB persistence.
	// We only return the created gift cards here.
	return giftCards, nil
}

// createWithRateLimiting performs the GraphQL API call to Shopify with a retry mechanism
// to handle rate limits (HTTP 429) using exponential backoff.
// The returned hadNetworkError flag indicates whether a network error occurred during
// the request. The caller uses this to distinguish ambiguous "code already taken"
// errors (which may mean the original request succeeded) from true code collisions.
func createWithRateLimiting(
	ctx context.Context,
	apiURL string,
	body GraphQLRequest,
	token string,
	fallback giftCardFallback,
) (createdGiftCard models.GiftCard, hadNetworkError bool, err error) {
	const maxRetries = 5
	retries := 0
	waitTime := 2 * time.Second

	// Marshal the request body to JSON.
	jsonBody, marshalErr := json.Marshal(body)
	if marshalErr != nil {
		return createdGiftCard, false, fmt.Errorf("failed to marshal request body: %w", marshalErr)
	}

	for retries < maxRetries {
		req, reqErr := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(jsonBody))
		if reqErr != nil {
			return createdGiftCard, hadNetworkError, fmt.Errorf("failed to create request: %w", reqErr)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Shopify-Access-Token", token)

		resp, doErr := shopifyClient.Do(req)
		if doErr != nil {
			hadNetworkError = true
			// Retry on transient network errors (connection reset, timeout, etc.)
			if retries < maxRetries-1 {
				retries++
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				fmt.Printf("Network error (attempt %d/%d): %v. Retrying in %v...\n", retries, maxRetries, doErr, waitTime)
				time.Sleep(waitTime)
				continue
			}
			return createdGiftCard, hadNetworkError, fmt.Errorf("failed to perform HTTP request after %d attempts: %w", retries+1, doErr)
		}

		// Always close the response body.
		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		// Handle HTTP-level rate limit (HTTP 429) - rare for GraphQL but possible
		if resp.StatusCode == http.StatusTooManyRequests && retries < maxRetries {
			retryAfterStr := resp.Header.Get("Retry-After")
			if retryAfterStr != "" {
				if seconds, atoiErr := strconv.Atoi(retryAfterStr); atoiErr == nil {
					waitTime = time.Duration(seconds) * time.Second
				}
			} else {
				// Exponential backoff with some added randomness.
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
			}

			time.Sleep(waitTime)
			retries++
			continue
		}

		// Retry on transient server errors (5xx). These are common during
		// high-volume operations (e.g. Shopify/Cloudflare returning 502).
		// Mark hadNetworkError because the request may have been processed.
		if resp.StatusCode >= 500 {
			hadNetworkError = true
			if retries < maxRetries-1 {
				retries++
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				fmt.Printf("Server error %d (attempt %d/%d): %s. Retrying in %v...\n", resp.StatusCode, retries, maxRetries, string(bodyBytes), waitTime)
				time.Sleep(waitTime)
				continue
			}
			return createdGiftCard, hadNetworkError, fmt.Errorf("Shopify API error (status %d) after %d attempts: %s", resp.StatusCode, retries+1, string(bodyBytes))
		}

		// For other non-200 status codes (4xx except 429), return the error.
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return createdGiftCard, hadNetworkError, fmt.Errorf("Shopify API error (status %d): %s", resp.StatusCode, string(bodyBytes))
		}

		// Parse the GraphQL response.
		var gqlResp GraphQLResponse
		if unmarshalErr := json.Unmarshal(bodyBytes, &gqlResp); unmarshalErr != nil {
			return createdGiftCard, hadNetworkError, fmt.Errorf("failed to unmarshal GraphQL response: %w", unmarshalErr)
		}

		// CRITICAL: Check for GraphQL-level THROTTLED errors
		// Shopify GraphQL returns 200 OK even when throttled!
		if len(gqlResp.Errors) > 0 {
			isThrottled := false
			for _, e := range gqlResp.Errors {
				if len(e.Extensions) > 0 {
					if code, ok := e.Extensions["code"].(string); ok && code == "THROTTLED" {
						isThrottled = true
						break
					}
				}
				if strings.Contains(strings.ToLower(e.Message), "throttled") {
					isThrottled = true
					break
				}
			}

			if isThrottled && retries < maxRetries {
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				fmt.Printf("Rate limit reached (attempt %d/%d). Waiting %v before retrying...\n", retries+1, maxRetries, waitTime)
				time.Sleep(waitTime)
				retries++
				continue
			}

			errorMessages := make([]string, len(gqlResp.Errors))
			for i, e := range gqlResp.Errors {
				errorMessages[i] = e.Message
			}
			return createdGiftCard, hadNetworkError, fmt.Errorf("GraphQL errors: %s", strings.Join(errorMessages, "; "))
		}

		// Check for user errors.
		if len(gqlResp.Data.GiftCardCreate.UserErrors) > 0 {
			errorMessages := make([]string, len(gqlResp.Data.GiftCardCreate.UserErrors))
			for i, e := range gqlResp.Data.GiftCardCreate.UserErrors {
				errorMessages[i] = fmt.Sprintf("%s: %s", strings.Join(e.Field, "."), e.Message)
			}
			return createdGiftCard, hadNetworkError, fmt.Errorf("validation errors: %s", strings.Join(errorMessages, "; "))
		}

		// Extract the gift card code - CRITICAL: comes from separate field!
		code := ""
		if gqlResp.Data.GiftCardCreate.GiftCardCode != nil {
			code = *gqlResp.Data.GiftCardCreate.GiftCardCode
		}
		if code == "" {
			return createdGiftCard, hadNetworkError, fmt.Errorf("no gift card code returned in response")
		}

		// Some shops can create gift cards but can't read the GiftCard object back.
		gqlGiftCard := gqlResp.Data.GiftCardCreate.GiftCard
		if gqlGiftCard == nil {
			createdGiftCard = buildFallbackGiftCard(code, fallback)
			return createdGiftCard, hadNetworkError, nil
		}

		// Parse created timestamp.
		createdAt, parseErr := time.Parse(time.RFC3339, gqlGiftCard.CreatedAt)
		if parseErr != nil {
			createdAt = time.Now()
		}

		var expiresOn *time.Time
		if gqlGiftCard.ExpiresOn != nil && *gqlGiftCard.ExpiresOn != "" {
			expDate, expErr := time.Parse("2006-01-02", *gqlGiftCard.ExpiresOn)
			if expErr == nil {
				expiresOn = &expDate
			}
		}

		value := 0.0
		if amt, amtErr := strconv.ParseFloat(gqlGiftCard.InitialValue.Amount, 64); amtErr == nil {
			value = amt
		}

		numericID := 0.0
		if strings.HasPrefix(gqlGiftCard.ID, "gid://shopify/GiftCard/") {
			idStr := strings.TrimPrefix(gqlGiftCard.ID, "gid://shopify/GiftCard/")
			if id, idErr := strconv.ParseFloat(idStr, 64); idErr == nil {
				numericID = id
			}
		} else {
			if id, idErr := strconv.ParseFloat(gqlGiftCard.ID, 64); idErr == nil {
				numericID = id
			}
		}

		createdGiftCard = models.GiftCard{
			ID:             numericID,
			Balance:        gqlGiftCard.Balance.Amount,
			Currency:       gqlGiftCard.Balance.CurrencyCode,
			Code:           code,
			Value:          value,
			Note:           gqlGiftCard.Note,
			ExpiresOn:      expiresOn,
			LastCharacters: gqlGiftCard.LastCharacters,
			CreatedAt:      createdAt,
		}

		return createdGiftCard, hadNetworkError, nil
	}

	return createdGiftCard, hadNetworkError, fmt.Errorf("exceeded maximum retries (%d) for rate limits", maxRetries)
}

func buildFallbackGiftCard(code string, fallback giftCardFallback) models.GiftCard {
	createdAt := time.Now().UTC()

	var expiresOn *time.Time
	if fallback.ExpiresOn != nil && *fallback.ExpiresOn != "" {
		if parsed, err := time.Parse("2006-01-02", *fallback.ExpiresOn); err == nil {
			expiresOn = &parsed
		}
	}

	lastCharacters := code
	if len(code) > 4 {
		lastCharacters = code[len(code)-4:]
	}

	return models.GiftCard{
		ID:             0,
		Balance:        fmt.Sprintf("%.2f", fallback.Value),
		Currency:       "",
		Code:           code,
		Value:          fallback.Value,
		Note:           fallback.Note,
		ExpiresOn:      expiresOn,
		LastCharacters: lastCharacters,
		Status:         "enabled",
		CreatedAt:      createdAt,
	}
}

// sendNotificationWithRateLimiting sends a gift card notification to a customer via GraphQL
// with retry logic for rate limiting.
func sendNotificationWithRateLimiting(ctx context.Context, apiURL string, body GraphQLRequest, token string) error {
	const maxRetries = 5
	retries := 0
	waitTime := 2 * time.Second

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal notification request body: %w", err)
	}

	for retries < maxRetries {
		req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(jsonBody))
		if err != nil {
			return fmt.Errorf("failed to create notification request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Shopify-Access-Token", token)

		resp, err := shopifyClient.Do(req)
		if err != nil {
			if retries < maxRetries-1 {
				retries++
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				fmt.Printf("Notification network error (attempt %d/%d): %v. Retrying in %v...\n", retries, maxRetries, err, waitTime)
				time.Sleep(waitTime)
				continue
			}
			return fmt.Errorf("failed to perform notification HTTP request after %d attempts: %w", retries+1, err)
		}

		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		// Handle HTTP-level rate limit
		if resp.StatusCode == http.StatusTooManyRequests && retries < maxRetries {
			retryAfterStr := resp.Header.Get("Retry-After")
			if retryAfterStr != "" {
				if seconds, err := strconv.Atoi(retryAfterStr); err == nil {
					waitTime = time.Duration(seconds) * time.Second
				}
			} else {
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
			}
			time.Sleep(waitTime)
			retries++
			continue
		}

		// Retry on transient server errors (5xx).
		if resp.StatusCode >= 500 {
			if retries < maxRetries-1 {
				retries++
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				fmt.Printf("Notification server error %d (attempt %d/%d). Retrying in %v...\n", resp.StatusCode, retries, maxRetries, waitTime)
				time.Sleep(waitTime)
				continue
			}
			return fmt.Errorf("Shopify notification API error (status %d) after %d attempts: %s", resp.StatusCode, retries+1, string(bodyBytes))
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("Shopify notification API error (status %d): %s", resp.StatusCode, string(bodyBytes))
		}

		// Parse the GraphQL response.
		var gqlResp GraphQLNotificationResponse
		if err := json.Unmarshal(bodyBytes, &gqlResp); err != nil {
			return fmt.Errorf("failed to unmarshal notification response: %w", err)
		}

		// Check for GraphQL-level THROTTLED errors
		if len(gqlResp.Errors) > 0 {
			isThrottled := false
			for _, e := range gqlResp.Errors {
				if len(e.Extensions) > 0 {
					if code, ok := e.Extensions["code"].(string); ok && code == "THROTTLED" {
						isThrottled = true
						break
					}
				}
				if strings.Contains(strings.ToLower(e.Message), "throttled") {
					isThrottled = true
					break
				}
			}

			if isThrottled && retries < maxRetries {
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				fmt.Printf("Notification rate limit reached (attempt %d/%d). Waiting %v before retrying...\n", retries+1, maxRetries, waitTime)
				time.Sleep(waitTime)
				retries++
				continue
			}

			errorMessages := make([]string, len(gqlResp.Errors))
			for i, e := range gqlResp.Errors {
				errorMessages[i] = e.Message
			}
			return fmt.Errorf("notification GraphQL errors: %s", strings.Join(errorMessages, "; "))
		}

		// Check for user errors.
		if len(gqlResp.Data.GiftCardSendNotificationToRecipient.UserErrors) > 0 {
			errorMessages := make([]string, len(gqlResp.Data.GiftCardSendNotificationToRecipient.UserErrors))
			for i, e := range gqlResp.Data.GiftCardSendNotificationToRecipient.UserErrors {
				errorMessages[i] = fmt.Sprintf("%s: %s", strings.Join(e.Field, "."), e.Message)
			}
			return fmt.Errorf("notification validation errors: %s", strings.Join(errorMessages, "; "))
		}

		return nil
	}

	return fmt.Errorf("exceeded maximum retries (%d) for notification rate limits", maxRetries)
}

// DeactivateGiftCards deactivates all gift cards from a source job via the Shopify Admin GraphQL API.
// It reads the gift card IDs from the source job and calls giftCardDeactivate for each.
func DeactivateGiftCards(ctx context.Context, sqlDB *sql.DB, redisClient *redis.Client, job models.JobData, sourceJob models.JobData, token string) error {
	giftCards := sourceJob.GiftCards
	totalCards := len(giftCards)

	if totalCards == 0 {
		return fmt.Errorf("source job has no gift cards to deactivate")
	}

	// Set initial Redis status.
	redisKey := fmt.Sprintf("job_status:%s", job.ID)
	redisClient.HSet(ctx, redisKey, map[string]interface{}{
		"status": "running",
		"done":   0,
		"total":  totalCards,
	})
	redisClient.Expire(ctx, redisKey, 24*time.Hour)

	apiURL := fmt.Sprintf("https://%s/admin/api/2026-01/graphql.json", job.ShopName)

	deactivatedCount := 0
	for i, gc := range giftCards {
		// Check for cancellation.
		currentStatus, err := db.GetJobStatus(ctx, sqlDB, job.ID)
		if err != nil {
			return fmt.Errorf("failed to get job status: %w", err)
		}
		if currentStatus == string(db.JobStatusCancelled) {
			redisClient.HSet(ctx, redisKey, map[string]interface{}{
				"status": "cancelled",
				"done":   deactivatedCount,
				"total":  totalCards,
			})
			redisClient.Expire(ctx, redisKey, 24*time.Hour)
			return nil
		}

		// Skip cards without a valid Shopify ID.
		if gc.ID <= 0 {
			log.Printf("Skipping gift card at index %d with no Shopify ID", i)
			deactivatedCount++
			continue
		}

		giftCardGID := fmt.Sprintf("gid://shopify/GiftCard/%.0f", gc.ID)

		err = deactivateWithRateLimiting(ctx, apiURL, giftCardGID, token)
		if err != nil {
			// Log but continue — some cards may already be deactivated.
			log.Printf("Warning: failed to deactivate gift card %s: %v", giftCardGID, err)
		}

		deactivatedCount++
		redisClient.HSet(ctx, redisKey, map[string]interface{}{
			"status": "running",
			"done":   deactivatedCount,
			"total":  totalCards,
		})
		redisClient.Expire(ctx, redisKey, 24*time.Hour)
	}

	return nil
}

// deactivateWithRateLimiting calls the giftCardDeactivate mutation with retry logic.
func deactivateWithRateLimiting(ctx context.Context, apiURL, giftCardGID, token string) error {
	const maxRetries = 5
	retries := 0
	waitTime := 2 * time.Second

	reqBody := GraphQLRequest{
		Query: giftCardDeactivateMutation,
		Variables: map[string]interface{}{
			"id": giftCardGID,
		},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal deactivation request: %w", err)
	}

	for retries < maxRetries {
		req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(jsonBody))
		if err != nil {
			return fmt.Errorf("failed to create deactivation request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Shopify-Access-Token", token)

		resp, err := shopifyClient.Do(req)
		if err != nil {
			if retries < maxRetries-1 {
				retries++
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				log.Printf("Deactivation network error (attempt %d/%d): %v. Retrying in %v...", retries, maxRetries, err, waitTime)
				time.Sleep(waitTime)
				continue
			}
			return fmt.Errorf("failed to perform deactivation request after %d attempts: %w", retries+1, err)
		}

		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		// Handle HTTP 429 rate limit.
		if resp.StatusCode == http.StatusTooManyRequests && retries < maxRetries {
			retryAfterStr := resp.Header.Get("Retry-After")
			if retryAfterStr != "" {
				if seconds, atoiErr := strconv.Atoi(retryAfterStr); atoiErr == nil {
					waitTime = time.Duration(seconds) * time.Second
				}
			} else {
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
			}
			time.Sleep(waitTime)
			retries++
			continue
		}

		// Retry on 5xx.
		if resp.StatusCode >= 500 {
			if retries < maxRetries-1 {
				retries++
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				log.Printf("Deactivation server error %d (attempt %d/%d). Retrying in %v...", resp.StatusCode, retries, maxRetries, waitTime)
				time.Sleep(waitTime)
				continue
			}
			return fmt.Errorf("Shopify deactivation API error (status %d) after %d attempts: %s", resp.StatusCode, retries+1, string(bodyBytes))
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("Shopify deactivation API error (status %d): %s", resp.StatusCode, string(bodyBytes))
		}

		// Parse response.
		var gqlResp GraphQLDeactivateResponse
		if err := json.Unmarshal(bodyBytes, &gqlResp); err != nil {
			return fmt.Errorf("failed to unmarshal deactivation response: %w", err)
		}

		// Check for GraphQL-level THROTTLED errors.
		if len(gqlResp.Errors) > 0 {
			isThrottled := false
			for _, e := range gqlResp.Errors {
				if len(e.Extensions) > 0 {
					if code, ok := e.Extensions["code"].(string); ok && code == "THROTTLED" {
						isThrottled = true
						break
					}
				}
				if strings.Contains(strings.ToLower(e.Message), "throttled") {
					isThrottled = true
					break
				}
			}

			if isThrottled && retries < maxRetries {
				waitTime = waitTime*2 + time.Duration(rand.Intn(1000))*time.Millisecond
				log.Printf("Deactivation rate limit (attempt %d/%d). Waiting %v...", retries+1, maxRetries, waitTime)
				time.Sleep(waitTime)
				retries++
				continue
			}

			errorMessages := make([]string, len(gqlResp.Errors))
			for i, e := range gqlResp.Errors {
				errorMessages[i] = e.Message
			}
			return fmt.Errorf("deactivation GraphQL errors: %s", strings.Join(errorMessages, "; "))
		}

		// Check for user errors (e.g., card already deactivated).
		if len(gqlResp.Data.GiftCardDeactivate.UserErrors) > 0 {
			errorMessages := make([]string, len(gqlResp.Data.GiftCardDeactivate.UserErrors))
			for i, e := range gqlResp.Data.GiftCardDeactivate.UserErrors {
				errorMessages[i] = fmt.Sprintf("%s: %s", strings.Join(e.Field, "."), e.Message)
			}
			// Log user errors but don't fail — card may already be deactivated.
			log.Printf("Deactivation user errors for %s: %s", giftCardGID, strings.Join(errorMessages, "; "))
		}

		return nil
	}

	return fmt.Errorf("exceeded maximum retries (%d) for deactivation rate limits", maxRetries)
}
