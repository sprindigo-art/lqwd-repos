import { handleCsvExport } from "@/lib/console/export-handler";

// =====================================================
// NODE-02 — forwards CSV export: /{pubkey}/forwards/export?window={key}
// =====================================================
// Once `forwards/` became a STATIC sub-route folder (G1), the dynamic
// `[tab]/export` route no longer resolves for tab=forwards — this sibling static
// export segment restores that path (Pitfall 5). Thin delegator: the whole
// validation gauntlet (PUBKEY_RE → 404, EXPORTABLE_TABS membership → 404,
// WINDOW_PRESETS key → 404) + loadRows dispatch + CSV assembly live in the shared
// `handleCsvExport` handler, so `/{pubkey}/forwards/export` stays byte-identical to
// the legacy dynamic route. `tab` is pinned to "forwards" (never from the URL); the
// `?window` param is validated inside the shared handler.

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await ctx.params;
  return handleCsvExport(req, { pubkey, tab: "forwards" });
}
