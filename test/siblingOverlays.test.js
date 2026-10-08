/* NEW-1 (2026-10-08) — AN OVERLAY ADDED ON ONE PLAN IS AVAILABLE ON EVERY SIBLING PLAN, HIDDEN UNTIL SHOWN.
 *
 * Owner constraint #11 (amended): no site-level store, no migration; a foreign row's eye COPIES the record
 * into THIS plan only. Each block below is one of the eight things the pre-build adversarial review
 * confirmed against the code (main @ 99c87bb) — the id/tombstone one is run through the REAL
 * `mergeSiteContent`, and the pre-fix shape ("copy keeps the sibling's id") is replayed as the mutation
 * check so a green result here cannot be a no-op.
 *
 * The Goose Creek case (four plans sharing ONE site-plan PDF) is computed on a SYNTHETIC set of the same
 * shape — the owner's real plans are never opened by this test. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  offerable, identityKey, overlaySignature, foreignOverlaysFor, makeForeignCopy, planForeignCopy,
  fetchSiblingPlans, siblingPlansAsRefs, siblingsStillHolding, NEVER_COPIED, LEGACY_AERIAL_ID,
} from "../src/workspaces/site-planner/lib/siblingOverlays.js";
import { collectAssetRefs, releasePlanForOverlay } from "../src/workspaces/site-planner/lib/sharedAssetRefs.js";
import { mergeSiteContent } from "../src/workspaces/site-planner/lib/siteModel.js";

const PDF = "u1/site-overlays/A/ov1.pdf";
const ov = (o = {}) => ({
  id: "ov1", name: "Master plan", storageKey: PDF, page: 1, pageCount: 3, imgW: 1000, imgH: 800,
  x: 100, y: 200, ftPerPx: 2, rotation: 15, opacity: 0.85, locked: true, visible: false, kind: "pdf",
  idbKey: "raster:A:overlay:ov1", src: "data:image/png;base64,AAA", strippedForCloud: false, ...o,
});
const plan = (id, name, overlays, extra = {}) => ({ id, name, deletedAt: null, origin: { lat: 29.75, lon: -95.36 }, overlays, ...extra });
let n = 0;
const mint = () => `new${++n}`;

describe("offerable — what may be shown on another plan (rationale 1, 4)", () => {
  it("accepts a stored PDF overlay", () => expect(offerable(ov())).toEqual({ ok: true }));
  it("never the legacy aerial (one fixed id on every plan)", () => expect(offerable(ov({ id: LEGACY_AERIAL_ID })).reason).toBe("legacy-aerial"));
  it("never a map-derived backdrop", () => expect(offerable(ov({ fromMap: true })).reason).toBe("map-backdrop"));
  it("never a record whose object is gone (Woods Road shape)", () => expect(offerable(ov({ storageMissing: true, storageKey: null })).reason).toBe("storage-missing"));
  it("never a local-only record with no storageKey (constraint #11 carve-out)", () => expect(offerable(ov({ storageKey: null })).reason).toBe("no-storage-key"));
  it("the legacy id literal still matches siteModel.js", () => {
    expect(fs.readFileSync("src/workspaces/site-planner/lib/siteModel.js", "utf8")).toContain(`const LEGACY_AERIAL_ID = "${LEGACY_AERIAL_ID}"`);
  });
});

describe("foreignOverlaysFor (rationale 4, 5)", () => {
  it("a sibling's overlay is offered, naming that plan", () => {
    const rows = foreignOverlaysFor({ own: [], siblings: [plan("A", "Concept A", [ov()])], selfId: "B" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ planId: "A", planName: "Concept A", sharedFrom: { siteId: "A", overlayId: "ov1" } });
  });
  it("this plan already holding the same source+page → not offered again", () => {
    const own = [ov({ id: "mine", storageKey: PDF, page: 1 })];
    expect(foreignOverlaysFor({ own, siblings: [plan("A", "Concept A", [ov()])], selfId: "B" })).toEqual([]);
  });
  it("one PDF on page 1 and page 3 is TWO rows (same key, different page)", () => {
    const sib = plan("A", "Concept A", [ov({ id: "p1", page: 1 }), ov({ id: "p3", page: 3 })]);
    const rows = foreignOverlaysFor({ own: [], siblings: [sib], selfId: "B" });
    expect(rows.map((r) => r.overlay.id).sort()).toEqual(["p1", "p3"]);
    // …and holding page 1 leaves only page 3
    const left = foreignOverlaysFor({ own: [ov({ id: "x", page: 1 })], siblings: [sib], selfId: "B" });
    expect(left.map((r) => r.overlay.id)).toEqual(["p3"]);
    expect(identityKey(ov({ page: 1 }))).not.toBe(identityKey(ov({ page: 3 })));
  });
  it("a binned sibling, and this plan itself, are never offered", () => {
    const rows = foreignOverlaysFor({
      own: [], selfId: "B",
      siblings: [plan("A", "Binned", [ov()], { deletedAt: "2026-10-01" }), plan("B", "Me", [ov({ storageKey: "u1/x.pdf" })])],
    });
    expect(rows).toEqual([]);
  });
  it("the same source on two siblings is ONE row", () => {
    const rows = foreignOverlaysFor({ own: [], selfId: "C", siblings: [plan("A", "Concept A", [ov({ id: "a1" })]), plan("B", "Concept B", [ov({ id: "b1" })])] });
    expect(rows).toHaveLength(1);
  });
  it("a plan with no siblings gets no rows", () => expect(foreignOverlaysFor({ own: [ov()], siblings: [], selfId: "B" })).toEqual([]));
  it("a record already copied from that sibling (sharedFrom) is not offered again even if its key later changed", () => {
    const own = [ov({ id: "mine", storageKey: "u1/other.pdf", sharedFrom: { siteId: "A", overlayId: "ov1" } })];
    expect(foreignOverlaysFor({ own, siblings: [plan("A", "Concept A", [ov()])], selfId: "B" })).toEqual([]);
  });
  it("GOOSE CREEK SHAPE: four plans sharing one PDF (Duplicate keeps every id) — no plan gains a row, no list changes", () => {
    const shared = ov({ id: "gc1", storageKey: "u1/site-overlays/GC/master.pdf", idbKey: "raster:GC:overlay:gc1" });
    const lists = { P1: [shared], P2: [{ ...shared }], P3: [{ ...shared }], P4: [{ ...shared }] };
    const before = JSON.stringify(lists);
    const sibs = Object.entries(lists).map(([id, o]) => plan(id, `Plan ${id}`, o));
    for (const self of Object.keys(lists)) {
      expect(foreignOverlaysFor({ own: lists[self], siblings: sibs.filter((p) => p.id !== self), selfId: self })).toEqual([]);
    }
    expect(JSON.stringify(lists)).toBe(before); // read-only: nothing was rewritten
  });
});

describe("makeForeignCopy (rationale 1, 3)", () => {
  const row = foreignOverlaysFor({ own: [], siblings: [plan("A", "Concept A", [ov({ crop: { shape: "rect" }, sourceDwgKey: "u1/d.dwg" })])], selfId: "B" })[0];
  it("fresh id; no cache / pixel / heal fields; stamped; unlocked and visible", () => {
    const c = makeForeignCopy(row, { dx: 5, dy: -3, mint });
    expect(c.id).not.toBe("ov1");
    for (const k of NEVER_COPIED.filter((k) => k !== "id" && k !== "sharedFrom")) expect(c).not.toHaveProperty(k);
    expect(c.sharedFrom).toEqual({ siteId: "A", overlayId: "ov1" });
    expect(c).toMatchObject({ storageKey: PDF, page: 1, x: 105, y: 197, rotation: 15, locked: false, visible: true, crop: { shape: "rect" } });
  });
  it("does not mutate the sibling's record", () => {
    const snap = JSON.stringify(row.overlay);
    makeForeignCopy(row, { dx: 9, dy: 9, mint });
    expect(JSON.stringify(row.overlay)).toBe(snap);
  });
  it("TOMBSTONE: a copy survives the real merge even when the sibling's overlay id is tombstoned here; a copy that KEPT the id vanishes (pre-fix replay)", () => {
    const tombstoned = { id: "B", updatedAt: 2, deletedIds: ["ov1"] };
    const good = mergeSiteContent({ ...tombstoned, sheetOverlays: [makeForeignCopy(row, { mint })] }, { id: "B", updatedAt: 1, sheetOverlays: [] });
    expect(good.sheetOverlays.map((o) => o.storageKey)).toEqual([PDF]);
    const preFix = mergeSiteContent({ ...tombstoned, sheetOverlays: [{ ...row.overlay }] }, { id: "B", updatedAt: 1, sheetOverlays: [] });
    expect(preFix.sheetOverlays).toEqual([]); // the id-keeping copy is stripped — this is the bug the fresh id avoids
  });
});

describe("planForeignCopy (rationale 2, 6, 8)", () => {
  const sibA = plan("A", "Concept A", [ov()]);
  const mkRow = () => foreignOverlaysFor({ own: [], siblings: [sibA], selfId: "B" })[0];
  const okProbe = async () => "ok";
  const run = (over = {}) => planForeignCopy({ foreign: mkRow(), fresh: { ok: true, plans: [sibA] }, selfOrigin: sibA.origin, probe: okProbe, mint, ...over });

  it("same origin: arrives exactly where it sits on the sibling", async () => {
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.overlay).toMatchObject({ x: 100, y: 200 });
  });
  it("different origin: re-framed through resolveClipFrame so it lands on the same GROUND", async () => {
    const r = await run({ selfOrigin: { lat: 29.7502, lon: -95.3598 } });
    expect(r.ok).toBe(true);
    expect(r.overlay.x).not.toBe(100);
    expect(Math.abs(r.overlay.x - 100)).toBeLessThan(2000);
    expect(r.overlay.ftPerPx).toBe(2); // size is never rescaled
  });
  it("frames that cannot be related → refused loudly, nothing returned to place", async () => {
    const r = await run({ selfOrigin: null });
    expect(r).toMatchObject({ ok: false, reason: "no-origin" });
    expect(r.overlay).toBeUndefined();
    const far = await run({ selfOrigin: { lat: 45, lon: -95.36 } });
    expect(far).toMatchObject({ ok: false, reason: "frame-too-far" });
  });
  it("failed fresh fetch → refused (never an empty-list success)", async () => {
    expect(await run({ fresh: { ok: false, error: "boom" } })).toMatchObject({ ok: false, reason: "fetch-failed" });
  });
  it("sibling binned / overlay removed / overlay edited since the list → refused and says refresh", async () => {
    expect(await run({ fresh: { ok: true, plans: [{ ...sibA, deletedAt: "2026-10-08" }] } })).toMatchObject({ ok: false, reason: "plan-gone", refresh: true });
    expect(await run({ fresh: { ok: true, plans: [plan("A", "Concept A", [])] } })).toMatchObject({ ok: false, reason: "overlay-gone", refresh: true });
    expect(await run({ fresh: { ok: true, plans: [plan("A", "Concept A", [ov({ x: 999 })])] } })).toMatchObject({ ok: false, reason: "changed", refresh: true });
  });
  it("an object this account cannot read is refused up front; an unknown probe is not treated as readable", async () => {
    expect(await run({ probe: async () => "missing" })).toMatchObject({ ok: false, reason: "unreadable" });
    expect(await run({ probe: async () => "network" })).toMatchObject({ ok: false, reason: "probe-failed" });
  });
  it("signature covers crop, so a re-crop on the sibling is a change", () => {
    expect(overlaySignature(ov({ crop: { a: 1 } }))).not.toBe(overlaySignature(ov()));
  });
});

function fakeClient(rowsByFilter, { failOn } = {}) {
  const calls = [];
  const writes = [];
  const q = (table) => {
    const f = { table, cols: null, filters: [] };
    const b = {
      select(c) { f.cols = c; return b; },
      eq(col, v) { f.filters.push([col, v]); return b; },
      is(col, v) { f.filters.push([col, "is", v]); return b; },
      then(res, rej) {
        calls.push(f);
        const key = f.filters.map((x) => x[0]).join(",");
        if (failOn && key === failOn) return Promise.resolve({ data: null, error: { message: "rls" } }).then(res, rej);
        return Promise.resolve({ data: rowsByFilter[key] || [], error: null }).then(res, rej);
      },
    };
    for (const w of ["insert", "update", "upsert", "delete", "rpc"]) b[w] = () => { writes.push(w); return b; };
    return b;
  };
  return { from: q, rpc: () => { writes.push("rpc"); }, calls, writes };
}

describe("fetchSiblingPlans — read-only, drift-proof (rationale 5, 7)", () => {
  const row = (id, extra = {}) => ({ id, name: `Plan ${id}`, group_id: "G", deleted_at: null, origin: { lat: 1, lon: 2 }, overlays: [ov()], ...extra });
  it("asks all three ways, merges by id, drops self, flags binned, never writes", async () => {
    const c = fakeClient({ id: [row("G")], group_id: [row("G"), row("S"), row("X", { deleted_at: "2026-10-01" })], "data->>groupId": [row("Y")] });
    const r = await fetchSiblingPlans(c, "G", "S");
    expect(r.ok).toBe(true);
    expect(r.plans.map((p) => p.id).sort()).toEqual(["G", "X", "Y"]);
    expect(r.plans.find((p) => p.id === "X").deletedAt).toBe("2026-10-01");
    expect(c.calls.map((x) => x.filters[0][0]).sort()).toEqual(["data->>groupId", "group_id", "id"]);
    expect(c.calls[0].cols).not.toMatch(/\bdata\b(?!->)/); // never the whole jsonb
    expect(c.writes).toEqual([]);
  });
  it("any failing query → ok:false with the error (not an empty list)", async () => {
    const r = await fetchSiblingPlans(fakeClient({}, { failOn: "group_id" }), "G", "S");
    expect(r).toMatchObject({ ok: false, error: "rls" });
  });
  it("no group → nothing to ask, nothing returned", async () => {
    expect(await fetchSiblingPlans(fakeClient({}), null, "S")).toMatchObject({ ok: true, plans: [] });
  });
  it("the module contains no write call of any kind", () => {
    const src = fs.readFileSync("src/workspaces/site-planner/lib/siblingOverlays.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc|remove)\(/);
  });
});

describe("remove = this plan only; bytes released only when nothing references them (rationale 3)", () => {
  const mine = ov({ id: "copy1", idbKey: undefined, sharedFrom: { siteId: "A", overlayId: "ov1" } });
  const sibs = [plan("A", "Concept A", [ov()])];
  it("a sibling still holding the source keeps BOTH tiers, and the toast can name it", () => {
    const refs = collectAssetRefs([{ id: "B", sheetOverlays: [mine] }, ...siblingPlansAsRefs(sibs)]);
    const v = releasePlanForOverlay(refs, mine, "B");
    expect(v.release).toEqual([]);
    expect(v.shared).toBe(true);
    expect(siblingsStillHolding(mine, sibs, "B")).toEqual(["Concept A"]);
  });
  it("a BINNED sibling still counts as a holder (restorable), but is not named", () => {
    const binned = [plan("A", "Concept A", [ov()], { deletedAt: "2026-10-01" })];
    const v = releasePlanForOverlay(collectAssetRefs([{ id: "B", sheetOverlays: [mine] }, ...siblingPlansAsRefs(binned)]), mine, "B");
    expect(v.release).toEqual([]);
    expect(siblingsStillHolding(mine, binned, "B")).toEqual([]);
  });
  it("nothing else references it → released (cloud object)", () => {
    const v = releasePlanForOverlay(collectAssetRefs([{ id: "B", sheetOverlays: [mine] }]), mine, "B");
    expect(v.release.map((r) => r.key)).toEqual([PDF]);
  });
  it("two copies never share a device cache key (a copy carries none)", () => {
    const row = foreignOverlaysFor({ own: [], siblings: sibs, selfId: "B" })[0];
    const a = makeForeignCopy(row, { mint }), b = makeForeignCopy(row, { mint });
    expect(a.idbKey).toBeUndefined();
    expect(b.idbKey).toBeUndefined();
  });
});

describe("wiring guard — SitePlanner never writes a sibling and releases only after the sibling read", () => {
  const src = fs.readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
  const block = src.slice(src.indexOf("NEW-1 — overlays flow between sibling plans"), src.indexOf("const removeOverlay = (id)"));
  it("the sibling block has no saveSite / push / write", () => {
    expect(block.length).toBeGreaterThan(1000);
    expect(block).not.toMatch(/saveSite\(|pushSiteToCloud|pushModelToCloud|\.update\(|\.upsert\(|\.insert\(/);
  });
  it("removeOverlay releases through the sibling-aware helper, not the local-only ref-count", () => {
    const rm = src.slice(src.indexOf("const removeOverlay = (id)"), src.indexOf("site-plan overlay context-menu ops (B461)"));
    expect(rm).toContain("releaseOverlayAssets(o)");
    expect(rm).not.toContain("collectAssetRefs(loadSitesList())");
  });
});
