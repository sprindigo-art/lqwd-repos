import { notFound, redirect } from "next/navigation";

// =====================================================
// NODE-04 / D-08 — the v1 tabbed console is RETIRED to a redirect shim
// =====================================================
// The single-scroll Node Detail at /{pubkey} (Plan 13-08) supersedes the v1
// per-tab console. Rather than hard-remove the route (which would 404 every old
// deep-link/bookmark), this validate-then-redirect shim forwards every
// /{pubkey}/{tab} hit to the canonical /{pubkey} detail (CONTEXT Claude's-
// Discretion — the redirect-shim option, chosen to keep old links working).
//
// LOAD-BEARING (Pitfall 5 / T-13-08-03): the sibling `[tab]/export/route.ts` is a
// LIVE NODE-02 CSV read path. Retiring this page touches ONLY page.tsx — the
// export route segment stays reachable and is deliberately left untouched.
//
// ASVS V5 (T-13-08-01): the pubkey segment is regex-validated BEFORE the redirect —
// a non-66-hex param 404s without producing a bogus redirect target. The `tab`
// segment needs no whitelist here: any tab value forwards to the single-scroll
// detail, which owns its own validation.

const PUBKEY_RE = /^[0-9a-f]{66}$/;

interface PageProps {
  params: Promise<{ pubkey: string; tab: string }>;
}

export default async function NodeConsoleTabRedirect({ params }: PageProps) {
  const { pubkey } = await params;
  // Validate BEFORE anything. Invalid shape → 404, no redirect.
  if (!PUBKEY_RE.test(pubkey)) notFound();

  redirect(`/${pubkey}`);
}
