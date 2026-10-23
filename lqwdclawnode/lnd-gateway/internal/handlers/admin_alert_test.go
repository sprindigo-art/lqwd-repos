package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestAdminAlert exercises the full validation + happy-path surface of the
// /v1/internal/admin/alert handler (SKL-03/SKL-04 alert sink). Auth is
// enforced by the cfMw wrapper in main.go; this test targets the handler
// in isolation so every failure mode produces a deterministic status +
// envelope shape.
func TestAdminAlert(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantOK     bool
	}{
		{"info ok", `{"level":"info","source":"skill:lnd-channels","message":"test"}`, 200, true},
		{"warn ok", `{"level":"warn","source":"skill:faucet-admin","message":"drift detected"}`, 200, true},
		{"error ok", `{"level":"error","source":"skill:faucet-monitor","message":"symlink drift"}`, 200, true},

		{"bad level", `{"level":"critical","source":"skill:x","message":"y"}`, 400, false},
		{"empty level", `{"level":"","source":"skill:x","message":"y"}`, 400, false},
		{"missing source", `{"level":"info","source":"","message":"y"}`, 400, false},
		{"empty message", `{"level":"info","source":"skill:x","message":""}`, 400, false},
		{"oversize message", `{"level":"info","source":"skill:x","message":"` + strings.Repeat("a", 501) + `"}`, 400, false},
		{"invalid json", `not-json`, 400, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/internal/admin/alert", bytes.NewBufferString(c.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			AdminAlert(rec, req)

			if rec.Code != c.wantStatus {
				t.Errorf("status=%d want %d body=%s", rec.Code, c.wantStatus, rec.Body.String())
			}
			var resp map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode response: %v body=%s", err, rec.Body.String())
			}
			ok, _ := resp["ok"].(bool)
			if ok != c.wantOK {
				t.Errorf("ok=%v want %v body=%s", ok, c.wantOK, rec.Body.String())
			}
			if c.wantOK {
				data, dataOK := resp["data"].(map[string]any)
				if !dataOK {
					t.Errorf("happy path missing data object: body=%s", rec.Body.String())
				} else if accepted, _ := data["accepted"].(bool); !accepted {
					t.Errorf("happy path accepted != true: body=%s", rec.Body.String())
				}
			} else {
				if _, hasErr := resp["error"]; !hasErr {
					t.Errorf("error case missing error field: body=%s", rec.Body.String())
				}
			}

			// Envelope content-type matches sibling handlers.
			if ct := rec.Header().Get("Content-Type"); ct != "" && !strings.Contains(ct, "application/json") {
				t.Errorf("Content-Type=%q want application/json", ct)
			}
		})
	}

	// Bonus: happy-path path+method is POST /v1/internal/admin/alert — ensure
	// the handler does not care about r.Method (it's the mux's job); body is
	// still parsed.
	t.Run("method-agnostic parsing", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/anything",
			bytes.NewBufferString(`{"level":"info","source":"skill:x","message":"hi"}`))
		rec := httptest.NewRecorder()
		AdminAlert(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("handler rejected non-POST method — routing should be the mux's job (status=%d)", rec.Code)
		}
	})
}
