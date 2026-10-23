"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { refreshData } from "@/app/actions/refresh";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// RefreshControl — SSR-safe, HONEST top-bar refresh island
// =====================================================
// Mounted in NavRailShell's top bar (every page), beside the PollAge "data as of"
// stamp. A manual Refresh button plus an "Auto · 60s" toggle let the operator pull
// fresh data on demand instead of waiting out the 20s memo TTL.
//
// SSR-SAFETY (load-bearing): this island lives inside NavRailShell, whose locked
// 23-test suite renders the whole shell via renderToStaticMarkup with NO router
// context. `useRouter()` THROWS under static markup — so it is NOT used here. The
// route re-renders purely because refreshData() calls revalidatePath("/","layout")
// inside the client transition: invoking a server action in a transition makes Next
// re-fetch the current route's RSC payload. Only SSR-safe hooks are used
// (useTransition / useState / useEffect — the same set PollAge renders cleanly).
//
// HONESTY (D-R7): the copy states it re-reads the WAREHOUSE and explicitly does NOT
// force a node collection (collectors tick on their own ~5-min cadence). It never
// implies it pokes a node.

/** localStorage key persisting the auto-refresh toggle across navigation. */
const AUTO_STORAGE_KEY = "nodemon.autoRefresh";
/** Auto-refresh cadence — a 60s floor (T-QR-01: no amplification). */
const AUTO_INTERVAL_MS = 60_000;

/** The single honest tooltip — re-read framing + the explicit collection negation. */
const REFRESH_TITLE =
  "Re-reads the warehouse now. Collectors tick on their own (~5 min); this does not force a node collection.";
const AUTO_TITLE =
  "Auto-refresh re-reads the warehouse every 60s. It does not force a node collection.";

// ─────────────────────────────────────────────────────────────────────
// Auto-refresh toggle, modelled as an EXTERNAL STORE (localStorage).
// ─────────────────────────────────────────────────────────────────────
// Previously this hydrated via a mount effect that called setAutoOn()
// synchronously, which React 19 flags: a synchronous setState inside an effect
// cascades an extra render pass on every mount. localStorage is genuinely an
// external store, so useSyncExternalStore is the sanctioned primitive — and its
// getServerSnapshot keeps this SSR-safe, which is load-bearing here (NavRailShell's
// locked suite renders this island through renderToStaticMarkup).
const autoListeners = new Set<() => void>();

function subscribeAuto(onChange: () => void): () => void {
  autoListeners.add(onChange);
  // `storage` fires for OTHER tabs; the local Set covers this one.
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    autoListeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

function getAutoSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_STORAGE_KEY) === "true";
}

/** SSR always renders OFF; the client corrects on hydration. */
function getAutoServerSnapshot(): boolean {
  return false;
}

function writeAuto(on: boolean): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTO_STORAGE_KEY, on ? "true" : "false");
  }
  autoListeners.forEach((l) => l());
}

/** `defaultPending` is a TEST-ONLY hook to force the pending visual under SSR. */
export function RefreshControl({ defaultPending = false }: { defaultPending?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const autoOn = useSyncExternalStore(subscribeAuto, getAutoSnapshot, getAutoServerSnapshot);

  // Real pending OR the test-only forced-pending flag drives disabled + spin.
  const pending = isPending || defaultPending;

  const runRefresh = (): void => {
    startTransition(async () => {
      await refreshData();
    });
  };

  // Persist the toggle + drive the 60s interval. The cleanup clears the interval so
  // both turning OFF and unmounting stop the timer (no leak — mirrors PollAge).
  useEffect(() => {
    // Persistence now lives in writeAuto() (the store's setter), so this effect
    // only owns the interval.
    if (!autoOn) return;
    const id = setInterval(() => {
      startTransition(async () => {
        await refreshData();
      });
    }, AUTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoOn]);

  return (
    <div className="flex items-center gap-2" data-testid="refresh-control">
      {/* Manual re-read — matches the top-bar pill chrome. */}
      <button
        type="button"
        onClick={runRefresh}
        disabled={pending}
        aria-label="Refresh data"
        title={REFRESH_TITLE}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-df-btn border border-df-border bg-df-surface px-3 py-[7px]",
          "font-df-mono text-[11px] text-df-muted transition-colors",
          "hover:text-df-ink disabled:cursor-not-allowed disabled:opacity-60",
          FOCUS_RING,
        )}
      >
        <RefreshCw
          className={cn("size-3.5", pending && "animate-spin")}
          strokeWidth={2}
          aria-hidden="true"
        />
        Refresh
      </button>

      {/* Auto toggle — navy STRUCTURAL chrome when ON (df-chrome, never a health hue). */}
      <button
        type="button"
        role="switch"
        aria-pressed={autoOn}
        aria-label="Auto-refresh every 60 seconds"
        title={AUTO_TITLE}
        onClick={() => writeAuto(!autoOn)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-df-btn border px-3 py-[7px]",
          "font-df-mono text-[11px] transition-colors",
          FOCUS_RING,
          autoOn
            ? "border-df-chrome bg-df-chrome text-white"
            : "border-df-border bg-df-surface text-df-muted hover:text-df-ink",
        )}
      >
        <span
          className={cn("size-1.5 rounded-full", autoOn ? "bg-white" : "bg-df-faint")}
          aria-hidden="true"
        />
        Auto · 60s
      </button>
    </div>
  );
}
