// Command lnurlpd serves LNURL-pay for the lnd on this appliance.
//
// It implements LUD-06 (payRequest), LUD-16 (lightning address), LUD-12
// (comments) and LUD-21 (verify), and nothing else. It has no dependencies
// outside the standard library.
//
// Where it sits:
//
//	customer's wallet ---> https://pay.example.com  (the gateway, public)
//	                            |
//	                            |  reverse proxy, over the tunnel the
//	                            |  appliance dialled OUT to
//	                            v
//	                       lnurlpd on tun0  --->  lnd REST on loopback
//
// The appliance accepts no inbound connections from the internet, so it cannot
// host a public URL itself. The gateway owns the name and the certificate and
// proxies to this daemon over the management VPN; the callback URL this daemon
// advertises is therefore the PUBLIC one, not its own address.
//
// The credential it holds is lnd's invoice macaroon. It can create invoices
// and read them back. It cannot spend, and it is the only part of the
// appliance that anything outside ever reaches.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// version is overwritten at build time by scripts/42-build-lnurlpd.sh.
var version = "dev"

type config struct {
	listen         string
	baseURL        string
	name           string
	description    string
	lndREST        string
	lndCert        string
	lndMacaroon    string
	minSat         int64
	maxSat         int64
	commentLength  int
	invoiceExpiry  time.Duration
	privateHints   bool
	invoicesPerMin int
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envOrInt(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

func main() {
	cfg := config{}
	printLNURL := flag.Bool("print-lnurl", false,
		"print the lightning address and bech32 LNURL for a QR code, then exit")
	showVersion := flag.Bool("version", false, "print the version and exit")

	flag.StringVar(&cfg.listen, "listen", envOr("LNURLPD_LISTEN", "127.0.0.1:8090"),
		"address to listen on; bind the VPN address, never 0.0.0.0")
	flag.StringVar(&cfg.baseURL, "base-url", envOr("LNURLPD_BASE_URL", ""),
		"public base URL the gateway serves this merchant on, e.g. https://pay.example.com")
	flag.StringVar(&cfg.name, "name", envOr("LNURLPD_NAME", "merchant"),
		"the username half of the lightning address")
	flag.StringVar(&cfg.description, "description", envOr("LNURLPD_DESCRIPTION", ""),
		"payer-visible description; defaults to \"Pay <name>@<host>\"")
	flag.StringVar(&cfg.lndREST, "lnd-rest", envOr("LNURLPD_LND_REST", "https://127.0.0.1:8080"),
		"lnd REST endpoint")
	flag.StringVar(&cfg.lndCert, "lnd-tls-cert", envOr("LNURLPD_LND_TLS_CERT", "/data/lnd/tls.cert"),
		"lnd TLS certificate, pinned as the only root")
	flag.StringVar(&cfg.lndMacaroon, "lnd-macaroon", envOr("LNURLPD_LND_MACAROON", ""),
		"path to lnd's INVOICE macaroon (required)")
	flag.Int64Var(&cfg.minSat, "min-sat", envOrInt("LNURLPD_MIN_SAT", 1),
		"smallest payment accepted, in satoshis")
	flag.Int64Var(&cfg.maxSat, "max-sat", envOrInt("LNURLPD_MAX_SAT", 1000000),
		"largest payment accepted, in satoshis")
	flag.IntVar(&cfg.commentLength, "comment-length",
		int(envOrInt("LNURLPD_COMMENT_LENGTH", 140)),
		"LUD-12 comment length; 0 disables comments")
	flag.DurationVar(&cfg.invoiceExpiry, "invoice-expiry", 10*time.Minute,
		"how long an issued invoice stays payable")
	flag.BoolVar(&cfg.privateHints, "private-hints", true,
		"ask lnd for route hints; required while the channel is unannounced")
	flag.IntVar(&cfg.invoicesPerMin, "invoices-per-minute",
		int(envOrInt("LNURLPD_INVOICES_PER_MINUTE", 60)),
		"cap on invoices minted per minute; 0 disables the limit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("lnurlpd %s\n", version)
		return
	}

	if err := run(cfg, *printLNURL); err != nil {
		log.Fatalf("lnurlpd: %v", err)
	}
}

func run(cfg config, printOnly bool) error {
	if cfg.baseURL == "" {
		return errors.New("-base-url is required: it is the PUBLIC URL the " +
			"gateway proxies to this daemon, and it is what wallets call back to")
	}

	base, err := url.Parse(strings.TrimSuffix(cfg.baseURL, "/"))
	if err != nil {
		return fmt.Errorf("-base-url: %w", err)
	}
	if base.Scheme != "https" && base.Hostname() != "127.0.0.1" &&
		base.Hostname() != "localhost" {

		return errors.New("-base-url must be https: wallets refuse anything else")
	}
	if cfg.minSat < 1 || cfg.maxSat < cfg.minSat {
		return errors.New("-min-sat/-max-sat: need 1 <= min <= max")
	}

	address := cfg.name + "@" + base.Host
	lnurlURL := fmt.Sprintf("%s/.well-known/lnurlp/%s", base.String(), cfg.name)
	encoded, err := encodeLNURL(lnurlURL)
	if err != nil {
		return fmt.Errorf("encoding lnurl: %w", err)
	}

	if printOnly {
		fmt.Printf("lightning address: %s\n", address)
		fmt.Printf("lnurl-pay URL:     %s\n", lnurlURL)
		fmt.Printf("LNURL (QR):        %s\n", encoded)
		return nil
	}

	if cfg.lndMacaroon == "" {
		return errors.New("-lnd-macaroon is required; point it at lnd's " +
			"invoice.macaroon, not admin.macaroon")
	}

	description := cfg.description
	if description == "" {
		description = "Pay " + address
	}
	meta, err := metadata(cfg.name, base.Host, description)
	if err != nil {
		return fmt.Errorf("building metadata: %w", err)
	}

	lnd, err := newLNDClient(cfg.lndREST, cfg.lndCert, cfg.lndMacaroon)
	if err != nil {
		return err
	}

	srv := &server{
		cfg:      cfg,
		lnd:      lnd,
		base:     base.String(),
		metadata: meta,
		limiter:  newLimiter(cfg.invoicesPerMin, time.Minute),
	}

	httpSrv := &http.Server{
		Addr:              cfg.listen,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 << 10,
	}

	log.Printf("lnurlpd %s listening on %s", version, cfg.listen)
	log.Printf("lightning address %s -> %s", address, lnurlURL)
	log.Printf("lnd %s, macaroon %s", cfg.lndREST, cfg.lndMacaroon)
	log.Printf("accepting %d-%d sat", cfg.minSat, cfg.maxSat)

	// SIGTERM is what the init script sends. Shut down in an orderly way so a
	// wallet mid-callback gets an answer rather than a reset connection.
	idle := make(chan struct{})
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(ctx); err != nil {
			log.Printf("shutdown: %v", err)
		}
		close(idle)
	}()

	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-idle
	log.Printf("stopped")

	return nil
}

type server struct {
	cfg      config
	lnd      *lndClient
	base     string
	metadata string
	limiter  *limiter
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	// LUD-16 (a lightning address) and LUD-06 (a scanned LNURL) resolve to
	// the same document by different routes.
	mux.HandleFunc("GET /.well-known/lnurlp/{name}", s.handlePayRequest)
	mux.HandleFunc("GET /lnurlp/{name}", s.handlePayRequest)
	mux.HandleFunc("GET /lnurlp/{name}/callback", s.handleCallback)
	mux.HandleFunc("GET /lnurlp/{name}/verify/{hash}", s.handleVerify)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintln(w, "ok")
	})

	return logRequests(mux)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)

		query := ""
		if r.URL.RawQuery != "" {
			query = "?" + r.URL.RawQuery
		}
		log.Printf("%s %s%s (%s)", r.Method, r.URL.Path, query,
			time.Since(start).Round(time.Millisecond))
	})
}

