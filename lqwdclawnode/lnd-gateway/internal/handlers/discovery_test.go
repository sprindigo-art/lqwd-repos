package handlers

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// TestDiscovery_ResponseShape asserts the top-level keys external agent
// harnesses consume. Keys must stay stable — only add new ones, never
// rename or remove, and never without a deprecation window.
func TestDiscovery_ResponseShape(t *testing.T) {
	deps := newTestDeps(t)

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("missing data object: %v", body)
	}

	if data["service"] != "lqwdclaw-nodeops" {
		t.Errorf("service = %v, want lqwdclaw-nodeops", data["service"])
	}

	required := []string{
		"mcp_url", "registration_url",
		"docs_url", "channel_faucet", "example_curl",
		// Phase 22 DOC-01..04 additive v3.0 fields.
		"install_commands", "flow_order", "suggested_alias_rules", "discovery_version",
	}
	for _, k := range required {
		if _, present := data[k]; !present {
			t.Errorf("discovery response missing required key %q", k)
		}
	}

	// Regulatory scope (2026-04-21): L402 pay-per-call endpoints remain
	// operational but must NOT be advertised in the public catalog. If
	// this regression guard fires, someone re-added the key — remove it.
	if _, present := data["l402_endpoints"]; present {
		t.Errorf("l402_endpoints must NOT be present in discovery catalog")
	}

	// v1 advertises the channel faucet only — no paid service at this
	// time. The tier_matrix / registration_grant / daily_spend_cap /
	// future_tiers keys were removed because they only make sense when
	// a paid tier exists. Guard against accidental reintroduction.
	for _, forbidden := range []string{"tier_matrix", "future_tiers"} {
		if _, present := data[forbidden]; present {
			t.Errorf("%q must NOT be advertised in v1 (no paid service at this time)", forbidden)
		}
	}
}

// TestDiscovery_ChannelFaucet asserts the shape of the channel_faucet
// block — the only product surface LQWDClaw advertises in v1.
func TestDiscovery_ChannelFaucet(t *testing.T) {
	deps := newTestDeps(t)

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	data := body["data"].(map[string]any)

	cf, ok := data["channel_faucet"].(map[string]any)
	if !ok {
		t.Fatalf("channel_faucet not an object: %T", data["channel_faucet"])
	}

	if cap, _ := cf["capacity_sats"].(float64); cap != 20000 {
		t.Errorf("channel_faucet.capacity_sats = %v, want 20000", cf["capacity_sats"])
	}
	if push, _ := cf["push_sats"].(float64); push != 1354 {
		t.Errorf("channel_faucet.push_sats = %v, want 1354", cf["push_sats"])
	}
	if g, _ := cf["grants_per_agent"].(float64); g != 1 {
		t.Errorf("channel_faucet.grants_per_agent = %v, want 1", cf["grants_per_agent"])
	}
	reqs, ok := cf["requirements"].([]any)
	if !ok || len(reqs) == 0 {
		t.Errorf("channel_faucet.requirements must be a non-empty array")
	}
	// The node_helper string must name SaturnZap so agents without a
	// node can discover the recommended OSS tool.
	if helper, _ := cf["node_helper"].(string); !strings.Contains(helper, "SaturnZap") {
		t.Errorf("channel_faucet.node_helper must reference SaturnZap; got %q", helper)
	}
}

// TestDiscovery_LQWDNode asserts the optional lqwd_node block surfaces
// when LQWD_NODE_URI is set and stays absent when it isn't. The block
// tells agents which URI to peer-connect to BEFORE registering, closing
// the ban-on-first-connect-failure trap surfaced in the 2026-04-21 UAT.
func TestDiscovery_LQWDNode(t *testing.T) {
	// Absent when env unset
	t.Setenv("LQWD_NODE_URI", "")
	deps := newTestDeps(t)
	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	data := body["data"].(map[string]any)
	if _, present := data["lqwd_node"]; present {
		t.Errorf("lqwd_node must be absent when LQWD_NODE_URI is unset")
	}

	// Present when env is set
	want := "02abc@127.0.0.1:9735"
	t.Setenv("LQWD_NODE_URI", want)
	w = httptest.NewRecorder()
	deps.Discovery(w, req)
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	data = body["data"].(map[string]any)
	node, ok := data["lqwd_node"].(map[string]any)
	if !ok {
		t.Fatalf("lqwd_node must be an object when LQWD_NODE_URI is set; got %T", data["lqwd_node"])
	}
	if node["uri"] != want {
		t.Errorf("lqwd_node.uri = %v, want %q", node["uri"], want)
	}
	if instr, _ := node["instruction"].(string); !strings.Contains(instr, "peer") {
		t.Errorf("lqwd_node.instruction must mention 'peer'; got %q", instr)
	}
}

// TestDiscovery_MCPUrlMatchesRoute ensures the advertised MCP URL points
// at the public /v1/mcp path that cmd/lnd-gateway/main.go actually mounts.
// If the route moves, this test forces the catalog to follow.
func TestDiscovery_MCPUrlMatchesRoute(t *testing.T) {
	deps := newTestDeps(t)

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	data := body["data"].(map[string]any)

	mcpURL, _ := data["mcp_url"].(string)
	if !strings.HasSuffix(mcpURL, "/v1/mcp") {
		t.Errorf("mcp_url = %q, want suffix /v1/mcp", mcpURL)
	}
}

