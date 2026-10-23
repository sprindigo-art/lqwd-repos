package handlers

import (
	"net/http"
	"testing"
)

func TestNodeSummary_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.NodeSummary, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["ok"] != true {
		t.Fatal("expected ok=true")
	}
	data := resp["data"].(map[string]any)

	// Verify all top-level sections exist
	sections := []string{"node", "balances", "channels", "peers", "routing", "health", "generated_at"}
	for _, s := range sections {
		if data[s] == nil {
			t.Fatalf("expected %s section in node summary", s)
		}
	}

	// Verify node info
	node := data["node"].(map[string]any)
	if node["synced"] != true {
		t.Fatal("expected node to be synced")
	}

	// Verify health
	health := data["health"].(map[string]any)
	if health["status"] != "healthy" {
		t.Fatal("expected healthy status")
	}
}
