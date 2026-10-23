package lnd

import (
	"context"
	"encoding/json"
	"fmt"
)

// Executor dispatches confirmed operations to the appropriate LND client method.
// Used by ConfirmOperation to execute the real LND call after admin approval.
type Executor struct {
	client Client
}

// NewExecutor creates an Executor wrapping the given Client.
func NewExecutor(client Client) *Executor {
	return &Executor{client: client}
}

// Execute parses the stored request body and routes to the correct LND call
// based on the endpoint string from the PendingOp.
func (e *Executor) Execute(ctx context.Context, endpoint, requestBody string) (map[string]any, error) {
	switch endpoint {
	case "/v1/channels/open":
		var req OpenChannelRequest
		if err := json.Unmarshal([]byte(requestBody), &req); err != nil {
			return nil, fmt.Errorf("unmarshal open channel request: %w", err)
		}
		return e.client.OpenChannel(ctx, req)

	case "/v1/channels/close":
		var req CloseChannelRequest
		if err := json.Unmarshal([]byte(requestBody), &req); err != nil {
			return nil, fmt.Errorf("unmarshal close channel request: %w", err)
		}
		return e.client.CloseChannel(ctx, req)

	case "/v1/onchain/send":
		var req SendCoinsRequest
		if err := json.Unmarshal([]byte(requestBody), &req); err != nil {
			return nil, fmt.Errorf("unmarshal send coins request: %w", err)
		}
		return e.client.SendCoins(ctx, req)

	case "/v1/payments/send":
		var req SendPaymentRequest
		if err := json.Unmarshal([]byte(requestBody), &req); err != nil {
			return nil, fmt.Errorf("unmarshal send payment request: %w", err)
		}
		return e.client.SendPayment(ctx, req)

	case "/v1/rebalance":
		var req RebalanceRequest
		if err := json.Unmarshal([]byte(requestBody), &req); err != nil {
			return nil, fmt.Errorf("unmarshal rebalance request: %w", err)
		}
		return e.client.Rebalance(ctx, req)

	default:
		return nil, fmt.Errorf("unknown endpoint for execution: %s", endpoint)
	}
}
