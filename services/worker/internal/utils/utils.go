package utils

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"os"
)

// ValidateEncryptionKey checks that GIFT_CARD_ENCRYPTION_KEY is set and valid.
// Call this at worker startup so misconfigurations are caught early.
func ValidateEncryptionKey() error {
	_, err := getEncryptionKey()
	return err
}

// getEncryptionKey retrieves and decodes the encryption key from the environment.
// The key must be a 32-byte (256-bit) hex string.
func getEncryptionKey() ([]byte, error) {
	keyHex := os.Getenv("GIFT_CARD_ENCRYPTION_KEY")
	if keyHex == "" {
		return nil, errors.New("GIFT_CARD_ENCRYPTION_KEY not set")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, fmt.Errorf("error decoding encryption key: %v", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid key length: %d. Key must be a 32-byte (256-bit) hex string", len(key))
	}
	return key, nil
}

// pkcs7Pad pads data to a multiple of blockSize using PKCS#7 padding.
func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	padText := bytes.Repeat([]byte{byte(padding)}, padding)
	return append(data, padText...)
}

// pkcs7Unpad removes PKCS#7 padding.
func pkcs7Unpad(data []byte) ([]byte, error) {
	length := len(data)
	if length == 0 {
		return nil, errors.New("invalid padded data (empty)")
	}
	padLen := int(data[length-1])
	if padLen > length || padLen == 0 {
		return nil, errors.New("invalid padding")
	}
	// Verify that all padding bytes are the same.
	for i := length - padLen; i < length; i++ {
		if data[i] != byte(padLen) {
			return nil, errors.New("invalid padding")
		}
	}
	return data[:length-padLen], nil
}

// splitAtFirstColon splits a string at the first occurrence of ':'.
// It returns a slice with two elements: before and after the colon.
func splitAtFirstColon(s string) []string {
	idx := -1
	for i, c := range s {
		if c == ':' {
			idx = i
			break
		}
	}
	if idx == -1 {
		return []string{s}
	}
	return []string{s[:idx], s[idx+1:]}
}

// generateRandomString generates a random alphanumeric string of the given length.
// The character set used is "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".
func generateRandomString(length int) (string, error) {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)
	charsetLen := big.NewInt(int64(len(charset)))
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, charsetLen)
		if err != nil {
			return "", fmt.Errorf("error generating random number: %v", err)
		}
		result[i] = charset[n.Int64()]
	}
	return string(result), nil
}

// GenerateGiftCardCode generates a gift card code with an optional prefix and postfix.
// The total length must be between 8 and 20 characters.
// The generated code is composed of the prefix, a random alphanumeric part, and the postfix.
func GenerateGiftCardCode(length int, prefix, postfix string) (string, error) {
	if length < 8 {
		return "", errors.New("the code length must be at least 8 characters long")
	}
	if length > 20 {
		return "", errors.New("the code length must not exceed 20 characters")
	}

	prefixLength := len(prefix)
	postfixLength := len(postfix)
	randomPartLength := length - prefixLength - postfixLength

	if randomPartLength <= 0 {
		return "", errors.New("the combined length of the prefix and postfix equals or exceeds the specified code length")
	}

	randomPart, err := generateRandomString(randomPartLength)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s%s%s", prefix, randomPart, postfix), nil
}
