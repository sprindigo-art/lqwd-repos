package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// ValidateAdvertisementConsistency verifies that runtime configuration
// (typically from env vars: FAUCET_CHANNEL_SIZE_SATS, FAUCET_PUSH_SATS)
// matches the values advertised in /v1/discovery. main.go calls this at
// startup and fail-fasts with log.Fatal on drift so operators cannot
// accidentally ship a gateway that promises 20k and delivers 100k (the
// exact UAT failure mode observed 2026-04-21).
//
// If you genuinely need to change the public advertisement (e.g., raise
// faucet capacity), update AdvertisedChannelSizeSats / AdvertisedPushSats
// in this file AND the env values together.
func ValidateAdvertisementConsistency(runtimeChannelSize, runtimePushSats int64) error {
	if runtimeChannelSize != AdvertisedChannelSizeSats {
		return fmt.Errorf("FAUCET_CHANNEL_SIZE_SATS=%d disagrees with advertised AdvertisedChannelSizeSats=%d — /v1/discovery would lie to agents. Align env to advertised value (or change the advertised constant deliberately)", runtimeChannelSize, AdvertisedChannelSizeSats)
	}
	if runtimePushSats != AdvertisedPushSats {
		return fmt.Errorf("FAUCET_PUSH_SATS=%d disagrees with advertised AdvertisedPushSats=%d — /v1/discovery would lie to agents. Align env to advertised value (or change the advertised constant deliberately)", runtimePushSats, AdvertisedPushSats)
	}
	// Phase 22 DOC-01 / TRM-05 scope-lock self-check: the advertised install
	// command must use --find-links and must not contain any forbidden token.
	// This is the in-code mirror of the CI scope-lock gate — fails fast at
	// startup, complements CI.
	if !strings.Contains(SaturnzapInstallExplicit, "--find-links") {
		return fmt.Errorf("discovery install_commands.saturnzap.explicit is missing --find-links; v3.0 posture requires it")
	}
	lower := strings.ToLower(SaturnzapInstallExplicit)
	for _, tok := range []string{"l402", "credit", "debit", "invoice", "pay", "spend"} {
		if strings.Contains(lower, tok) {
			return fmt.Errorf("discovery install_commands.saturnzap.explicit contains forbidden token %q (v3.0 scope lock)", tok)
		}
	}
	return nil
}

// discoveryBaseURL is the public hostname advertised in the discovery
// catalog. Defined as a package-level const so tests can assert the
// exact URL shape an external agent will see.
const discoveryBaseURL = "https://api.lqwdclaw.bot"

// AdvertisedChannelSizeSats and AdvertisedPushSats are the exact values
// exposed in /v1/discovery's channel_faucet block. They are the
// PUBLIC, CONTRACTUAL values — the agent-facing surface. The gateway's
// runtime behavior MUST match these; a mismatch between advertisement
// and actual open-channel args produces silent LND failures
// (UAT 2026-04-21: "reserved wallet balance invalidated" because the
// env had 100k while discovery advertised 20k). main.go calls
// ValidateAdvertisementConsistency(cfg) at startup and fail-fasts on
// drift. Change these consts only together with the corresponding
// ops runbook + a deploy that ships the matching env updates.
const (
	AdvertisedChannelSizeSats int64 = 20_000
	AdvertisedPushSats        int64 = 1_354
)

// SaturnzapInstallExplicit is the canonical install command advertised by
// /v1/discovery AND asserted by ValidateAdvertisementConsistency. Single
// source of truth — do not inline this literal at either site.
//
// Phase 22 DOC-01 / A1 posture: the explicit `--find-links` form is the
// ONLY install command any surface may advertise. No curl-pipe-shell
// patterns, no hosted shell wrappers. See PITFALLS.md Pitfall 6 and D-17.
const SaturnzapInstallExplicit = "uv tool install saturnzap --find-links https://github.com/lqwdtech/SaturnZap/releases/expanded_assets/v1.3.1"

