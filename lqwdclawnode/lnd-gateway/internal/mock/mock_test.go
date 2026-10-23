package mock

import (
	"encoding/hex"
	"testing"
)

func TestMockPreimageUniqueness(t *testing.T) {
	r1 := SendPayment("lnbc1000n1mock", 1000)
	r2 := SendPayment("lnbc2000n1mock", 2000)

	d1 := r1["data"].(map[string]any)
	d2 := r2["data"].(map[string]any)

	p1 := d1["payment_preimage"].(string)
	p2 := d2["payment_preimage"].(string)

	if p1 == p2 {
		t.Errorf("preimages should differ, both got %s", p1)
	}

	// Verify valid 64-char hex
	for _, p := range []string{p1, p2} {
		if len(p) != 64 {
			t.Errorf("preimage length = %d, want 64", len(p))
		}
		if _, err := hex.DecodeString(p); err != nil {
			t.Errorf("preimage %q is not valid hex: %v", p, err)
		}
	}
}
