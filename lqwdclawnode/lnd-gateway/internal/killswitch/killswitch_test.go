package killswitch

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileBasedKillSwitch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "kill-switch")

	ks := New(path)

	// Initially not active
	if ks.IsActive() {
		t.Error("kill switch should not be active initially")
	}

	// Create file
	if err := os.WriteFile(path, []byte("engaged"), 0644); err != nil {
		t.Fatalf("create kill switch file: %v", err)
	}

	if !ks.IsActive() {
		t.Error("kill switch should be active after file creation")
	}

	// Remove file
	os.Remove(path)
	if ks.IsActive() {
		t.Error("kill switch should be inactive after file removal")
	}
}

func TestProgrammaticKillSwitch(t *testing.T) {
	ks := New("/nonexistent/path")

	if ks.IsActive() {
		t.Error("should not be active initially")
	}

	ks.Engage()
	if !ks.IsActive() {
		t.Error("should be active after Engage")
	}

	ks.Disengage()
	if ks.IsActive() {
		t.Error("should be inactive after Disengage")
	}
}

func TestDualKillSwitch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "kill-switch")
	ks := New(path)

	// File exists but manual is off
	os.WriteFile(path, []byte(""), 0644)
	if !ks.IsActive() {
		t.Error("file-based should activate kill switch")
	}

	os.Remove(path)
	// Manual engaged but file gone
	ks.Engage()
	if !ks.IsActive() {
		t.Error("manual should activate kill switch even without file")
	}
}

func TestStatus(t *testing.T) {
	ks := New("/nonexistent/path")
	status := ks.Status()

	if status["active"] != false {
		t.Error("status.active should be false")
	}
	if status["file_exists"] != false {
		t.Error("status.file_exists should be false")
	}
	if status["manual_engaged"] != false {
		t.Error("status.manual_engaged should be false")
	}
}
