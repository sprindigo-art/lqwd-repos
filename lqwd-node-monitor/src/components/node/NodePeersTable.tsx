import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LiquidityGauge } from "@/components/node/LiquidityGauge";
import { FLAP_COUNT_LIFETIME_NOTE, type PeerRowView } from "@/lib/console/peers";
import type { PeerLiquiditySplit } from "@/lib/read/liquidity-split";
import { cn } from "@/lib/utils";

// =====================================================
// NodePeersTable — the G1/G2/G4 channel-partner table (Server)
// =====================================================
// The peers sub-route's body: ONE row per channel counterparty (from the
// sanctioned `peersTabData`, never the cumulative lnd_node_peer_info lifetime log),
// each carrying a per-peer capacity-weighted LiquidityGauge (G4, size="sm") built
// from that peer's REAL channel local/remote sats — honest-empty when the peer has
// no derivable channel liquidity, never a fabricated centred bar.
//
// INTERCONNECTION (G2): the Partner cell links to /{pubkey}/channels?peer={remote}
// — the peer→channels edge of the one connected graph. The link is NAVY STRUCTURAL
// (df-brand), never a severity hue: navigation is structure/action, not health.
//
// FOCUS: when `focus === remotePubkey` (an incoming ?focus=peer), that row gets a
// NEUTRAL highlight (df-border-soft) — never a severity/navy fill, since being the
// focused row is navigation state, not a health signal.
//
// HONESTY: flapcount is LIFETIME-cumulative — surfaced with FLAP_COUNT_LIFETIME_NOTE
// as its title, never labelled "recent". Capacity/share render via AFM-002
// (totalCapacityDisplay is pre-formatted; the gauge formats its own sats/percent) —
// no inline sat math here. Server Component: serializable props only, no reads.

/** Short mono pubkey (first 8 · last 4). */
function truncatePubkey(pubkey: string): string {
  return pubkey.length <= 14 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

const COLUMNS: readonly { label: string; align: "left" | "right" }[] = [
  { label: "Partner", align: "left" },
  { label: "Alias", align: "left" },
  { label: "Channels", align: "right" },
  { label: "Capacity", align: "right" },
  { label: "Liquidity", align: "left" },
  { label: "Flaps", align: "right" },
];

export interface NodePeersTableProps {
  /** The owning node pubkey (66-hex) — the base of every peer→channels link. */
  pubkey: string;
  /** The channel-partner rows for the current page (already paginated). */
  rows: PeerRowView[];
  /** peerPubkey → per-peer capacity-weighted split feeding that row's gauge. */
  liquidityByPeer: Map<string, PeerLiquiditySplit>;
  /** An incoming ?focus peer — its row gets the neutral highlight when present. */
  focus?: string;
  /** Reference "now" (API parity with the other node tables); unused here. */
  now?: Date;
}

/**
 * The channel-partner table: per-peer liquidity gauges + peer→channels links.
 * Honest-empty copy when there are no partners; the focused row (if any) gets a
 * neutral highlight. Server-safe — consumes only serializable props.
 */
export function NodePeersTable({ pubkey, rows, liquidityByPeer, focus }: NodePeersTableProps) {
  // Honest empty state — no fabricated rows.
  if (rows.length === 0) {
    return (
      <div className="rounded-df-card border border-df-border bg-df-surface px-4 py-8 text-center">
        <p className="font-df-sans text-[15.5px] font-semibold text-df-ink">
          No channel partners to show.
        </p>
        <p className="mt-1 font-df-sans text-[13px] text-df-muted">
          This node has no active channel counterparties yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-df-border hover:bg-transparent">
            {COLUMNS.map((col) => (
              <TableHead
                key={col.label}
                className={cn(
                  "font-df-mono text-[10.5px] font-bold tracking-[0.06em] text-df-muted uppercase",
                  col.align === "right" && "text-right",
                )}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isFocused = focus !== undefined && focus === row.remotePubkey;
            const split = liquidityByPeer.get(row.remotePubkey);
            return (
              <TableRow
                key={row.remotePubkey}
                data-focused={isFocused ? "true" : undefined}
                className={cn(
                  "border-df-border-soft align-top",
                  // Focus highlight — NEUTRAL (df-border-soft), never a severity hue.
                  isFocused && "bg-df-border-soft",
                )}
              >
                {/* Partner — mono truncated pubkey, links to that peer's channels (G2). */}
                <TableCell className="py-3">
                  <Link
                    href={`/${pubkey}/channels?peer=${row.remotePubkey}`}
                    className="font-df-mono text-[12px] text-df-brand hover:underline"
                    data-testid="peer-channels-link"
                  >
                    {truncatePubkey(row.remotePubkey)}
                  </Link>
                </TableCell>

                {/* Alias — honest dash when peer_info carries none. */}
                <TableCell className="font-df-sans text-[13px] text-df-ink">
                  {row.alias === null || row.alias === "" ? (
                    <span className="text-df-muted">—</span>
                  ) : (
                    row.alias
                  )}
                </TableCell>

                {/* Channels to this partner. */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-ink">
                  {row.channelCount.toLocaleString("en-US")}
                </TableCell>

                {/* Capacity — pre-formatted (AFM-002) by the read shaper. */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-ink">
                  {row.totalCapacityDisplay} sat
                </TableCell>

                {/* Per-peer capacity-weighted liquidity gauge (G4, sm). Honest-empty
                    when the peer has no derivable channel local/remote split. */}
                <TableCell>
                  <LiquidityGauge
                    size="sm"
                    localSat={split?.localSat ?? 0}
                    remoteSat={split?.remoteSat ?? 0}
                    capacitySat={split?.capacitySat ?? 0}
                    localShare={split?.localShare ?? null}
                  />
                </TableCell>

                {/* Flap count — LIFETIME-cumulative, labelled honestly (never "recent"). */}
                <TableCell className="text-right font-df-mono text-[11.5px] tabular-nums text-df-muted">
                  {row.flapCountLifetime === null ? (
                    <span className="text-df-muted">—</span>
                  ) : (
                    <span title={FLAP_COUNT_LIFETIME_NOTE}>
                      {row.flapCountLifetime.toLocaleString("en-US")}
                      <span className="ms-1 text-[10px] text-df-muted">lifetime</span>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
