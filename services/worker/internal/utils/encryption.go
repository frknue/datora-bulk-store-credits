package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// EncryptGiftCard encrypts the plaintext string using AES-256-CBC.
// It returns a string in the format "iv:ciphertext", where both parts are hex-encoded.
func EncryptGiftCard(plaintext string) (string, error) {
	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("error creating cipher: %v", err)
	}

	iv := make([]byte, aes.BlockSize) // AES block size is 16 bytes.
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("error generating IV: %v", err)
	}

	// Pad the plaintext to a multiple of the block size.
	paddedData := pkcs7Pad([]byte(plaintext), aes.BlockSize)

	ciphertext := make([]byte, len(paddedData))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, paddedData)

	// Return the IV and ciphertext as hex strings separated by a colon.
	return fmt.Sprintf("%s:%s", hex.EncodeToString(iv), hex.EncodeToString(ciphertext)), nil
}

// DecryptGiftCard decrypts the given encrypted string (formatted as "iv:ciphertext")
// and returns the original plaintext.
func DecryptGiftCard(encryptedText string) (string, error) {
	parts := splitAtFirstColon(encryptedText)
	if len(parts) < 2 {
		return "", errors.New("invalid input string. It must contain an IV and encrypted data")
	}

	iv, err := hex.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("error decoding IV: %v", err)
	}
	if len(iv) != aes.BlockSize {
		return "", fmt.Errorf("invalid IV length: %d", len(iv))
	}

	ciphertext, err := hex.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("error decoding ciphertext: %v", err)
	}

	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("error creating cipher: %v", err)
	}

	if len(ciphertext)%aes.BlockSize != 0 {
		return "", errors.New("ciphertext is not a multiple of the block size")
	}

	mode := cipher.NewCBCDecrypter(block, iv)
	plaintextPadded := make([]byte, len(ciphertext))
	mode.CryptBlocks(plaintextPadded, ciphertext)

	plaintext, err := pkcs7Unpad(plaintextPadded)
	if err != nil {
		return "", fmt.Errorf("error unpadding plaintext: %v", err)
	}

	return string(plaintext), nil
}
