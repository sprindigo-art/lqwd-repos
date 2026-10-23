package l402

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

const testSigningKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func testService(t *testing.T) *Service {
	t.Helper()
	svc, err := NewService(testSigningKeyHex)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func TestMintAndVerify(t *testing.T) {
	svc := testService(t)
	expires := time.Now().Add(1 * time.Hour)

	mac, err := svc.MintMacaroon("deadbeef", "/v1/l402/node-stats", "GET", expires)
	if err != nil {
		t.Fatalf("MintMacaroon: %v", err)
	}
	if mac == "" {
		t.Fatal("empty macaroon")
	}

	result, err := svc.VerifyMacaroon(mac)
	if err != nil {
		t.Fatalf("VerifyMacaroon: %v", err)
	}

	if result.PaymentHash != "deadbeef" {
		t.Errorf("expected payment_hash deadbeef, got %s", result.PaymentHash)
	}
	if result.Endpoint != "/v1/l402/node-stats" {
		t.Errorf("expected endpoint /v1/l402/node-stats, got %s", result.Endpoint)
	}
	if result.Method != "GET" {
		t.Errorf("expected method GET, got %s", result.Method)
	}
}

func TestVerifyWrongKey(t *testing.T) {
	svc := testService(t)
	expires := time.Now().Add(1 * time.Hour)
	mac, _ := svc.MintMacaroon("deadbeef", "/test", "GET", expires)

	// Verify with a different key
	svc2, _ := NewService("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
	_, err := svc2.VerifyMacaroon(mac)
	if err == nil {
		t.Fatal("expected verification failure with wrong key")
	}
}

func TestVerifyInvalidBase64(t *testing.T) {
	svc := testService(t)
	_, err := svc.VerifyMacaroon("not-valid-base64!!!")
	if err == nil {
		t.Fatal("expected error for invalid base64")
	}
}

func TestVerifyPreimage(t *testing.T) {
	// Create a known preimage/hash pair
	preimage := []byte("test-preimage-32-bytes-long!!!!!")
	hash := sha256.Sum256(preimage)
	preimageHex := hex.EncodeToString(preimage)
	hashHex := hex.EncodeToString(hash[:])

	if !VerifyPreimage(preimageHex, hashHex) {
		t.Error("valid preimage should verify")
	}
}

func TestVerifyPreimageWrong(t *testing.T) {
	if VerifyPreimage("0000000000000000000000000000000000000000000000000000000000000000", "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") {
		t.Error("wrong preimage should not verify")
	}
}

func TestVerifyPreimageInvalidHex(t *testing.T) {
	if VerifyPreimage("not-hex", "also-not-hex") {
		t.Error("invalid hex should not verify")
	}
}

func TestNewServiceInvalidKey(t *testing.T) {
	_, err := NewService("short")
	if err == nil {
		t.Fatal("expected error for short key")
	}

	_, err = NewService("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")
	if err == nil {
		t.Fatal("expected error for non-hex key")
	}
}
