package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The vector from LUD-01. If this drifts, every QR this daemon prints is
// wrong, and nothing else in the test suite would notice.
func TestEncodeLNURL(t *testing.T) {
	const (
		url  = "https://service.com/api?q=3fc3645b439ce8e7f2553a69e5267081d96dcd340693afabe04be7b0ccd178df"
		want = "LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS"
	)

	got, err := encodeLNURL(url)
	if err != nil {
		t.Fatalf("encodeLNURL: %v", err)
	}
	if got != want {
		t.Errorf("encodeLNURL:\n got %s\nwant %s", got, want)
	}
}

func TestMetadataAndDescriptionHash(t *testing.T) {
	meta, err := metadata("merchant", "pay.example.com", "Pay merchant@pay.example.com")
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}

	// The wallet hashes this exact string and compares it with the invoice's
	// h tag, so the shape of it is part of the protocol, not a detail.
	const want = `[["text/plain","Pay merchant@pay.example.com"],` +
		`["text/identifier","merchant@pay.example.com"]]`
	if meta != want {
		t.Errorf("metadata:\n got %s\nwant %s", meta, want)
	}

	sum := sha256.Sum256([]byte(want))
	if got := descriptionHash(meta); hex.EncodeToString(got) != hex.EncodeToString(sum[:]) {
		t.Errorf("descriptionHash = %x, want %x", got, sum)
	}
}

// fakeLND stands in for lnd's REST interface. It records what it was asked
// for, so the test can assert on the request as well as the response.
type fakeLND struct {
	t          *testing.T
	lastAdd    map[string]interface{}
	lastMac    string
	settled    bool
	failInvoice bool
}

