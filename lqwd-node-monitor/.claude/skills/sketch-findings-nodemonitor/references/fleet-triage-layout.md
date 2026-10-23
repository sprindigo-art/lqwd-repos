# Fleet Triage Layout

## Design Decisions
- **Attention Queue won** over a status-tile wall (B) and a severity-ranked table (C). The fleet page is triage-first: an incident-feed panel ("Needs attention") on top, sorted critical → warn → stale then ascending composite pct; healthy nodes compress into a collapsible compact grid below ("Healthy fleet" panel with a Collapse / Show N nodes toggle).
- Each queue row: 4px severity edge bar · alias + backend badge · large grade chip · breach/degraded label with a one-line mono "why" (e.g. "4 force closes in the last hour · 11 channels in limbo") · right-aligned meta slot (pending count, `fresh 2m`).
- The triage strip stays above everything in all layouts: Critical / Warn / Healthy / Stale data / Pending → (pending block links to /pending, number in navy).
- Tier-1 breaches render as plain uppercase mono text in critical red (`CLOSE STORM`, `UNREACHABLE`) — **no emoji, no icons**. Warn-level nodes show lowercase `degraded`; stale shows `stale telemetry`.
- Severity color appears ONLY on state (edge bars, grade chips, breach text, strip numbers). Navy `#1A3C79` does all structural work (active tabs, links, focus, selection).
- Masthead: `LQWD / Node Operations` in Saira Semi Condensed uppercase, with `routing_vm · as of {time}` right-aligned in mono faint.

## CSS Patterns
```css
/* Queue row: severity edge + 4-column body */
.queue-row { display: grid; grid-template-columns: 4px 1fr; cursor: pointer; }
.queue-row .edge { border-radius: 2px; margin: 6px 0; }       /* bg = severity color */
.qbody {
  display: grid; grid-template-columns: 200px 56px 1fr 130px; gap: 16px;
  align-items: center; padding: 12px 16px; transition: background .15s ease;
}
.queue-row:hover .qbody { background: var(--color-surface-2); }

/* Breach text — plain words, never emoji */
.breach {
  font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600;
  color: var(--color-critical); text-transform: uppercase; letter-spacing: .06em;
}
.breach + .breach::before { content: " · "; color: var(--color-text-faint); }

/* Healthy compact card */
.hcard { display: flex; justify-content: space-between; align-items: center;
  background: var(--color-surface-2); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); padding: 8px 12px; }
.healthy-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }

/* Triage strip block */
.tstat { flex: 1; background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); padding: 12px 16px; }
.tstat .n { font-family: var(--font-mono); font-size: var(--text-2xl); font-weight: 600; } /* colored by state */
.tstat .l { font-family: var(--font-mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em; }
```

## HTML Structures
```html
<div class="panel">          <!-- Needs attention -->
  <div class="panel-head"><span>Needs attention</span><span>7 of 20 nodes</span></div>
  <div class="queue-row critical">
    <div class="edge"></div>
    <div class="qbody">
      <div class="qalias"><span class="a">LQWD-Brazil</span><span class="backend">lnd</span></div>
      <div class="qgrade"><!-- grade chip --></div>
      <div class="qwhy"><span class="breach">close storm</span>
        <div class="qdims">4 force closes in the last hour · 11 channels in limbo</div></div>
      <div class="qmeta">11 pending<br>fresh 2m</div>
    </div>
  </div>
</div>
<div class="panel">          <!-- Healthy fleet, collapsible -->
  <div class="panel-head"><span>Healthy fleet</span><button>Collapse</button></div>
  <div class="healthy-grid"><!-- hcard per node: short alias + grade chip --></div>
</div>
```

## What to Avoid
- **Status-tile wall (variant B, rejected):** the whole-fleet tile grid looked impressive but buried the critical rows among 20 tiles — slower to triage.
- **Uniform severity table (variant C, rejected):** densest, but reproduced the old "everything looks the same" problem; per-dimension columns added noise the queue's "why" line answers better.
- Red/amber emoji or dot indicators anywhere — explicitly rejected by the operator in the Phase 3 gate.
- Percentages in fleet rows — the grade chip + tooltip carries it.

## Origin
Synthesized from sketch: 001 (winner A)
Source: sources/001-fleet-triage-board.html
