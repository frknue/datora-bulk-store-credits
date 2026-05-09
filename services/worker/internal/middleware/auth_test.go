package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/middleware"
	"github.com/gorilla/mux"
)

func TestAuthenticateMiddleware(t *testing.T) {
	// Set up the expected API key
	expectedAPIKey := "test-api-key"
	os.Setenv("PRESHARED_AUTH_HEADER_VALUE", expectedAPIKey)
	os.Setenv("PRESHARED_AUTH_HEADER_KEY", "x-api-key")
	// Clean up the env vars after the test
	defer os.Unsetenv("PRESHARED_AUTH_HEADER_VALUE")
	defer os.Unsetenv("PRESHARED_AUTH_HEADER_KEY")

	// Set up the router and attach the protected endpoint
	router := mux.NewRouter()
	router.HandleFunc("/protected", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	// Wrap the router with the Authenticate middleware
	authenticatedRouter := middleware.Authenticate(router)

	// Define test cases
	tests := []struct {
		name         string
		headerKey    string
		headerValue  string
		expectedCode int
	}{
		{
			name:         "Missing API key header",
			headerKey:    "", // No header provided
			headerValue:  "",
			expectedCode: http.StatusUnauthorized,
		},
		{
			name:         "Incorrect API key",
			headerKey:    "x-api-key",
			headerValue:  "wrong-api-key",
			expectedCode: http.StatusUnauthorized,
		},
		{
			name:         "Correct API key",
			headerKey:    "x-api-key",
			headerValue:  expectedAPIKey,
			expectedCode: http.StatusOK,
		},
	}

	// Run the test cases
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Create a new HTTP request targeting the protected endpoint
			req := httptest.NewRequest("GET", "/protected", nil)
			if tc.headerKey != "" {
				req.Header.Set(tc.headerKey, tc.headerValue)
			}

			// Record the response using httptest.ResponseRecorder
			rr := httptest.NewRecorder()

			// Serve the HTTP request through the authenticated router
			authenticatedRouter.ServeHTTP(rr, req)

			// Verify the status code
			if rr.Code != tc.expectedCode {
				t.Errorf("expected status %d, got %d", tc.expectedCode, rr.Code)
			}
		})
	}
}
