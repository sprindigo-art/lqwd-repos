package middleware

import "net/http"

// GatewayVersion returns middleware that stamps the X-Gateway-Version header
// on every response. The version string is injected at build time via
// -ldflags "-X main.Version=$(git describe --tags --always --dirty)" in
// lqwdclawnode/scripts/deploy-gateway.sh (Phase 22 SKL-03 / D-12).
//
// Wire this middleware OUTER-MOST in the chain (outside Recovery) so that
// panics recovered downstream do not strip the header. See main.go's chain
// construction for the correct wrap order.
//
// Skills observe this header via a bash preamble in SKILL.md (per Open
// Question #1 resolution, revision iteration 1) and compare against their
// EXPECTED_GATEWAY_VERSION constant; on mismatch they log.warn + POST one
// Telegram alert per session via /v1/internal/admin/alert (D-14 dedupe).
func GatewayVersion(version string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Gateway-Version", version)
			next.ServeHTTP(w, r)
		})
	}
}
