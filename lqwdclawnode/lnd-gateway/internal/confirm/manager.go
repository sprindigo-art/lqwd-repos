// Package confirm manages the two-phase confirmation flow for destructive operations.
// Only the admin token can execute confirmations — the agent token cannot.
package confirm

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// PendingOp represents a destructive operation awaiting human confirmation.
type PendingOp struct {
	ID          string    `json:"operation_id"`
	Endpoint    string    `json:"endpoint"`
	Description string    `json:"description"`
	RequestBody string    `json:"request_body"`
	AmountSats  int64     `json:"amount_sats,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// Manager stores pending operations and handles confirmation/rejection.
type Manager struct {
	mu       sync.RWMutex
	pending  map[string]*PendingOp
	expiryDur time.Duration
}

// New creates a confirmation manager with the given expiry duration.
func New(expirySeconds int) *Manager {
	m := &Manager{
		pending:   make(map[string]*PendingOp),
		expiryDur: time.Duration(expirySeconds) * time.Second,
	}
	// Start background cleanup goroutine
	go m.cleanupLoop()
	return m
}

// Create registers a new pending operation. Returns the operation for the agent to display.
func (m *Manager) Create(endpoint, description, requestBody string, amountSats int64) *PendingOp {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := generateID()
	now := time.Now().UTC()

	op := &PendingOp{
		ID:          id,
		Endpoint:    endpoint,
		Description: description,
		RequestBody: requestBody,
		AmountSats:  amountSats,
		CreatedAt:   now,
		ExpiresAt:   now.Add(m.expiryDur),
	}
	m.pending[id] = op
	return op
}

// Confirm retrieves and removes a pending operation for execution.
// Returns nil if not found or expired.
func (m *Manager) Confirm(id string) *PendingOp {
	m.mu.Lock()
	defer m.mu.Unlock()

	op, ok := m.pending[id]
	if !ok {
		return nil
	}

	if time.Now().After(op.ExpiresAt) {
		delete(m.pending, id)
		return nil
	}

	delete(m.pending, id)
	return op
}

// Reject removes a pending operation without executing.
func (m *Manager) Reject(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	_, ok := m.pending[id]
	if ok {
		delete(m.pending, id)
	}
	return ok
}

// List returns all currently pending operations (not expired).
func (m *Manager) List() []*PendingOp {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now()
	var ops []*PendingOp
	for _, op := range m.pending {
		if now.Before(op.ExpiresAt) {
			ops = append(ops, op)
		}
	}
	return ops
}

// Count returns the number of pending operations.
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.pending)
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		m.mu.Lock()
		now := time.Now()
		for id, op := range m.pending {
			if now.After(op.ExpiresAt) {
				delete(m.pending, id)
			}
		}
		m.mu.Unlock()
	}
}

func generateID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		// Extremely unlikely — fall back to timestamp
		return fmt.Sprintf("op_%d", time.Now().UnixNano())
	}
	return "op_" + hex.EncodeToString(b)
}