func (f *fakeLND) handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /v1/invoices", func(w http.ResponseWriter, r *http.Request) {
		f.lastMac = r.Header.Get("Grpc-Metadata-macaroon")
		f.lastAdd = map[string]interface{}{}
		if err := json.NewDecoder(r.Body).Decode(&f.lastAdd); err != nil {
			f.t.Fatalf("decoding addinvoice request: %v", err)
		}
		if f.failInvoice {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"wallet locked","code":2}`))
			return
		}

		hash := sha256.Sum256([]byte("payment hash"))
		_ = json.NewEncoder(w).Encode(map[string]string{
			"r_hash":          base64.StdEncoding.EncodeToString(hash[:]),
			"payment_request": "lnbcrt10u1testinvoice",
		})
	})

	mux.HandleFunc("GET /v1/invoice/{hash}", func(w http.ResponseWriter, r *http.Request) {
		// lnd returns the preimage whatever the state: it generated it,
		// so it knows it before anyone has paid. The fake does the same,
		// because a fake that helpfully zeroed it would hide exactly the
		// bug that matters here.
		state, preimage := "OPEN", []byte(strings.Repeat("a", 32))
		if f.settled {
			state = "SETTLED"
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"r_preimage":      base64.StdEncoding.EncodeToString(preimage),
			"state":           state,
			"payment_request": "lnbcrt10u1testinvoice",
		})
	})

	return mux
}

// newTestServer wires a server against a fake lnd over real TLS, with the
// fake's certificate pinned exactly the way the daemon pins lnd's.
func newTestServer(t *testing.T, fake *fakeLND) *server {
	t.Helper()

	backend := httptest.NewTLSServer(fake.handler())
	t.Cleanup(backend.Close)

	dir := t.TempDir()
	certPath := filepath.Join(dir, "tls.cert")
	certPEM := pem.EncodeToMemory(&pem.Block{
		Type: "CERTIFICATE", Bytes: backend.Certificate().Raw,
	})
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("writing cert: %v", err)
	}

	macPath := filepath.Join(dir, "invoice.macaroon")
	if err := os.WriteFile(macPath, []byte{0xde, 0xad, 0xbe, 0xef}, 0o600); err != nil {
		t.Fatalf("writing macaroon: %v", err)
	}

	lnd, err := newLNDClient(backend.URL, certPath, macPath)
	if err != nil {
		t.Fatalf("newLNDClient: %v", err)
	}

	cfg := config{
		name:           "merchant",
		minSat:         1,
		maxSat:         1000,
		commentLength:  20,
		invoiceExpiry:  10 * time.Minute,
		privateHints:   true,
		invoicesPerMin: 60,
	}
	meta, err := metadata(cfg.name, "pay.example.com", "Pay merchant")
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}

	return &server{
		cfg:      cfg,
		lnd:      lnd,
		base:     "https://pay.example.com",
		metadata: meta,
		limiter:  newLimiter(cfg.invoicesPerMin, time.Minute),
	}
}

func get(t *testing.T, s *server, path string) map[string]interface{} {
	t.Helper()

	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("%s: HTTP %d, want 200 - LNURL errors are 200 with a status field",
			path, rec.Code)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s: decoding %q: %v", path, rec.Body.String(), err)
	}

	return out
}

func TestPayRequest(t *testing.T) {
	s := newTestServer(t, &fakeLND{t: t})

	// Both routes must answer identically: a lightning address and a scanned
	// LNURL are two ways to the same document.
	for _, path := range []string{
		"/.well-known/lnurlp/merchant",
		"/lnurlp/merchant",
	} {
		out := get(t, s, path)

		if out["tag"] != "payRequest" {
			t.Errorf("%s: tag = %v, want payRequest", path, out["tag"])
		}
		if want := "https://pay.example.com/lnurlp/merchant/callback"; out["callback"] != want {
			t.Errorf("%s: callback = %v, want %s", path, out["callback"], want)
		}
		if out["minSendable"] != float64(1000) {
			t.Errorf("%s: minSendable = %v, want 1000 msat", path, out["minSendable"])
		}
		if out["maxSendable"] != float64(1000000) {
			t.Errorf("%s: maxSendable = %v, want 1000000 msat", path, out["maxSendable"])
		}
		if out["metadata"] != s.metadata {
			t.Errorf("%s: metadata = %v, want %s", path, out["metadata"], s.metadata)
		}
	}
}

func TestPayRequestUnknownRecipient(t *testing.T) {
	s := newTestServer(t, &fakeLND{t: t})

	out := get(t, s, "/.well-known/lnurlp/someone-else")
	if out["status"] != "ERROR" {
		t.Errorf("status = %v, want ERROR", out["status"])
	}
}

func TestCallbackIssuesAnInvoice(t *testing.T) {
	fake := &fakeLND{t: t}
	s := newTestServer(t, fake)

	out := get(t, s, "/lnurlp/merchant/callback?amount=50000&comment=table+4")

	if out["pr"] != "lnbcrt10u1testinvoice" {
		t.Errorf("pr = %v, want the invoice from lnd", out["pr"])
	}
	if _, ok := out["verify"].(string); !ok {
		t.Errorf("no verify URL in the response: %v", out)
	}

	// The description hash is what binds the invoice to the metadata the
	// wallet already fetched. If this is wrong the payment still works, and
	// the wallet is right to refuse it.
	wantHash := base64.StdEncoding.EncodeToString(descriptionHash(s.metadata))
	if got := fake.lastAdd["description_hash"]; got != wantHash {
		t.Errorf("description_hash = %v, want %v", got, wantHash)
	}
	if got := fake.lastAdd["value_msat"]; got != "50000" {
		t.Errorf("value_msat = %v, want 50000", got)
	}
	if got := fake.lastAdd["memo"]; got != "table 4" {
		t.Errorf("memo = %v, want the comment", got)
	}
	// The appliance's channel is unannounced; without route hints nothing
	// can reach it.
	if got := fake.lastAdd["private"]; got != true {
		t.Errorf("private = %v, want true", got)
	}
	if fake.lastMac != "deadbeef" {
		t.Errorf("macaroon header = %q, want the hex-encoded macaroon", fake.lastMac)
	}
}

func TestCallbackRejects(t *testing.T) {
	s := newTestServer(t, &fakeLND{t: t})

	cases := map[string]string{
		"no amount":       "/lnurlp/merchant/callback",
		"amount not a number": "/lnurlp/merchant/callback?amount=lots",
		"below minimum":   "/lnurlp/merchant/callback?amount=999",
		"above maximum":   "/lnurlp/merchant/callback?amount=1000001",
		"comment too long": "/lnurlp/merchant/callback?amount=50000&comment=" +
			strings.Repeat("x", 21),
	}

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			out := get(t, s, path)
			if out["status"] != "ERROR" {
				t.Errorf("status = %v, want ERROR (got %v)", out["status"], out)
			}
			if _, ok := out["pr"]; ok {
				t.Errorf("an invoice was issued anyway: %v", out)
			}
		})
	}
}

func TestCallbackReportsLNDFailure(t *testing.T) {
	fake := &fakeLND{t: t, failInvoice: true}
	s := newTestServer(t, fake)

	out := get(t, s, "/lnurlp/merchant/callback?amount=50000")
	if out["status"] != "ERROR" {
		t.Errorf("status = %v, want ERROR when lnd refuses", out["status"])
	}
}

func TestVerify(t *testing.T) {
	fake := &fakeLND{t: t}
	s := newTestServer(t, fake)

	hash := hex.EncodeToString(make([]byte, 32))

	out := get(t, s, "/lnurlp/merchant/verify/"+hash)
	if out["settled"] != false {
		t.Errorf("settled = %v, want false before payment", out["settled"])
	}
	// lnd knows the preimage from the moment it creates the invoice.
	// Publishing it before settlement would hand out the proof of a payment
	// nobody has made.
	if out["preimage"] != nil && out["preimage"] != "" {
		t.Errorf("preimage = %v, want none before payment", out["preimage"])
	}

	fake.settled = true
	out = get(t, s, "/lnurlp/merchant/verify/"+hash)
	if out["settled"] != true {
		t.Errorf("settled = %v, want true after payment", out["settled"])
	}
	if out["preimage"] == "" || out["preimage"] == nil {
		t.Errorf("no preimage after settlement: %v", out)
	}
}

func TestLimiter(t *testing.T) {
	l := newLimiter(2, time.Minute)

	if !l.allow() || !l.allow() {
		t.Fatal("the first two requests should be allowed")
	}
	if l.allow() {
		t.Error("the third request should be refused")
	}

	// A new window lets it through again.
	l.windowAt = time.Now().Add(-2 * time.Minute)
	if !l.allow() {
		t.Error("the window did not reset")
	}

	if !newLimiter(0, time.Minute).allow() {
		t.Error("a limit of 0 should disable the limiter")
	}
}
