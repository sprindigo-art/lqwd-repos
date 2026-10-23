import { handleCsvExport } from "@/lib/console/export-handler";

// =====================================================
// NODE-02 — CSV export route: /{pubkey}/{tab}/export?window={key}
// =====================================================
// Thin delegator: the entire validation gauntlet + loadRows dispatch + CSV
// assembly now lives in the shared `handleCsvExport` handler so the redesign's
// static `channels/` and `forwards/` sub-route export segments can reuse the
// exact same NODE-02 path (Pitfall 5). Behavior of `/{pubkey}/{tab}/export` is
// byte-identical to the pre-extraction inline route.

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ pubkey: string; tab: string }> },
) {
  const { pubkey, tab } = await ctx.params;
  return handleCsvExport(req, { pubkey, tab });
}
