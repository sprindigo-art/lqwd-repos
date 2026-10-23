package main

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestGatewayVersionHeader is the Phase 22 end-to-end assertion that promotes
// FM-10 (previously-manual X-Gateway-Version smoke check) to CI. It boots the
// gateway binary in mock mode on an ephemeral port and confirms the header is
// present on a public route, the discovery route, AND an authed route —
// covering every layer of the middleware chain (bypass, auth-skip, auth-pass).
//
// Per D-13 / 22-CONTEXT.md, the header MUST fire on every endpoint served
// through the chain. This test is the regression guard. If it breaks, check:
//   - middleware.GatewayVersion wiring in main.go (outer-most after Recovery)
//   - build didn't strip the ldflag (go build ./cmd/lnd-gateway without
//     -ldflags still produces Version="dev" — the header is still set,
//     just with the literal "dev" string)
func TestGatewayVersionHeader(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping binary-spawning integration test in -short mode")
	}

	// Locate the gateway binary source. This test file sits in
	// cmd/lnd-gateway/, so the package is the current directory.
	tmpDir := t.TempDir()
	binPath := filepath.Join(tmpDir, "lnd-gateway-test")
	if runtime.GOOS == "windows" {
		binPath += ".exe"
	}

	// Build the binary from the current package (.). Use -ldflags so the
	// header is deterministic for asserting a non-empty value.
	buildCmd := exec.Command("go", "build",
		"-ldflags", "-X main.Version=v0.0.0-itest",
		"-o", binPath, ".")
	buildCmd.Dir = "."
	out, err := buildCmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go build failed: %v\n%s", err, out)
	}

	// Pick an ephemeral port by binding and releasing.
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	addr := lis.Addr().String()
	_ = lis.Close()

	// Fresh data dir for audit.db / idempotency.db / kill-switch file.
	dataDir := filepath.Join(tmpDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir data: %v", err)
	}

	cmd := exec.Command(binPath)
	cmd.Env = append(os.Environ(),
		"GATEWAY_MOCK=true",
		"GATEWAY_LISTEN="+addr,
		"GATEWAY_AGENT_TOKEN=test-agent-token",
		"GATEWAY_ADMIN_TOKEN=test-admin-token",
		"AUDIT_DB_PATH="+filepath.Join(dataDir, "audit.db"),
		"AUDIT_FALLBACK="+filepath.Join(dataDir, "fallback.jsonl"),
		"KILL_SWITCH_PATH="+filepath.Join(dataDir, "kill-switch"),
	)
	cmd.Stdout = &bytes.Buffer{}
	cmd.Stderr = &bytes.Buffer{}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start binary: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})

	// Wait for readiness — poll /v1/health until 200 or timeout.
	baseURL := "http://" + addr
	if err := waitReady(baseURL+"/v1/health", 10*time.Second); err != nil {
		stderr := cmd.Stderr.(*bytes.Buffer).String()
		t.Fatalf("gateway never ready: %v\nstderr:\n%s", err, stderr)
	}

	// Routes to assert. Covers:
	//   - /v1/health         — Auth-bypass public route
	//   - /v1/discovery      — Auth-bypass public route (separate code path)
	//   - POST /v1/info      — agent-token-authed read route
	routes := []struct {
		method string
		path   string
		auth   string // empty = no auth
	}{
		{"GET", "/v1/health", ""},
		{"GET", "/v1/discovery", ""},
		{"POST", "/v1/info", "Bearer test-agent-token"},
	}

	client := &http.Client{Timeout: 5 * time.Second}
	for _, r := range routes {
		req, err := http.NewRequest(r.method, baseURL+r.path, strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("%s %s: build request: %v", r.method, r.path, err)
		}
		if r.auth != "" {
			req.Header.Set("Authorization", r.auth)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s: request failed: %v", r.method, r.path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		got := resp.Header.Get("X-Gateway-Version")
		if got == "" {
			t.Errorf("%s %s: X-Gateway-Version header absent (status=%d body=%s)",
				r.method, r.path, resp.StatusCode, string(body))
			continue
		}
		if got != "v0.0.0-itest" {
			t.Errorf("%s %s: X-Gateway-Version=%q want v0.0.0-itest (ldflag injection regressed?)",
				r.method, r.path, got)
		}
	}
}

// waitReady polls the given URL until a 200 response or the timeout expires.
func waitReady(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("timeout after %s waiting for %s", timeout, url)
}
