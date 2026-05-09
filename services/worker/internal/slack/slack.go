package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var appHandle = getAppHandle()

func getAppHandle() string {
	if h := os.Getenv("SHOPIFY_APP_HANDLE"); h != "" {
		return h
	}
	return "datora-bulk-store-credits"
}

// JobResult contains the information needed to format a Slack notification.
type JobResult struct {
	JobID    string
	ShopName string
	JobType  string  // "create" or "deactivate"
	Status   string  // "completed" or "failed"
	Count    int
	Value    float64
	Currency string
	ErrorMsg string
}

// SendJobNotification posts a formatted message to the given Slack webhook URL.
// Designed to be called in a fire-and-forget goroutine.
func SendJobNotification(webhookURL string, result JobResult) {
	if webhookURL == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	payload := buildPayload(result)

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Slack: failed to marshal payload for job %s: %v", result.JobID, err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("Slack: failed to create request for job %s: %v", result.JobID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Slack: failed to send notification for job %s: %v", result.JobID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Slack: webhook returned %d for job %s", resp.StatusCode, result.JobID)
		return
	}

	log.Printf("Slack: notification sent for job %s", result.JobID)
}

func buildPayload(r JobResult) map[string]interface{} {
	storeSlug := strings.TrimSuffix(r.ShopName, ".myshopify.com")
	shortID := r.JobID
	if len(shortID) > 8 {
		shortID = strings.ToUpper(shortID[:8])
	}

	jobLink := fmt.Sprintf(
		"https://admin.shopify.com/store/%s/apps/%s/app/gift-cards/%s",
		storeSlug, appHandle, r.JobID,
	)

	var emoji, statusText, detailLine string

	if r.Status == "completed" {
		emoji = ":white_check_mark:"
		statusText = "completed"
		if r.JobType == "deactivate" {
			detailLine = fmt.Sprintf("%d gift cards deactivated", r.Count)
		} else {
			totalValue := float64(r.Count) * r.Value
			detailLine = fmt.Sprintf(
				"%d gift cards created \u2022 %.2f %s each \u2022 %.2f %s total",
				r.Count, r.Value, r.Currency, totalValue, r.Currency,
			)
		}
	} else {
		emoji = ":x:"
		statusText = "failed"
		detailLine = r.ErrorMsg
		if detailLine == "" {
			detailLine = "Unknown error"
		}
	}

	headerText := fmt.Sprintf("%s Job #%s %s", emoji, shortID, statusText)

	blocks := []map[string]interface{}{
		{
			"type": "section",
			"text": map[string]interface{}{
				"type": "mrkdwn",
				"text": fmt.Sprintf("*%s*\n%s\n\n<%s|View job in Shopify Admin>", headerText, detailLine, jobLink),
			},
		},
	}

	return map[string]interface{}{
		"text":   fmt.Sprintf("Job #%s %s", shortID, statusText),
		"blocks": blocks,
	}
}
