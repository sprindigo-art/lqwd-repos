"use server";

import { revalidatePath } from "next/cache";

import { clearOverviewCache } from "@/lib/overview/overview-cache";

// =====================================================
// refresh — QUICK-REFRESH on-demand warehouse re-read
// =====================================================
// The ONLY thing this does is bust the dashboard's in-process 20s overview READ
// cache and revalidate the route, so the operator can pull fresh data without
// waiting out the TTL + browser round-trip. It is honest by construction: it
// refreshes the dashboard's READ of the warehouse — it does NOT trigger the node
// collectors (they tick on their own ~5-min cadence) and never pokes a node. It
// takes NO client input (nothing to tamper), writes to NEITHER the warehouses nor
// the nodemon queue (only the read memo is affected), and logs nothing sensitive.

/**
 * Bust the overview 20s read cache + revalidate the app-router tree so the next
 * render re-runs the warehouse reads. Re-reads only — does NOT force a node
 * collection. No input, returns void.
 */
export async function refreshData(): Promise<void> {
  clearOverviewCache();
  // `"/", "layout"` revalidates the whole app-router subtree (every NavRailShell
  // page), so a Refresh from any surface re-reads on the next render.
  revalidatePath("/", "layout");
}
