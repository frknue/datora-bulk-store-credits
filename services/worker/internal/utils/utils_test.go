// internal/utils/utils_test.go
package utils

import (
	"os"
	"testing"
)

func TestEncryptDecryptGiftCard(t *testing.T) {
	// Set a valid encryption key (32 bytes, 64 hex characters).
	validKey := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	os.Setenv("GIFT_CARD_ENCRYPTION_KEY", validKey)

	plaintext := "Hello, world!"
	encrypted, err := EncryptGiftCard(plaintext)
	if err != nil {
		t.Fatalf("EncryptGiftCard returned error: %v", err)
	}
	if encrypted == "" {
		t.Fatal("EncryptGiftCard returned an empty string")
	}

	decrypted, err := DecryptGiftCard(encrypted)
	if err != nil {
		t.Fatalf("DecryptGiftCard returned error: %v", err)
	}
	if decrypted != plaintext {
		t.Errorf("Expected decrypted text to be %q, got %q", plaintext, decrypted)
	}
}

func TestEncryptGiftCardWithoutKey(t *testing.T) {
	// Unset the encryption key.
	os.Unsetenv("GIFT_CARD_ENCRYPTION_KEY")
	_, err := EncryptGiftCard("test")
	if err == nil {
		t.Error("Expected error when encryption key is not set")
	}
}

func TestEncryptionKeyValidation(t *testing.T) {
	// Set an invalid encryption key (wrong length).
	os.Setenv("GIFT_CARD_ENCRYPTION_KEY", "deadbeef")
	_, err := EncryptGiftCard("test")
	if err == nil {
		t.Error("Expected error due to invalid encryption key length")
	}
}

func TestDecryptGiftCardInvalidFormat(t *testing.T) {
	// Set a valid encryption key.
	validKey := "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	os.Setenv("GIFT_CARD_ENCRYPTION_KEY", validKey)

	// Input without the ':' separator should be invalid.
	_, err := DecryptGiftCard("invaliddata")
	if err == nil {
		t.Error("Expected error for invalid encrypted string format")
	}
}

func TestGenerateGiftCardCode(t *testing.T) {
	// Test valid gift card code generation.
	code, err := GenerateGiftCardCode(16, "PRE", "POST")
	if err != nil {
		t.Fatalf("GenerateGiftCardCode returned error: %v", err)
	}
	if len(code) != 16 {
		t.Errorf("Expected code length of 16, got %d", len(code))
	}
	// Verify that the code starts with the prefix "PRE".
	if code[:len("PRE")] != "PRE" {
		t.Errorf("Expected prefix 'PRE', got %q", code[:len("PRE")])
	}
	// Verify that the code ends with the postfix "POST".
	if code[len(code)-len("POST"):] != "POST" {
		t.Errorf("Expected postfix 'POST', got %q", code[len(code)-len("POST"):])
	}

	// Test that a length less than 8 returns an error.
	_, err = GenerateGiftCardCode(7, "", "")
	if err == nil {
		t.Error("Expected error for code length less than 8")
	}

	// Test that a length greater than 20 returns an error.
	_, err = GenerateGiftCardCode(21, "", "")
	if err == nil {
		t.Error("Expected error for code length greater than 20")
	}

	// Test when the combined prefix and postfix length equals the total length.
	// "FOUR" is 4 characters, so 4+4 equals 8, leaving 0 for the random part.
	_, err = GenerateGiftCardCode(8, "FOUR", "FOUR")
	if err == nil {
		t.Error("Expected error when combined prefix and postfix equal total code length")
	}
}
