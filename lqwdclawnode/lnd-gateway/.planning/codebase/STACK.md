# Technology Stack

**Analysis Date:** 2026-03-25

## Languages

**Primary:**
- Go 1.24.11 - HTTP gateway server and all business logic

## Runtime

**Environment:**
- Go runtime (no external VM required)

**Package Manager:**
- Go modules (go.mod/go.sum)
- Lockfile: Present (`go.sum`)

## Frameworks

**Core:**
- `net/http` (Go stdlib) - HTTP server and routing
- `google.golang.org/grpc` v1.79.3 - gRPC client for LND communication
- `github.com/lightningnetwork/lnd` v0.20.1-beta - LND daemon library and RPC definitions

**Build/Dev:**
- Make (Makefile-based build system)
- CGO_ENABLED=1 required (for SQLite support)

## Key Dependencies

**Critical:**
- `github.com/lightningnetwork/lnd` v0.20.1-beta - Lightning Node Daemon RPC interface
  - Provides `lnrpc`, `routerrpc`, `walletrpc` proto packages
  - Used for all Lightning Network operations (channels, payments, fees, peers, etc.)
  - Uses protobuf with custom hex display fork

**Infrastructure:**
- `github.com/mattn/go-sqlite3` v1.14.24 - SQLite C bindings
  - Used for audit logging, idempotency tracking, and L402 token store
  - Requires CGO compilation
- `google.golang.org/grpc` v1.79.3 - RPC framework for LND communication
  - TLS-based with macaroon authentication
- `google.golang.org/protobuf` (via fork) - Protocol buffers for LND gRPC
  - Forked to: `github.com/lightninglabs/protobuf-go-hex-display` v1.33.0
  - Adds UseHexForBytes to protojson for compatibility

**Authentication & Security:**
- `gopkg.in/macaroon.v2` - Macaroon-based bearer tokens for L402 protocol
  - Used for L402 token generation and verification
  - HMAC signing with SHA-256

**Logging:**
- `log/slog` (Go 1.21+ stdlib) - Structured JSON logging to stderr

**Testing:**
- `github.com/stretchr/testify` v1.11.1 - Test assertion and mocking library
- Built-in `testing` package (Go stdlib)
- 13 test files across internal packages

## Configuration

**Environment:**
- Environment variables only (no config files)
- See `internal/config/config.go` for comprehensive list

**Key variables:**
- `GATEWAY_AGENT_TOKEN` - Bearer token for OpenClaw agent (required, production)
- `GATEWAY_ADMIN_TOKEN` - Bearer token for human/confirm operations (required, production)
- `LND_GRPC_HOST` - LND gRPC endpoint (default: 127.0.0.1:10009)
- `LND_TLS_CERT_PATH` - Path to LND TLS certificate (required, production)
- `LND_MACAROON_DIR` - Directory containing scoped macaroons (default: /lnd/data/chain/bitcoin/mainnet)
- `L402_ENABLED` - Enable L402 protocol endpoints (default: false)
- `L402_SIGNING_KEY` - Hex-encoded 32-byte HMAC key for L402 (required if L402_ENABLED=true, production)
- `AUDIT_DB_PATH` - SQLite audit log location (default: data/audit.db)
- `AUDIT_FALLBACK_PATH` - JSON fallback log (default: data/audit-fallback.jsonl)
- `GATEWAY_MOCK` - Enable mock mode for testing (default: false)

**Build:**
- Makefile with targets: build, run, mock, test, test-v, lint, clean
- Binary requires CGO_ENABLED=1 for SQLite

## Storage

**Databases:**
- **SQLite (WAL mode)** - Three separate databases for isolation
  - `audit.db` - Audit log for all gateway operations
  - `idempotency.db` - Duplicate request prevention (client-provided keys)
  - `l402.db` - L402 token lifecycle (pending → paid → consumed)
  - All use `?_journal_mode=WAL&_synchronous=NORMAL` for performance
  - Fallback JSON logs for audit database failures

**No network databases:** All data persists locally to filesystem

## Platform Requirements

**Development:**
- Go 1.24.11 or later
- CGO support (C compiler, e.g., gcc/clang)
- SQLite development headers
- LND instance (or use GATEWAY_MOCK=true for testing)

**Production:**
- Go runtime (single binary, no dependencies)
- Access to LND gRPC endpoint (localhost or remote)
- Filesystem access for SQLite databases and log files
- Sufficient disk space for audit logs

**Macaroon Files:**
LND must provide 4 scoped macaroons:
- `readonly.macaroon` - Read-only operations
- `invoice.macaroon` - Invoice creation
- `channeladmin.macaroon` - Channel operations
- `pay.macaroon` - Payment authorization

---

*Stack analysis: 2026-03-25*
