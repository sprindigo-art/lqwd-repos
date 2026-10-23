// Package killswitch provides an emergency mechanism to halt all write operations.
// The kill switch is a simple file-based check — if the file exists, writes are blocked.
// Read operations remain available for diagnostics.
package killswitch

import (
	"os"
	"sync/atomic"
)

// KillSwitch checks for the presence of a kill switch file.
type KillSwitch struct {
	filePath string
	manual   atomic.Bool // Programmatic kill switch (via admin API)
}

// New creates a kill switch that monitors the given file path.
func New(filePath string) *KillSwitch {
	return &KillSwitch{filePath: filePath}
}

// IsActive returns true if the kill switch is engaged (either via file or API).
func (ks *KillSwitch) IsActive() bool {
	// Check programmatic kill switch first (faster)
	if ks.manual.Load() {
		return true
	}
	// Check file-based kill switch
	_, err := os.Stat(ks.filePath)
	return err == nil
}

// Engage activates the programmatic kill switch.
func (ks *KillSwitch) Engage() {
	ks.manual.Store(true)
}

// Disengage deactivates the programmatic kill switch.
// Note: the file-based kill switch must be removed separately.
func (ks *KillSwitch) Disengage() {
	ks.manual.Store(false)
}

// Status returns the current state for health/admin endpoints.
func (ks *KillSwitch) Status() map[string]any {
	fileExists := false
	if _, err := os.Stat(ks.filePath); err == nil {
		fileExists = true
	}
	return map[string]any{
		"active":          ks.IsActive(),
		"file_exists":     fileExists,
		"file_path":       ks.filePath,
		"manual_engaged":  ks.manual.Load(),
	}
}
