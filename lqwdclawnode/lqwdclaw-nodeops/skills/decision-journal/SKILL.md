---
name: decision-journal
description: Record and review reasoning for significant node management decisions
---

# Decision Journal

After significant actions, record the reasoning and context. Periodically review whether past decisions were correct.

## When to Record

Record a journal entry after any of these:
- Channel open or close (or recommendation to do so)
- Fee policy change
- Rebalance execution
- Budget limit hit that changed behavior
- Operator override of a recommendation

## Recording a Decision

After a significant action, create a structured journal entry and report it to the operator:

### Entry Format
```
Decision: [What was decided]
Context: [What data informed the decision]
Reasoning: [Why this choice over alternatives]
Expected outcome: [What we expect to happen]
Risk: [What could go wrong]
```

### Example
```
Decision: Raised fees on channel 850000000000000001 from 100ppm to 250ppm
Context: Channel has 90% outbound flow ratio, top 3 by routing volume, local balance at 15%
Reasoning: High demand channel with depleting local balance. Higher fees will slow drain and increase revenue per forward.
Expected outcome: Reduced drain rate, higher fee revenue per forward, slightly lower volume
Risk: May lose some routing traffic to competitors with lower fees on parallel paths
```

## Reviewing Past Decisions

Periodically (weekly), review recent decisions against actual outcomes:

### 1. Fetch recent audit data
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/query \
  -d '{"since": "<7_days_ago>", "limit": 200}' | jq .
```

### 2. Compare expectations vs reality
For each recorded decision:
- Did the expected outcome materialize?
- Were there unexpected side effects?
- Would we make the same decision again with hindsight?

### 3. Extract lessons
- Which types of decisions tend to work well?
- Which types tend to have unexpected consequences?
- Are there patterns in the data we're missing?

## Review Report Format

### Decisions Reviewed: X

For each decision:
- **Decision**: [summary]
- **Expected**: [what we thought would happen]
- **Actual**: [what happened]
- **Assessment**: Correct / Partially correct / Incorrect
- **Lesson**: [what to do differently next time, if anything]

### Overall Accuracy
- Decisions reviewed: X
- Correct: Y (Z%)
- Key lessons learned

## Important Rules

- Record decisions immediately after making them — context fades quickly
- Be honest in assessments — the goal is to improve, not to look good
- Include the data that informed each decision so reviews can verify the data was correct
- If a pattern of incorrect decisions emerges, recommend adjusting the approach to the operator
- This skill only records and reviews — it does not make or change decisions
