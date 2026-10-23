package lnd

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMacaroons_Success(t *testing.T) {
	dir := t.TempDir()

	// Write fake macaroon files with known bytes
	names := MacaroonNames{
		Readonly:     "readonly.macaroon",
		Invoice:      "invoice.macaroon",
		ChannelAdmin: "channeladmin.macaroon",
		Pay:          "pay.macaroon",
	}

	for _, name := range []string{names.Readonly, names.Invoice, names.ChannelAdmin, names.Pay} {
		data := []byte("fake-macaroon-" + name)
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	ms, err := LoadMacaroons(dir, names)
	if err != nil {
		t.Fatalf("LoadMacaroons: %v", err)
	}

	if ms.Readonly == nil || ms.Invoice == nil || ms.ChannelAdmin == nil || ms.Pay == nil {
		t.Fatal("expected all macaroon call options to be non-nil")
	}
}

func TestLoadMacaroons_MissingFile(t *testing.T) {
	dir := t.TempDir()

	names := MacaroonNames{
		Readonly:     "readonly.macaroon",
		Invoice:      "invoice.macaroon",
		ChannelAdmin: "channeladmin.macaroon",
		Pay:          "pay.macaroon",
	}

	_, err := LoadMacaroons(dir, names)
	if err == nil {
		t.Fatal("expected error for missing macaroon file")
	}
}

func TestMacaroonCredential_GetRequestMetadata(t *testing.T) {
	raw := []byte{0xde, 0xad, 0xbe, 0xef}
	hexStr := hex.EncodeToString(raw)
	cred := macaroonCredential{macaroonHex: hexStr}

	meta, err := cred.GetRequestMetadata(nil)
	if err != nil {
		t.Fatalf("GetRequestMetadata: %v", err)
	}

	if meta["macaroon"] != hexStr {
		t.Fatalf("expected macaroon=%s, got %s", hexStr, meta["macaroon"])
	}
}

func TestMacaroonCredential_RequiresTransportSecurity(t *testing.T) {
	cred := macaroonCredential{macaroonHex: "aabb"}
	if !cred.RequireTransportSecurity() {
		t.Fatal("expected RequireTransportSecurity=true")
	}
}
