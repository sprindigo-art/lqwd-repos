#!/bin/sh
#
# env-only-boot-guard.sh — HARDEN-02: prove the DASHBOARD app boots from env vars
# ONLY, with no hardcoded host literal on a boot-config path.
#
# Threat (T-18-29): a silent `localhost`/`127.0.0.1`/literal-IP default baked into
# the Next.js server's connection-config code would connect a VM deploy to the
# WRONG (or no) host — the local→VM flip must be config-only (env vars point at VM
# endpoints; NO code change). This guard greps the app's boot-config paths for any
# hardcoded connection host/port literal and FAILS (exit 1) on a hit, so a
# regression that re-introduces a host default cannot ship green.
#
# SCOPE (why THESE paths):
#   The dashboard boots from `src/instrumentation.ts` -> `src/lib/db/*` (the three
#   postgres() clients) -> `src/lib/db/env.ts` (env resolution) -> `src/lib/config/*`
#   (backend map). Those are the ONLY code paths that resolve a connection target
#   at server start. Every one of them MUST read its host from `process.env` (via
#   `requireEnv`), never a source literal — that is the env-only-boot contract.
#
# DELIBERATELY OUT OF SCOPE:
#   - `.env.example` — the required-var CONTRACT; it documents example URLs on
#     purpose (host literals there are illustrative, never executed).
#   - `*.test.ts` / `*.test.tsx` — test fixtures legitimately stub hosts.
#   - `scripts/fileserver/*` (deploy-env.sh, collectors) — a SEPARATE trust domain:
#     node-side provisioning that runs ON each node, where `127.0.0.1` means "this
#     node's OWN local postgres" (the read-only probe) — a genuine loopback, not a
#     flip target — and the fleet DB host is already env-overridable (`NODEMON_DB`).
#     Those scripts source a root-only `.nodemon.env`; the dashboard never reads
#     them at boot, so they are not on the app's boot-config path.
#
# Exit 0 = clean (no host literal on a boot-config path); exit 1 = a hit.

set -eu

# Boot-config paths the dashboard resolves connection targets from at server start.
SCAN_PATHS="src/lib/db src/lib/config src/instrumentation.ts"

# Host/port literals that must NEVER appear as a source DEFAULT. Each alternative
# requires a CONNECTION context (a URL scheme, an `@` authority, a surrounding
# quote, or a `:port`) so the guard flags actual connection targets, NOT prose in
# a comment (e.g. "no localhost default" must not trip it):
#   - loopback/wildcard host in a connection context (`://`, `@`, quoted, or :port)
#   - postgres:// or postgresql:// with an embedded `@host`
#   - a dotted IPv4 literal after `@` or `://`, or a quoted/`:port` IPv4 host
LOOPBACK='(localhost|127\.0\.0\.1|0\.0\.0\.0)'
IPV4='([0-9]{1,3}\.){3}[0-9]{1,3}'
PATTERN="(://|@|[\"'])${LOOPBACK}|${LOOPBACK}:[0-9]|postgres(ql)?://[^\"'[:space:]]*@|(@|://)${IPV4}:[0-9]+|[\"']${IPV4}:[0-9]+"

hits=""
for path in $SCAN_PATHS; do
  [ -e "$path" ] || continue
  # -r recurse dirs, single files pass through; exclude test fixtures.
  found=$(grep -rnE "$PATTERN" "$path" \
            --include="*.ts" --include="*.tsx" \
            --exclude="*.test.ts" --exclude="*.test.tsx" 2>/dev/null || true)
  if [ -n "$found" ]; then
    hits="${hits}${found}
"
  fi
done

if [ -n "$hits" ]; then
  echo "env-only-boot-guard FAIL: hardcoded host/port literal on a boot-config path."
  echo "The local->VM flip MUST be env-only — resolve the host from process.env (requireEnv), never a source default (T-18-29)."
  echo "$hits"
  exit 1
fi

echo "env-only-boot-guard: boot-config paths clean (no hardcoded host literal — env-only boot holds)."
exit 0