// writeJSON answers with 200 and a JSON body. LUD-06 failures are 200 as well
// - see errResponse.
func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	// Wallets embedded in browsers fetch these endpoints directly.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("writing response: %v", err)
	}
}

func writeErr(w http.ResponseWriter, format string, args ...interface{}) {
	reason := fmt.Sprintf(format, args...)
	log.Printf("rejected: %s", reason)
	writeJSON(w, errResponse{Status: "ERROR", Reason: reason})
}

// checkName rejects a request for a merchant this daemon does not serve. One
// appliance is one merchant, so this is an equality check, not a lookup.
func (s *server) checkName(w http.ResponseWriter, r *http.Request) bool {
	if r.PathValue("name") != s.cfg.name {
		writeErr(w, "unknown recipient")
		return false
	}

	return true
}

func (s *server) handlePayRequest(w http.ResponseWriter, r *http.Request) {
	if !s.checkName(w, r) {
		return
	}

	writeJSON(w, payRequest{
		Tag:            "payRequest",
		Callback:       fmt.Sprintf("%s/lnurlp/%s/callback", s.base, s.cfg.name),
		MinSendable:    s.cfg.minSat * 1000,
		MaxSendable:    s.cfg.maxSat * 1000,
		Metadata:       s.metadata,
		CommentAllowed: s.cfg.commentLength,
	})
}