// Discovery returns a public catalog describing how agents onboard.
// No auth required. Caddy allowlists this path; see scripts/Caddyfile.
//
// v1 advertised surface (2026-04-21): LQWDClaw offers the free channel
// faucet only. There is no paid service at this time; paid liquidity
// and metered tools are a later version. The catalog reflects that:
//
//   - L402 pay-per-call endpoints: NOT advertised. Regulatory scope —
//     LQWD cannot pay Lightning services on users' behalf without them
//     running their own node. Code is intact for future use.
//   - Tier matrix / registration grant / daily spend cap: NOT advertised.
//     The 150-sat registration credit still lands in the ledger but is
//     inert until a paid tier exists.
//   - Paid MCP data tools: NOT registered (see mcpserver/tools.go).
//
// What IS advertised: where to register, where MCP lives, where the
// quickstart is, and the channel-faucet parameters (capacity, push,
// requirements).
//
// The response shape is stable — external agent harnesses are expected
// to consume it programmatically. Add fields additively; never rename
// or remove without a deprecation window.
func (d *Dependencies) Discovery(w http.ResponseWriter, r *http.Request) {
	channelFaucet := map[string]any{
		"capacity_sats":    AdvertisedChannelSizeSats,
		"push_sats":        AdvertisedPushSats,
		"grants_per_agent": 1,
		"requirements": []string{
			"mainnet Lightning node (LND or compatible)",
			"port 9735 publicly reachable",
			"66-char hex pubkey",
			"node_uri in pubkey@host:port form",
			"peer-connect to LQWD's node BEFORE registering (see lqwd_node.uri) — ConnectPeer failures during registration auto-ban the pubkey",
		},
		"node_helper": "Agents without a node can use SaturnZap (https://github.com/lqwdtech/SaturnZap), LQWD's OSS CLI+MCP Lightning wallet, to stand up a mainnet LDK node in minutes.",
	}

	// Phase 21 (2026-04-22): surface the faucet-pause flag so honest
	// agents who read /v1/discovery before /register don't waste a slot
	// on a paused faucet. Reason is parsed from the file's JSON body
	// (written by AdminFaucetPause). A missing/unreadable/malformed file
	// still yields faucet_paused=true with a generic reason — we'd rather
	// err on the side of honest advertisement than silently pretend the
	// faucet is healthy.
	if d.FaucetPauseFilePath != "" {
		if buf, err := os.ReadFile(d.FaucetPauseFilePath); err == nil {
			channelFaucet["faucet_paused"] = true
			reason := "paused"
			var parsed struct {
				Reason   string `json:"reason"`
				Actor    string `json:"actor"`
				PausedAt string `json:"paused_at"`
			}
			if err := json.Unmarshal(buf, &parsed); err == nil {
				if parsed.Reason != "" {
					reason = parsed.Reason
				}
				if parsed.PausedAt != "" {
					channelFaucet["paused_at"] = parsed.PausedAt
				}
			}
			channelFaucet["pause_reason"] = reason
		} else if !os.IsNotExist(err) {
			// File exists but couldn't be read (permissions, etc.).
			// Still advertise paused to keep honest agents honest.
			channelFaucet["faucet_paused"] = true
			channelFaucet["pause_reason"] = "paused"
		}
	}

	data := map[string]any{
		"service":          "lqwdclaw-nodeops",
		"mcp_url":          discoveryBaseURL + "/v1/mcp",
		"registration_url": discoveryBaseURL + "/v1/internal/accounts/register",
		"docs_url":         "https://lqwdclaw.bot/for-agents",
		"channel_faucet":   channelFaucet,
		"example_curl":     `curl -X POST ` + discoveryBaseURL + `/v1/internal/accounts/register -H "Content-Type: application/json" -d '{"name":"<pick-unique-node-name>","pubkey":"<66-char-hex>","node_uri":"<pubkey>@<host>:9735"}'`,
	}

	// lqwd_node advertises LQWD's own Lightning node URI so agents can
	// pre-connect as a peer BEFORE hitting the faucet registration. If
	// the peer connection already exists when /register fires, LQWD's
	// ConnectPeer step is a no-op and the OpenChannel can proceed
	// immediately — avoiding the ban-on-first-failure trap observed in
	// the 2026-04-21 A-Z UAT. Operator sets LQWD_NODE_URI in the env
	// file (format: pubkey@host:port). If unset, the block is omitted
	// and the endpoint degrades gracefully.
	if nodeURI := os.Getenv("LQWD_NODE_URI"); nodeURI != "" {
		data["lqwd_node"] = map[string]any{
			"uri":         nodeURI,
			"instruction": "Peer-connect to this URI from your node BEFORE calling /v1/internal/accounts/register. On LND: `lncli connect <uri>`. On SaturnZap: `sz peers add <uri>`. Confirm the peer is up (`lncli listpeers` / `sz peers list`), then register.",
		}
	}

	// Phase 22 DOC-01: explicit install command, NO curl-pipe-shell form (A1 posture).
	data["install_commands"] = map[string]any{
		"saturnzap": map[string]any{
			"explicit": SaturnzapInstallExplicit,
			"verify":   "sz --version",
		},
	}

	// Phase 22 DOC-02: ordered onboarding flow for agents. Faucet-only
	// — no paid-fetch steps. Agents SHOULD execute in this order.
	data["flow_order"] = []any{
		"install",
		"init_for_lqwd_faucet",
		"service_install",
		"peer_add",
		"reachability_check",
		"register",
		"poll_status",
	}

	// Phase 22 DOC-03: alias-naming constraints. Enforced server-side at
	// /register; surfaced here so agents can validate client-side first.
	data["suggested_alias_rules"] = map[string]any{
		"min_length":        3,
		"max_length":        32,
		"allowed_chars":     "a-z A-Z 0-9 - _",
		"reserved_prefixes": []any{"lqwd", "lqwdclaw", "lqwdtech"},
	}

	// Phase 22 DOC-04: explicit schema version. Additive-only within a
	// major version. Breaking changes bump to "4.0".
	data["discovery_version"] = "3.0"

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": data,
	})
}
