---
name: action-reviewer
description: Review the agent's own past operations from the audit log, identify patterns and failures
---

# Action Reviewer

Review past operations to identify patterns, repeated failures, and areas for improvement.

## Data Sources

### Audit Query (filtered)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/query \
  -d '{"limit": 200}' | jq .
```

Filter options:
- `"endpoint": "payment"` — filter by endpoint
- `"op_type": "payment"` — filter by operation type
- `"errors_only": true` — only failed operations
- `"since": "2026-03-01T00:00:00Z"` — time range start
- `"until": "2026-03-07T23:59:59Z"` — time range end

### Audit Summary (aggregate stats)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/summary \
  -d '{"since": "2026-03-01T00:00:00Z"}' | jq .
```

Returns: total requests, success/error counts, success rate, total spend, endpoint counts, op type counts, budget rejections, recent errors.

## Review Process

1. **Fetch audit summary** for the review period
2. **Identify failure patterns:**
   - Which endpoints fail most often?
   - Are there repeated budget rejections? (suggests limits may need adjustment or agent is being too aggressive)
   - Are there repeated 429 (rate limit) hits? (suggests agent is looping)
   - Are there clusters of errors in time? (suggests a systemic issue)
3. **Analyze spend patterns:**
   - Is daily spend approaching the ceiling?
   - Are rebalance costs justified by routing revenue?
   - Which operations consume the most budget?
4. **Check for anomalies:**
   - Operations at unusual hours
   - Unusually large amounts
   - Repeated identical requests (may indicate stuck retry loops)
5. **Generate self-assessment report**

## Report Format

### Summary
- Period reviewed
- Total operations / success rate
- Total sats spent / daily average

### Failures
- Top failure reasons with counts
- Budget rejections: how many, which endpoints
- Rate limit hits: frequency and timing

### Spend Analysis
- Breakdown by operation type
- Largest single operations
- Trend (increasing/decreasing/stable)

### Recommendations
- Specific actionable suggestions based on patterns found
- Flag any concerning trends for the operator

## Important Rules

- Always fetch fresh data — never summarize from memory
- Present findings objectively — include both positive and negative patterns
- If error rate is above 10%, flag it prominently
- If daily spend is above 80% of ceiling, warn the operator
- Do not make changes based on the review — only report findings and recommendations
