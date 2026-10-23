import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCsvExport } from "@/lib/console/export-handler";

// =====================================================
// handleCsvExport gauntlet tests (NO DB) — CR-02 regression
// =====================================================
// The channels sub-route page emits `/{pubkey}/channels/export?window=latest`
// (a latest-state export). The handler must accept `latest` for the
// latest-state tabs (channels/fees) and keep rejecting it for event tabs —
// with the whole validation gauntlet still ahead of ANY read.

const { latestNodeInfoMock, channelsTabDataMock, feesTabDataMock, executeMock } = vi.hoisted(
  () => ({
    latestNodeInfoMock: vi.fn(),
    channelsTabDataMock: vi.fn(),
    feesTabDataMock: vi.fn(),
    executeMock: vi.fn(),
  }),
);

vi.mock("@/lib/read/node-info", () => ({ latestNodeInfo: latestNodeInfoMock }));
vi.mock("@/lib/console/channels", () => ({ channelsTabData: channelsTabDataMock }));
vi.mock("@/lib/console/fees", () => ({ feesTabData: feesTabDataMock }));
vi.mock("@/lib/db/warehouse-routing", () => ({ dbRouting: { execute: executeMock } }));

// 66 hex chars — must pass the handler's PUBKEY_RE gate.
const PUBKEY = "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907ab";

function req(query: string): Request {
  return new Request(`http://localhost/${PUBKEY}/channels/export${query}`);
}

describe("handleCsvExport ?window=latest (CR-02 regression)", () => {
  beforeEach(() => {
    latestNodeInfoMock.mockReset().mockResolvedValue({ alias: "TestNode", num_peers: 1 });
    channelsTabDataMock.mockReset().mockResolvedValue({ rows: [], asOf: null });
    feesTabDataMock.mockReset().mockResolvedValue({ rows: [], asOf: null });
    executeMock.mockReset();
  });

  it("accepts the exact href the channels page emits (?window=latest) → 200 CSV", async () => {
    const res = await handleCsvExport(req("?window=latest"), { pubkey: PUBKEY, tab: "channels" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    // Provenance/filename honestly label the latest-state export.
    expect(res.headers.get("Content-Disposition")).toContain("latest");
  });

  it("accepts ?window=latest for the fees latest-state tab too", async () => {
    const res = await handleCsvExport(req("?window=latest"), { pubkey: PUBKEY, tab: "fees" });
    expect(res.status).toBe(200);
  });

  it("still rejects ?window=latest for EVENT tabs (forwards) — 404 before any read", async () => {
    const res = await handleCsvExport(req("?window=latest"), { pubkey: PUBKEY, tab: "forwards" });
    expect(res.status).toBe(404);
    expect(latestNodeInfoMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("still rejects an arbitrary non-preset window on latest-state tabs — 404 before any read", async () => {
    const res = await handleCsvExport(req("?window=evil"), { pubkey: PUBKEY, tab: "channels" });
    expect(res.status).toBe(404);
    expect(latestNodeInfoMock).not.toHaveBeenCalled();
  });

  it("keeps accepting a real preset key on latest-state tabs (pre-fix behavior)", async () => {
    const res = await handleCsvExport(req("?window=7d"), { pubkey: PUBKEY, tab: "channels" });
    expect(res.status).toBe(200);
  });
});