func (s *server) handleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.checkName(w, r) {
		return
	}

	raw := r.URL.Query().Get("amount")
	if raw == "" {
		writeErr(w, "amount is required, in millisatoshis")
		return
	}
	amountMsat, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeErr(w, "amount must be an integer number of millisatoshis")
		return
	}
	if amountMsat < s.cfg.minSat*1000 || amountMsat > s.cfg.maxSat*1000 {
		writeErr(w, "amount out of range: %d-%d sat", s.cfg.minSat, s.cfg.maxSat)
		return
	}

	comment := r.URL.Query().Get("comment")
	if len(comment) > s.cfg.commentLength {
		writeErr(w, "comment is longer than %d characters", s.cfg.commentLength)
		return
	}

	// The device is small and this endpoint is public through the gateway.
	// One global bucket, not per-IP: every request arrives from the proxy, so
	// per-IP counting would be counting the proxy.
	if !s.limiter.allow() {
		writeErr(w, "too many invoice requests, try again shortly")
		return
	}

	// The comment becomes the memo, which is for the merchant's own records.
	// lnd puts the description HASH in the payment request whenever one is
	// given, so a comment cannot change what the payer's wallet checks the
	// invoice against.
	inv, err := s.lnd.AddInvoice(r.Context(), amountMsat,
		descriptionHash(s.metadata), comment, s.cfg.invoiceExpiry,
		s.cfg.privateHints)
	if err != nil {
		log.Printf("addinvoice: %v", err)
		writeErr(w, "could not create an invoice")
		return
	}

	hash, err := inv.PaymentHashHex()
	if err != nil {
		log.Printf("payment hash: %v", err)
		writeErr(w, "could not create an invoice")
		return
	}

	log.Printf("issued invoice %s for %d msat", hash, amountMsat)

	writeJSON(w, payResponse{
		PR:     inv.PaymentRequest,
		Routes: []interface{}{},
		Verify: fmt.Sprintf("%s/lnurlp/%s/verify/%s", s.base, s.cfg.name, hash),
	})
}

// handleVerify is LUD-21. It answers "did this invoice settle" to anyone
// holding the payment hash, which is how the payer - or our own gateway -
// confirms a payment without holding a credential on this node.
func (s *server) handleVerify(w http.ResponseWriter, r *http.Request) {
	if !s.checkName(w, r) {
		return
	}

	inv, err := s.lnd.LookupInvoice(r.Context(), r.PathValue("hash"))
	if err != nil {
		log.Printf("lookupinvoice: %v", err)
		writeErr(w, "unknown invoice")
		return
	}

	writeJSON(w, verifyResponse{
		Status:   "OK",
		Settled:  inv.Settled(),
		Preimage: inv.PreimageHex(),
		PR:       inv.PaymentRequest,
	})
}

// limiter is a fixed-window counter rather than a token bucket: the window is
// a minute and the point is only to stop a runaway caller filling lnd's
// invoice database, so the extra precision would buy nothing.
type limiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	count    int
	windowAt time.Time
}

func newLimiter(limit int, window time.Duration) *limiter {
	return &limiter{limit: limit, window: window, windowAt: time.Now()}
}

func (l *limiter) allow() bool {
	if l.limit <= 0 {
		return true
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if time.Since(l.windowAt) >= l.window {
		l.windowAt = time.Now()
		l.count = 0
	}
	if l.count >= l.limit {
		return false
	}
	l.count++

	return true
}