// TestValidateAdvertisementConsistency locks the contract between
// /v1/discovery's channel_faucet block and the runtime config the gateway
// actually hands to LND on openchannel. Drift here was the #1 hardest-to-
// diagnose failure in the 2026-04-21 UAT — discovery advertised 20k/1354
// while production env still had the old 100k/25k defaults, and LND's
// "reserved wallet balance invalidated" error took hours to trace back
// to config rather than to Lightning protocol.
func TestValidateAdvertisementConsistency(t *testing.T) {
	// Matching values pass
	if err := ValidateAdvertisementConsistency(AdvertisedChannelSizeSats, AdvertisedPushSats); err != nil {
		t.Errorf("matching values must validate; got %v", err)
	}

	// Mismatched capacity fails
	if err := ValidateAdvertisementConsistency(AdvertisedChannelSizeSats+1, AdvertisedPushSats); err == nil {
		t.Errorf("capacity mismatch must fail validation")
	}

	// Mismatched push fails
	if err := ValidateAdvertisementConsistency(AdvertisedChannelSizeSats, AdvertisedPushSats+1); err == nil {
		t.Errorf("push mismatch must fail validation")
	}

	// The specific 100k/25k vs 20k/1354 pairing that broke production
	// on 2026-04-21 must be caught by this check.
	if err := ValidateAdvertisementConsistency(100_000, 25_000); err == nil {
		t.Errorf("the exact production-incident pairing (100k/25k) must fail validation")
	}
}

// discoveryV3Golden is the Wave 0 authoritative golden file for the
// /v1/discovery response shape. The live handler's `data` object MUST
// match this file exactly (modulo JSON key order). Any drift —
// rename, removal, or unexpected addition — fails TestDiscoveryV3Golden
// and forces the PR author to update both handler and golden together.
//
//go:embed testdata/discovery-v3.json
var discoveryV3Golden []byte

// TestDiscoveryV3Golden asserts the live /v1/discovery response `data`
// object matches testdata/discovery-v3.json (the Wave 0 contract).
// Uses JSON-equality (not byte-equality) so key-order differences don't
// matter. The golden file captures the four Phase 22 additive fields
// (install_commands, flow_order, suggested_alias_rules, discovery_version)
// and ALL pre-existing fields — so this test also guards against
// accidental rename/removal of prior fields (D-17 additive-only rule).
//
// The golden file contains the literal sentinel "<LQWD_NODE_URI env
// value — pubkey@host:port>" in lqwd_node.uri, so the test sets the env
// var to that exact literal for a deterministic comparison.
func TestDiscoveryV3Golden(t *testing.T) {
	t.Setenv("LQWD_NODE_URI", "<LQWD_NODE_URI env value — pubkey@host:port>")
	deps := newTestDeps(t)
	// Ensure faucet-pause path is not set so the response omits
	// faucet_paused/pause_reason (matches golden shape).
	deps.FaucetPauseFilePath = ""

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var envelope map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	actualData, ok := envelope["data"].(map[string]any)
	if !ok {
		t.Fatalf("envelope.data missing or wrong type: %T", envelope["data"])
	}

	var expectedData map[string]any
	if err := json.Unmarshal(discoveryV3Golden, &expectedData); err != nil {
		t.Fatalf("decode golden: %v", err)
	}

	if !reflect.DeepEqual(expectedData, actualData) {
		goldenPretty, _ := json.MarshalIndent(expectedData, "", "  ")
		actualPretty, _ := json.MarshalIndent(actualData, "", "  ")
		t.Errorf("discovery response drift from golden.\n--- Golden ---\n%s\n\n--- Actual ---\n%s",
			goldenPretty, actualPretty)
	}
}

// TestDiscoveryNoCurlPipeSh asserts the rendered /v1/discovery body
// contains no `curl | sh` or `| bash` pattern. This is the A1 posture
// enforcement — zero hosted shell-wrapper advertisements originating
// from the gateway. Mirrors the CI scope-lock regex gate (Plan 07).
func TestDiscoveryNoCurlPipeSh(t *testing.T) {
	t.Setenv("LQWD_NODE_URI", "")
	deps := newTestDeps(t)
	deps.FaucetPauseFilePath = ""

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	body := w.Body.String()
	// Regex matches `curl ... | sh` and `curl ... | bash` (any whitespace
	// or flags between `curl` and the pipe). Also catches the standalone
	// `| sh` / `| bash` patterns.
	curlPipe := regexp.MustCompile(`(?s)curl[^\n]*\|\s*(sh|bash)\b`)
	if m := curlPipe.FindString(body); m != "" {
		t.Errorf("discovery body contains curl-pipe-shell pattern %q — v3.0 posture violation", m)
	}
	standalonePipe := regexp.MustCompile(`\|\s*(sh|bash)\b`)
	if m := standalonePipe.FindString(body); m != "" {
		t.Errorf("discovery body contains bare pipe-shell pattern %q — v3.0 posture violation", m)
	}
}

// TestDiscoveryNoForbiddenTokens asserts the rendered body contains zero
// forbidden tokens (case-insensitive, word-boundary). Forbidden set:
// l402, credit, debit, invoice, pay, spend — the v3.0 "faucet only"
// scope lock. Mirrors the CI scope-lock regex (Plan 07 / D-10).
func TestDiscoveryNoForbiddenTokens(t *testing.T) {
	t.Setenv("LQWD_NODE_URI", "")
	deps := newTestDeps(t)
	deps.FaucetPauseFilePath = ""

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	body := w.Body.String()
	re := regexp.MustCompile(`(?i)\b(l402|credit|debit|invoice|pay|spend)\b`)
	if m := re.FindString(body); m != "" {
		t.Errorf("discovery body contains forbidden token %q (v3.0 scope lock)", m)
	}
}
