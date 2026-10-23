import { TAB_KEYS, WINDOW_PRESETS, type TabKey, type WindowKey } from "@/lib/console/config";

// =====================================================
// D-04 — the SINGLE validated deep-link builder (Phase 4)
// =====================================================
// Pure module: no server runtime imports — test-imported and safe anywhere.
//
// Every card deepLink flows through here (T-04-04 open-redirect / href
// injection): only RELATIVE console-tab paths are produced, built exclusively
// from a validated pubkey + whitelisted tab/window keys. No absolute URLs, no
// protocol, no reflected input. Violations THROW — a detector passing garbage
// is a bug, not user input; fail loud, never sanitize-and-continue.

/** Same pubkey gate as the console page (src/app/(overview)/[pubkey]/[tab]/page.tsx). */
const PUBKEY_RE = /^[0-9a-f]{66}$/;

/** Fleet-scope cards (close-cluster) anchor to the fleet pending page. */
export const FLEET_PENDING_LINK = "/pending";

/**
 * Build a relative console-tab path: `/${pubkey}/${tab}` plus an optional
 * `?window=` whitelist key. Throws on any invalid input BEFORE interpolation.
 */
export function buildDeepLink(pubkey: string, tab: TabKey, window?: WindowKey): string {
  if (!PUBKEY_RE.test(pubkey)) {
    throw new Error(
      `buildDeepLink: invalid pubkey (expected 66 lowercase hex chars, got ${JSON.stringify(
        String(pubkey).slice(0, 80),
      )})`,
    );
  }
  if (!(TAB_KEYS as readonly string[]).includes(tab)) {
    throw new Error(
      `buildDeepLink: tab ${JSON.stringify(String(tab).slice(0, 80))} is not in TAB_KEYS`,
    );
  }
  if (window === undefined) return `/${pubkey}/${tab}`;
  if (!Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, window)) {
    throw new Error(
      `buildDeepLink: window ${JSON.stringify(String(window).slice(0, 80))} is not a WINDOW_PRESETS key`,
    );
  }
  return `/${pubkey}/${tab}?window=${window}`;
}
