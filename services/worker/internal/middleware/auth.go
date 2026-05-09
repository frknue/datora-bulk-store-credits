package middleware

import (
	"net/http"
	"os"

	"github.com/joho/godotenv"
)

func init() {
	godotenv.Load()
}

func Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presharedKey := os.Getenv("PRESHARED_AUTH_HEADER_KEY")
		if presharedKey == "" {
			presharedKey = "x-api-key"
		}

		presharedValue := os.Getenv("PRESHARED_AUTH_HEADER_VALUE")
		headerValue := r.Header.Get(presharedKey)

		if headerValue == "" {
			http.Error(w, "Unauthorized - no API key provided", http.StatusUnauthorized)
			return
		}

		if presharedValue != "" && headerValue != presharedValue {
			http.Error(w, "Unauthorized - invalid API key", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
