package handlers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

// loadTrustManifestJSON reads the repo-path trust manifest at test time.
// The path is resolved relative to THIS test file's on-disk location via
// runtime.Caller so the test works regardless of the test runner's CWD
// (go test, IDEs, CI runners all behave differently).
//
// We use runtime file-read rather than //go:embed because the manifest
// lives outside the lnd-gateway Go module — at ../../../../scripts/well-known/
// inside the lqwdclawnode/ tree, which Go's embed directive rejects for
// cross-module escapes. The drift-detection semantics are identical: if
// the manifest moves or is deleted, this test fails immediately with a
// clear "file not found" error (Phase 22 TRM-04 / D-06).
//
// Walk: this file lives at lqwdclawnode/lnd-gateway/internal/handlers/ .
// Four ../ to reach lqwdclawnode/ , then scripts/well-known/ai-agent-trust.json.
func loadTrustManifestJSON(tb testing.TB) []byte {
	tb.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		tb.Fatalf("runtime.Caller failed")
	}
	dir := filepath.Dir(thisFile)
	manifestPath := filepath.Join(dir, "..", "..", "..", "..", "lqwdclawnode", "scripts", "well-known", "ai-agent-trust.json")
	// If this test ever runs from a checkout rooted directly at lqwdclawnode/
	// (rather than the outer ClaudeCode/ wrapper), the ../../../../ walk
	// overshoots. Fall back to the three-level walk from the lnd-gateway
	// module root to lqwdclawnode/scripts/... .
	if _, err := os.Stat(manifestPath); err != nil {
		manifestPath = filepath.Join(dir, "..", "..", "..", "scripts", "well-known", "ai-agent-trust.json")
	}
	bytes, err := os.ReadFile(manifestPath)
	if err != nil {
		tb.Fatalf("read manifest %s: %v", manifestPath, err)
	}
	return bytes
}

// TestTrustManifestMatchesAdvertisedConstants asserts that the manifest's
// channel_faucet values match the in-code constants served by /v1/discovery.
// This is the drift-guard for TRM-04 — if the manifest drifts, agents would
// read inconsistent values from /.well-known/ai-agent-trust.json vs
// /v1/discovery. Mirrors the existing ValidateAdvertisementConsistency
// pattern in discovery.go.
func TestTrustManifestMatchesAdvertisedConstants(t *testing.T) {
	var manifest struct {
		ChannelFaucet struct {
			CapacitySats int64 `json:"capacity_sats"`
			PushSats     int64 `json:"push_sats"`
		} `json:"channel_faucet"`
	}
	if err := json.Unmarshal(loadTrustManifestJSON(t), &manifest); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}
	if manifest.ChannelFaucet.CapacitySats != AdvertisedChannelSizeSats {
		t.Errorf("manifest channel_faucet.capacity_sats=%d disagrees with AdvertisedChannelSizeSats=%d — manifest would lie to agents. Align manifest to advertised value or change the constant deliberately.",
			manifest.ChannelFaucet.CapacitySats, AdvertisedChannelSizeSats)
	}
	if manifest.ChannelFaucet.PushSats != AdvertisedPushSats {
		t.Errorf("manifest channel_faucet.push_sats=%d disagrees with AdvertisedPushSats=%d — manifest would lie to agents. Align manifest to advertised value or change the constant deliberately.",
			manifest.ChannelFaucet.PushSats, AdvertisedPushSats)
	}
}

// TestTrustManifestNoSignatureField enforces TRM-02: the manifest must NOT
// include a signature key in v3.0. Signing is deferred to v3.1+ (TRM-F01).
// Until we ship the verification harness, a premature signature key would
// be load-bearing fiction — this test fails the PR if one is added.
func TestTrustManifestNoSignatureField(t *testing.T) {
	var raw map[string]any
	if err := json.Unmarshal(loadTrustManifestJSON(t), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := raw["signature"]; present {
		t.Error("TRM-02 violation: 'signature' key present at top level — signing is deferred to v3.1+ (TRM-F01). Remove the key or raise a plan to ship verification.")
	}
}

// TestTrustManifestNoForbiddenTokens enforces the v3.0 scope lock at the
// manifest layer. Same forbidden-token set as the CI scope-lock gate
// (scripts/ci/scope-lock-check.sh) — faucet-only surface in v3.0, no
// L402 / credit / paid-fetch advertising externally.
func TestTrustManifestNoForbiddenTokens(t *testing.T) {
	re := regexp.MustCompile(`(?i)\b(l402|credit|debit|invoice|pay|spend)\b`)
	if m := re.FindString(string(loadTrustManifestJSON(t))); m != "" {
		t.Errorf("manifest contains forbidden v3.0-scope-lock token %q — v3.0 surface is faucet-only", m)
	}
}

// TestTrustManifestSaturnzapApprovedPackage asserts the sole approved
// package pins SaturnZap v1.3.1 with the --find-links explicit form.
// No curl-pipe-sh pattern is allowed in the install command.
func TestTrustManifestSaturnzapApprovedPackage(t *testing.T) {
	var manifest struct {
		ApprovedPackages []struct {
			Ecosystem string `json:"ecosystem"`
			Name      string `json:"name"`
			Pin       string `json:"pin"`
			Install   string `json:"install"`
		} `json:"approved_packages"`
	}
	if err := json.Unmarshal(loadTrustManifestJSON(t), &manifest); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	found := false
	for _, p := range manifest.ApprovedPackages {
		if p.Name != "saturnzap" {
			continue
		}
		found = true
		if p.Pin != "v1.3.1" {
			t.Errorf("saturnzap pin=%q want v1.3.1", p.Pin)
		}
		if !strings.Contains(p.Install, "--find-links") {
			t.Errorf("saturnzap install missing --find-links form: %q", p.Install)
		}
		if strings.Contains(p.Install, "| sh") || strings.Contains(p.Install, "| bash") {
			t.Errorf("saturnzap install contains forbidden curl-pipe-shell pattern: %q", p.Install)
		}
		if p.Ecosystem != "pypi" {
			t.Errorf("saturnzap ecosystem=%q want pypi", p.Ecosystem)
		}
		break
	}
	if !found {
		t.Error("saturnzap entry missing from approved_packages — the manifest must list SaturnZap as the canonical install target")
	}
}

// TestTrustManifestContactFields asserts contact.operator and contact.security
// are both non-empty and look like email addresses. Discovery and security.txt
// rely on these being populated; classifiers inspecting the manifest use the
// contact block to route abuse reports.
func TestTrustManifestContactFields(t *testing.T) {
	var manifest struct {
		Contact struct {
			Operator string `json:"operator"`
			Security string `json:"security"`
		} `json:"contact"`
	}
	if err := json.Unmarshal(loadTrustManifestJSON(t), &manifest); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !strings.Contains(manifest.Contact.Operator, "@") {
		t.Errorf("contact.operator is not valid-looking email: %q", manifest.Contact.Operator)
	}
	if !strings.Contains(manifest.Contact.Security, "@") {
		t.Errorf("contact.security is not valid-looking email: %q", manifest.Contact.Security)
	}
}
