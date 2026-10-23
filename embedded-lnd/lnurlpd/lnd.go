package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// lndClient talks to lnd's REST interface on loopback.
//
// REST rather than gRPC on purpose: it keeps this daemon at zero dependencies
// - no protobuf, no generated stubs, nothing to regenerate when lnd's protos
// move - and the two calls it makes are the whole of its business with lnd.
//
// The credential is lnd's INVOICE macaroon, not the admin one. The most this
// process can do, if it is taken over completely, is mint invoices and read
// them back. It cannot move money, which matters because it is the only thing
// in the appliance that anything outside ever reaches.
type lndClient struct {
	baseURL     string
	macaroonHex string
	http        *http.Client
}

func newLNDClient(baseURL, certPath, macaroonPath string) (*lndClient, error) {
	mac, err := os.ReadFile(macaroonPath)
	if err != nil {
		return nil, fmt.Errorf("reading macaroon: %w", err)
	}

	// lnd's TLS certificate is self-signed, so it is pinned here as the only
	// root. Skipping verification instead would leave nothing authenticating
	// the node this process hands its invoices to.
	pem, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("reading tls cert: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("no certificate found in %s", certPath)
	}

	return &lndClient{
		baseURL:     strings.TrimSuffix(baseURL, "/"),
		macaroonHex: hex.EncodeToString(mac),
		http: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					RootCAs:    pool,
					MinVersion: tls.VersionTLS12,
				},
			},
		},
	}, nil
}

// invoice is the subset of lnrpc.Invoice this daemon uses. REST renders int64
// as a JSON string and bytes as base64.
type invoice struct {
	RHash          string `json:"r_hash"`
	PaymentRequest string `json:"payment_request"`
	RPreimage      string `json:"r_preimage"`
	State          string `json:"state"`
	AmtPaidMsat    string `json:"amt_paid_msat"`
}

// PaymentHashHex returns the payment hash as hex, which is how it appears in
// a lookup URL.
func (i *invoice) PaymentHashHex() (string, error) {
	raw, err := base64.StdEncoding.DecodeString(i.RHash)
	if err != nil {
		return "", fmt.Errorf("decoding r_hash: %w", err)
	}

	return hex.EncodeToString(raw), nil
}

// PreimageHex returns the preimage as hex, and ONLY once the invoice has
// settled.
//
// lnd hands out the preimage of an invoice that has not been paid - it
// generated it, so it knows it. Passing that on would publish the proof of
// payment for a payment nobody has made, which is the one thing a verify
// endpoint must never do. It is gated on the state, not on the bytes.
func (i *invoice) PreimageHex() string {
	if !i.Settled() {
		return ""
	}

	raw, err := base64.StdEncoding.DecodeString(i.RPreimage)
	if err != nil {
		return ""
	}
	if len(raw) == 0 || bytes.Equal(raw, make([]byte, len(raw))) {
		return ""
	}

	return hex.EncodeToString(raw)
}

func (i *invoice) Settled() bool {
	return i.State == "SETTLED"
}

type addInvoiceRequest struct {
	Memo            string `json:"memo,omitempty"`
	ValueMsat       string `json:"value_msat"`
	DescriptionHash string `json:"description_hash"`
	Expiry          string `json:"expiry"`
	Private         bool   `json:"private"`
}

// AddInvoice creates a BOLT 11 invoice for amountMsat carrying descHash as its
// description hash, which is what LUD-06 requires: the hash commits the
// invoice to the metadata the wallet already fetched.
//
// private asks lnd to include route hints. The appliance's channel is
// unannounced, so without them a payer has no way to route to it.
func (c *lndClient) AddInvoice(ctx context.Context, amountMsat int64,
	descHash []byte, memo string, expiry time.Duration,
	private bool) (*invoice, error) {

	body, err := json.Marshal(addInvoiceRequest{
		Memo:            memo,
		ValueMsat:       strconv.FormatInt(amountMsat, 10),
		DescriptionHash: base64.StdEncoding.EncodeToString(descHash),
		Expiry:          strconv.FormatInt(int64(expiry.Seconds()), 10),
		Private:         private,
	})
	if err != nil {
		return nil, err
	}

	var inv invoice
	if err := c.do(ctx, http.MethodPost, "/v1/invoices", body, &inv); err != nil {
		return nil, err
	}
	if inv.PaymentRequest == "" {
		return nil, fmt.Errorf("lnd returned an invoice with no payment request")
	}

	return &inv, nil
}

// LookupInvoice fetches an invoice by payment hash. Used by the LUD-21 verify
// endpoint, and it is a read: the invoice macaroon grants it.
func (c *lndClient) LookupInvoice(ctx context.Context,
	paymentHashHex string) (*invoice, error) {

	if _, err := hex.DecodeString(paymentHashHex); err != nil {
		return nil, fmt.Errorf("payment hash is not hex")
	}

	var inv invoice
	err := c.do(ctx, http.MethodGet, "/v1/invoice/"+paymentHashHex, nil, &inv)
	if err != nil {
		return nil, err
	}

	return &inv, nil
}

// lndError is what lnd's REST gateway returns on failure.
type lndError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Code    int    `json:"code"`
}

func (c *lndClient) do(ctx context.Context, method, path string, body []byte,
	out interface{}) error {

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Grpc-Metadata-macaroon", c.macaroonHex)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("lnd request failed: %w", err)
	}
	defer resp.Body.Close()

	// Cap the read: a compromised or confused backend should not be able to
	// make this process allocate without limit.
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("reading lnd response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var lerr lndError
		if json.Unmarshal(raw, &lerr) == nil {
			msg := lerr.Error
			if msg == "" {
				msg = lerr.Message
			}
			if msg != "" {
				return fmt.Errorf("lnd: %s", msg)
			}
		}

		return fmt.Errorf("lnd returned HTTP %d", resp.StatusCode)
	}

	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decoding lnd response: %w", err)
	}

	return nil
}
