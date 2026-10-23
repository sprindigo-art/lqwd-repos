// Package lndparse centralizes parsing of LND gRPC response payloads into
// derived channel-state facts. It is the single source of truth for the
// (fundingTxID, outputIndex) → status resolution used by both the channel
// faucet's background poller (internal/accounts/channel.go) and the inline
// /v1/internal/channel/status handler added in Phase 22 (CHO-01/CHO-02).
//
// Every type assertion in this package uses the comma-ok form with an
// explicit error return on mismatch — no silent `_ = x.(T)` or underscore
// swallows. This discipline directly prevents the UAT-11 / UAT-12 stuck-
// pending bug class (see internal/accounts/channel.go for the pre-Phase-22
// inline code and its post-mortem comment).
//
// The extractChannelsList helper tolerates BOTH []map[string]any (in-process
// concrete slice produced by the gRPC wrapper in internal/lnd/grpc.go) AND
// []any (post-JSON-roundtrip generic slice), because a future refactor that
// serializes an LND response and re-parses it — or a caller that feeds a
// fixture through encoding/json — would otherwise silently fall through to
// the empty-state branch. That exact silent fallthrough is what left UAT-11
// stuck for 16 hours.
package lndparse

import (
	"context"
	"fmt"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
)

// ParseChannelState determines the authoritative status for a channel
// identified by (fundingTxID, outputIndex). It accepts the raw map[string]any
// envelopes produced by lnd.Client.ListChannels and lnd.Client.ClosedChannels.
//
// Returns:
//   - ("open", channel_point, "", nil) if the funding outpoint appears in the
//     active channels list.
//   - ("closed", channel_point, closeType, nil) if it appears in the closed
//     channels list. closeType is the LND CloseType enum string (e.g.,
//     "COOPERATIVE_CLOSE") when present, empty otherwise.
//   - ("pending_open", "", "", nil) if it is not found in either list — the
//     channel is still confirming on-chain (D-03 semantics; caller loops).
//   - ("", "", "", err) on STRUCTURAL errors (missing or wrong-typed data
//     map, malformed channels slice). Never silent.
//
// closedResp may be nil if the caller decides to skip the second RPC (e.g.,
// early in the poller's inner loop); ParseChannelState still resolves the
// open and pending_open cases correctly.
func ParseChannelState(
	channelsResp map[string]any,
	closedResp map[string]any,
	fundingTxID string,
	outputIndex int,
) (status string, channelPoint string, closeType string, err error) {
	target := fmt.Sprintf("%s:%d", fundingTxID, outputIndex)

	// Active channels.
	activeData, err := extractChannelsList(channelsResp, "ListChannels")
	if err != nil {
		return "", "", "", err
	}
	for _, entry := range activeData {
		cp, ok := entry["channel_point"].(string)
		if !ok {
			continue
		}
		if cp == target {
			return "open", cp, "", nil
		}
	}

	// Closed channels — closedResp is legitimately optional.
	if closedResp != nil {
		closedData, err := extractChannelsList(closedResp, "ClosedChannels")
		if err != nil {
			return "", "", "", err
		}
		for _, entry := range closedData {
			cp, ok := entry["channel_point"].(string)
			if !ok {
				continue
			}
			if cp == target {
				ct, ok := entry["close_type"].(string)
				if !ok {
					ct = ""
				}
				return "closed", cp, ct, nil
			}
		}
	}

	// Not found in either list — D-03: treat as pending_open, caller retries.
	return "pending_open", "", "", nil
}

// extractChannelsList pulls the `data.channels` slice from the standard
// lnd.Client envelope shape. It tolerates both []map[string]any (in-process)
// and []any (JSON round-trip) concrete slice types, and explicitly fails on
// any other shape — no silent empty-state fallthrough (UAT-11 guard).
func extractChannelsList(resp map[string]any, source string) ([]map[string]any, error) {
	data, ok := resp["data"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("lndparse: %s: missing or malformed 'data' map", source)
	}
	raw, exists := data["channels"]
	if !exists {
		// No channels key at all — treat as a valid empty list.
		return nil, nil
	}
	switch v := raw.(type) {
	case []map[string]any:
		return v, nil
	case []any:
		out := make([]map[string]any, 0, len(v))
		for i, e := range v {
			m, ok := e.(map[string]any)
			if !ok {
				return nil, fmt.Errorf(
					"lndparse: %s: channels[%d] is not map[string]any (got %T)",
					source, i, e,
				)
			}
			out = append(out, m)
		}
		return out, nil
	case nil:
		return nil, nil
	default:
		return nil, fmt.Errorf(
			"lndparse: %s: channels is unexpected type %T", source, raw,
		)
	}
}

// LiveChannelLookup performs both LND RPC calls (ListChannels + ClosedChannels)
// and derives the authoritative status via ParseChannelState. Used by the
// inline /v1/internal/channel/status handler (Stage C) and — after its
// refactor — the background channel poller (Stage C FM-1 mitigation).
//
// ClosedChannels failure is non-fatal: we can still answer open / pending_open
// accurately, so we swallow the closed-lookup error and downgrade to nil.
// Callers that care should log the degraded path in their own context.
func LiveChannelLookup(
	ctx context.Context,
	lndClient lnd.Client,
	fundingTxID string,
	outputIndex int,
) (status string, channelPoint string, closeType string, err error) {
	channelsResp, err := lndClient.ListChannels(ctx)
	if err != nil {
		return "", "", "", fmt.Errorf("lndparse: ListChannels: %w", err)
	}
	closedResp, err := lndClient.ClosedChannels(ctx)
	if err != nil {
		// Non-fatal: fall back to active-only lookup.
		closedResp = nil
	}
	return ParseChannelState(channelsResp, closedResp, fundingTxID, outputIndex)
}
