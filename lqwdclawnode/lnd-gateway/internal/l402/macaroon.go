package l402

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	macaroon "gopkg.in/macaroon.v2"
)

// Service represents the L402 service issuing tokens.
type Service struct {
	signingKey []byte // 32-byte HMAC signing key
}

// NewService creates a new L402 service with the given hex-encoded signing key.
func NewService(signingKeyHex string) (*Service, error) {
	key, err := hex.DecodeString(signingKeyHex)
	if err != nil {
		return nil, fmt.Errorf("decode L402 signing key: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("L402 signing key must be 32 bytes, got %d", len(key))
	}
	return &Service{signingKey: key}, nil
}

// MintMacaroon creates a new L402 macaroon with the specified caveats.
func (s *Service) MintMacaroon(paymentHash, endpoint, method string, expiresAt time.Time) (string, error) {
	// Create macaroon with signing key as root key, payment_hash as ID
	m, err := macaroon.New(s.signingKey, []byte(paymentHash), "lqwd-l402", macaroon.LatestVersion)
	if err != nil {
		return "", fmt.Errorf("create macaroon: %w", err)
	}

	// Add first-party caveats
	caveats := []string{
		"payment_hash:" + paymentHash,
		"expires_at:" + strconv.FormatInt(expiresAt.Unix(), 10),
		"endpoint:" + endpoint,
		"method:" + method,
	}
	for _, c := range caveats {
		if err := m.AddFirstPartyCaveat([]byte(c)); err != nil {
			return "", fmt.Errorf("add caveat %q: %w", c, err)
		}
	}

	// Serialize and base64 encode
	raw, err := m.MarshalBinary()
	if err != nil {
		return "", fmt.Errorf("serialize macaroon: %w", err)
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// VerifyResult holds the verified caveat data from a macaroon.
type VerifyResult struct {
	PaymentHash string
	ExpiresAt   time.Time
	Endpoint    string
	Method      string
}

// VerifyMacaroon verifies a base64-encoded macaroon and extracts its caveats.
// Does NOT verify the preimage — that's the caller's responsibility.
func (s *Service) VerifyMacaroon(macaroonB64 string) (*VerifyResult, error) {
	raw, err := base64.StdEncoding.DecodeString(macaroonB64)
	if err != nil {
		return nil, fmt.Errorf("decode macaroon base64: %w", err)
	}

	var m macaroon.Macaroon
	if err := m.UnmarshalBinary(raw); err != nil {
		return nil, fmt.Errorf("unmarshal macaroon: %w", err)
	}

	// Verify HMAC signature — collect caveats via checker
	result := &VerifyResult{}
	checker := func(caveat string) error {
		parts := strings.SplitN(caveat, ":", 2)
		if len(parts) != 2 {
			return fmt.Errorf("invalid caveat format: %s", caveat)
		}
		key, val := parts[0], parts[1]
		switch key {
		case "payment_hash":
			result.PaymentHash = val
		case "expires_at":
			ts, err := strconv.ParseInt(val, 10, 64)
			if err != nil {
				return fmt.Errorf("invalid expires_at: %w", err)
			}
			result.ExpiresAt = time.Unix(ts, 0)
		case "endpoint":
			result.Endpoint = val
		case "method":
			result.Method = val
		default:
			return fmt.Errorf("unknown caveat: %s", key)
		}
		return nil
	}

	// Verify with the signing key
	if err := m.Verify(s.signingKey, checker, nil); err != nil {
		return nil, fmt.Errorf("macaroon verification failed: %w", err)
	}

	// Validate required fields
	if result.PaymentHash == "" {
		return nil, fmt.Errorf("macaroon missing payment_hash caveat")
	}
	if result.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("macaroon missing expires_at caveat")
	}
	if result.Endpoint == "" {
		return nil, fmt.Errorf("macaroon missing endpoint caveat")
	}

	return result, nil
}

// VerifyPreimage checks that SHA256(preimage) == paymentHash using constant-time comparison.
func VerifyPreimage(preimageHex, paymentHashHex string) bool {
	preimage, err := hex.DecodeString(preimageHex)
	if err != nil {
		return false
	}
	expectedHash, err := hex.DecodeString(paymentHashHex)
	if err != nil {
		return false
	}
	hash := sha256.Sum256(preimage)
	return hmac.Equal(hash[:], expectedHash)
}
