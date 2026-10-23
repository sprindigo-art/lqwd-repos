package lnd

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

// macaroonCredential implements grpc.PerRPCCredentials for LND macaroon auth.
// This avoids importing github.com/lightningnetwork/lnd/macaroons.
type macaroonCredential struct {
	macaroonHex string
}

func (m macaroonCredential) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	return map[string]string{"macaroon": m.macaroonHex}, nil
}

func (m macaroonCredential) RequireTransportSecurity() bool { return true }

// Verify interface compliance at compile time.
var _ credentials.PerRPCCredentials = macaroonCredential{}

// MacaroonNames holds the filenames of each scoped macaroon.
type MacaroonNames struct {
	Readonly     string
	Invoice      string
	ChannelAdmin string
	Pay          string
}

// MacaroonSet holds pre-loaded macaroon call options for each permission scope.
type MacaroonSet struct {
	Readonly     grpc.CallOption
	Invoice      grpc.CallOption
	ChannelAdmin grpc.CallOption
	Pay          grpc.CallOption
}

// LoadMacaroons reads macaroon files from the given directory and returns
// a MacaroonSet with each scope pre-loaded as a gRPC call option.
func LoadMacaroons(dir string, names MacaroonNames) (*MacaroonSet, error) {
	load := func(name string) (grpc.CallOption, error) {
		path := filepath.Join(dir, name)
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read macaroon %s: %w", path, err)
		}
		hexStr := hex.EncodeToString(raw)
		cred := macaroonCredential{macaroonHex: hexStr}
		return grpc.PerRPCCredentials(cred), nil
	}

	ro, err := load(names.Readonly)
	if err != nil {
		return nil, err
	}
	inv, err := load(names.Invoice)
	if err != nil {
		return nil, err
	}
	ch, err := load(names.ChannelAdmin)
	if err != nil {
		return nil, err
	}
	pay, err := load(names.Pay)
	if err != nil {
		return nil, err
	}

	return &MacaroonSet{
		Readonly:     ro,
		Invoice:      inv,
		ChannelAdmin: ch,
		Pay:          pay,
	}, nil
}
