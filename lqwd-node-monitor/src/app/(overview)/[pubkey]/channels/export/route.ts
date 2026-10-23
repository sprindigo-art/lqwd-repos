import { handleCsvExport } from "@/lib/console/export-handler";

// =====================================================
// NODE-02 — channels CSV export: /{pubkey}/channels/export?window={key}
// =====================================================
// The new static `channels/` sub-route folder (Task 1) shadows the dynamic
// `[tab]/export` route for the channels tab, so this segment restores the
// NODE-02 path. Thin delegator: the full validation gauntlet + loadRows dispatch
// + CSV assembly live in the shared `handleCsvExport` handler (Pitfall 5);
// behavior of `/{pubkey}/channels/export` is byte-identical to the legacy route.

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ pubkey: string }> },
) {
  const { pubkey } = await ctx.params;
  return handleCsvExport(req, { pubkey, tab: "channels" });
}
