"use server";

import { isLlmEnabled } from "@/lib/insight/narrative";

// =====================================================
// narrate-incident — AIX-01 per-incident advisory read (D-12, deterministic-first)
// =====================================================
// The ONLY way the UI triggers a per-incident AI read. A near-verbatim clone of
// narrate.ts's defense-in-depth shell (T-04-21 → T-17-13/T-17-02), substituting
// the incident loader + incident prompt builder + assertAdvisoryOnly post-check:
//   - the hidden button is NOT the gate — isLlmEnabled() re-checks server-side
//     BEFORE any dynamic import, so flag-off runs zero AI SDK code and never
//     touches ANTHROPIC_API_KEY (T-17-14 degrade to absent);
//   - the action NEVER accepts an incident card from the client (a client card
//     would be attacker-controllable prompt input) — it accepts ONLY the KEY and
//     server-recomputes the incident via loadIncidents() (T-17-13), the SAME
//     computation the UI renders (faithfulness invariant AI-SPEC FM-2);
//   - generateText output passes assertAdvisoryOnly before it EVER reaches the
//     operator — a command-shaped read is withheld ({ ok:false }, T-17-02);
//   - any throw degrades to { ok:false } so the deterministic incident card
//     stands alone (FM-5).

/**
 * Incident-key gate: host_id-style identity or "unattributed"/"fleet" (KEY_RE).
 * Validated before any recompute so a malformed id never reaches the loader.
 */
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export type NarrateIncidentResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * AIX-01 — server-gated, server-recomputed advisory read of ONE incident. Returns
 * verbatim advisory prose or { ok:false }; NOTHING here parses model output back
 * into structured data (the read is cosmetic by construction).
 */
export async function narrateIncident(incidentKey: string): Promise<NarrateIncidentResult> {
  // Defense in depth: the env gate is enforced HERE, not by UI visibility. Returning
  // now means NO lazy import below runs — zero SDK code, API key never touched.
  if (!isLlmEnabled()) {
    return { ok: false, error: "LLM narration is disabled (INSIGHT_LLM_ENABLED is not 'true')." };
  }
  if (typeof incidentKey !== "string" || !KEY_RE.test(incidentKey)) {
    return { ok: false, error: "invalid incident id" };
  }
  try {
    // Lazy imports — flag off ⇒ none of this executes. The loader is server-only
    // (warehouse pools + env at module load); the provider resolves its API key
    // only at generation time (T-17-14 / server-only discipline).
    const [
      { loadIncidents },
      { buildIncidentPrompt, INCIDENT_READ_SYSTEM_PROMPT },
      { assertAdvisoryOnly },
      { getModel },
      { generateText },
    ] = await Promise.all([
      import("@/lib/overview/load-incidents"),
      import("@/lib/overview/incident-prompt"),
      import("@/lib/insight/guardrails"),
      import("@/lib/ai/provider"),
      import("ai"),
    ]);

    // Server-recompute: the incident is derived from the loader, NEVER supplied by
    // the client. Selection is by `.key` (GroupedIncident has no `.hostId`).
    const incident = (await loadIncidents()).find((i) => i.key === incidentKey);
    if (!incident) {
      return { ok: false, error: "incident not found" };
    }

    // ai v6: bound the output with `maxOutputTokens` (the legacy key is silently
    // ignored in v6 → unbounded, a DoS surface, T-17-14). System slot holds the
    // fixed advisory contract; the untrusted payload lives in the prompt slot.
    const result = await generateText({
      model: getModel(),
      system: INCIDENT_READ_SYSTEM_PROMPT,
      prompt: buildIncidentPrompt(incident),
      maxOutputTokens: 400,
      temperature: 0.3,
    });

    // Hard gate: a command-shaped read is withheld entirely (T-17-02) — the
    // deterministic incident card stands alone.
    const advisory = assertAdvisoryOnly(result.text);
    if (!advisory.ok) {
      return { ok: false, error: "read withheld: failed advisory-only guardrail" };
    }
    // Verbatim prose out — no parsing, no post-processing into structured data.
    return { ok: true, text: result.text };
  } catch (error) {
    console.error("narrateIncident action failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
