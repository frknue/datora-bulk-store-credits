package models

import (
	"time"
)

// MoneyV2 represents a monetary value in GraphQL format.
type MoneyV2 struct {
	Amount       string `json:"amount"`
	CurrencyCode string `json:"currencyCode"`
}

// GiftCard represents a gift card record.
type GiftCard struct {
	ID             float64    `json:"id"`              // Numeric ID for backward compatibility
	Balance        string     `json:"balance"`
	Currency       string     `json:"currency"`
	Code           string     `json:"code"`
	Value          float64    `json:"value"`
	DisabledAt     *time.Time `json:"disabledAt,omitempty"`
	APIClientID    *string    `json:"apiClientId,omitempty"`
	Note           *string    `json:"note,omitempty"`
	ExpiresOn      *time.Time `json:"expiresOn,omitempty"`
	TemplateSuffix *string    `json:"templateSuffix,omitempty"`
	LastCharacters string     `json:"lastCharacters"`
	ShopName       string     `json:"shopName"`
	UserID         *int64     `json:"userId,omitempty"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"createdAt"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
	JobID          *string    `json:"jobId,omitempty"`
}

// JobData represents a job record.
type JobData struct {
	ID                 string     `json:"id"`
	Count              int        `json:"count"`
	Value              float64    `json:"value"`
	Note               *string    `json:"note,omitempty"`
	ShopName           string     `json:"shop_name"`
	UserID             string     `json:"user_id"`
	Status             string     `json:"status"`
	CreatedAt          time.Time  `json:"createdAt"`
	FinishedAt         *time.Time `json:"finishedAt,omitempty"`
	Prefix             *string    `json:"prefix,omitempty"`
	Postfix            *string    `json:"postfix,omitempty"`
	CodeLength         int        `json:"code_length"`
	ExpireDate         *string    `json:"expire_date,omitempty"`
	SubscriptionPlanID *int       `json:"subscription_plan_id,omitempty"`
	CustomerIDs        *string    `json:"customer_ids,omitempty"`
	ScheduledTimestamp *string    `json:"scheduled_timestamp,omitempty"`
	ScheduledMessage   *string    `json:"scheduled_message,omitempty"`
	GiftCards          []GiftCard `json:"gift_cards,omitempty"`
	JobType            string     `json:"job_type"`
	SourceJobID        *string    `json:"source_job_id,omitempty"`
}

// SessionData represents a session record.
type SessionData struct {
	ID          *string    `json:"id,omitempty"`
	Shop        *string    `json:"shop,omitempty"`
	AccessToken string     `json:"accessToken"`
	CreatedAt   *time.Time `json:"createdAt,omitempty"`
	UserID      *string    `json:"userId,omitempty"`
	Expires     *string    `json:"expires,omitempty"`
}

// JobStatus represents the job status.
type JobStatus string

const (
	JobStatusScheduled JobStatus = "scheduled"
	JobStatusPending   JobStatus = "pending"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
	JobStatusCancelled JobStatus = "cancelled"
)
