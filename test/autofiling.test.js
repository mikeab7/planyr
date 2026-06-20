import { describe, it, expect } from "vitest";
import { toFactsRow, factsRowToPatch, mergeFactsIntoReviews } from "../src/workspaces/doc-review/lib/fileIndex.js";
import { encodeProjects, interpretResponse, autofile, createAutofilingProvider } from "../src/workspaces/doc-review/lib/autofiling.js";

const placementIn = { captured: true, embeddedCoords: { present: false, crs: null }, scaleBar: { present: true, drawnLenPx: null, realLenFt: null }, statedScale: { present: true, text: "1\"=40'", feetPerInch: 40 }, northArrow: { present: true, orientationDeg: null }, boundary: { present: true }, dimensions: [{ valueFt: 240, label: "240'", p1: null, p2: null }] };

describe("fileIndex.toFactsRow — server facts → one DB row (B270)", () => {
  it("maps to snake_case columns with a complete placement object", () => {
    const row = toFactsRow({ projectId: "g1", discipline: "Civil", item: "GRADING PLAN", sheetNumber: "C-2.01", revision: "IFC", docDate: "2026-06-20", matchConfidence: 0.92, needsFiling: false, placement: placementIn }, { id: "rv1", reviewId: "rv1", sourceFile: "sheet.pdf" });
    expect(row).toMatchObject({ id: "rv1", review_id: "rv1", project_id: "g1", discipline: "Civil", sheet_number: "C-2.01", revision: "IFC", doc_date: "2026-06-20", needs_filing: false, source_file: "sheet.pdf" });
    expect(row.match_confidence).toBe(0.92);
    expect(row.placement.captured).toBe(true);
    expect(row.placement.statedScale.feetPerInch).toBe(40);
  });
  it("defaults a missing placement to the safe empty shape (never undefined)", () => {
    const row = toFactsRow({ projectId: null, needsFiling: true }, { id: "rv2" });
    expect(row.needs_filing).toBe(true);
    expect(row.placement.captured).toBe(false);
    expect(row.placement.dimensions).toEqual([]);
  });
});

describe("fileIndex.mergeFactsIntoReviews — surface captured facts on review rows", () => {
  const reviews = [{ id: "rv1", title: "A" }, { id: "rv2", title: "B" }];
  it("attaches placement/needs-filing to the matching review, leaves others untouched", () => {
    const rows = [toFactsRow({ projectId: "g1", needsFiling: false, placement: placementIn }, { id: "rv1", reviewId: "rv1" })];
    const merged = mergeFactsIntoReviews(reviews, rows);
    expect(merged[0].placement.captured).toBe(true);
    expect(merged[0].needsFiling).toBe(false);
    expect(merged[1]).toEqual({ id: "rv2", title: "B" }); // no fact → unchanged
  });
  it("no facts at all → reviews returned unchanged (degrades cleanly)", () => {
    expect(mergeFactsIntoReviews(reviews, [])).toBe(reviews);
  });
  it("newest fact row wins for a review", () => {
    const older = { ...toFactsRow({ needsFiling: true }, { id: "rv1", reviewId: "rv1" }), updated_at: "2026-06-01T00:00:00Z" };
    const newer = { ...toFactsRow({ needsFiling: false }, { id: "rv1b", reviewId: "rv1" }), updated_at: "2026-06-20T00:00:00Z" };
    const merged = mergeFactsIntoReviews([{ id: "rv1" }], [older, newer]);
    expect(merged[0].needsFiling).toBe(false);
  });
  it("factsRowToPatch reads needs_filing + sheet fields", () => {
    const p = factsRowToPatch({ needs_filing: true, sheet_number: "C-2.01", sheet_title: "GRADING", match_confidence: 0.4, placement: placementIn });
    expect(p).toMatchObject({ needsFiling: true, sheetNumber: "C-2.01", sheetTitle: "GRADING", matchConfidence: 0.4 });
    expect(p.placement.captured).toBe(true);
  });
});

describe("autofiling.encodeProjects — small base64 header round-trip", () => {
  it("trims to id/name/aliases and base64-encodes JSON", () => {
    const enc = encodeProjects([{ id: "g1", name: "Katy Grand", status: "active", extra: 1 }, { name: "no id — dropped" }]);
    const decoded = JSON.parse(Buffer.from(enc, "base64").toString("utf-8"));
    expect(decoded).toEqual([{ id: "g1", name: "Katy Grand", aliases: undefined }]);
  });
});

describe("autofiling.interpretResponse — skip vs read vs error (no silent failure)", () => {
  it("404/503 → graceful skip (backend dormant), not an error", () => {
    expect(interpretResponse(503, { error: "off" })).toMatchObject({ ok: false, skipped: true });
    expect(interpretResponse(404, {})).toMatchObject({ ok: false, skipped: true });
  });
  it("200 ok → a real read", () => {
    const r = interpretResponse(200, { ok: true, decision: { matched: true }, placement: placementIn, facts: { projectId: "g1" } });
    expect(r.ok).toBe(true);
    expect(r.decision.matched).toBe(true);
  });
  it("other non-2xx → a visible error (not a silent skip)", () => {
    const r = interpretResponse(422, { error: "couldn't read" });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(false);
    expect(r.error).toMatch(/couldn't read/);
  });
});

describe("autofiling.autofile — posts to the proxy with auth + projects header", () => {
  const decision = { matched: true, projectId: "g1", discipline: "Civil", item: "GRADING PLAN", docDate: "2026-06-20", needsFiling: false };
  it("returns the decision on a real read; sends the bearer token + projects header", async () => {
    let sent;
    const fetchImpl = async (url, opts) => { sent = { url, opts }; return { status: 200, json: async () => ({ ok: true, decision, placement: placementIn, facts: { projectId: "g1" } }) }; };
    const r = await autofile(new Uint8Array([1, 2]), [{ id: "g1", name: "Katy Grand" }], { fetchImpl, getToken: async () => "tok" });
    expect(r.ok).toBe(true);
    expect(r.decision.projectId).toBe("g1");
    expect(sent.opts.headers.authorization).toBe("Bearer tok");
    expect(sent.opts.headers["x-planyr-projects"]).toBeTruthy();
  });
  it("no session token → graceful skip (never posts)", async () => {
    let called = false;
    const r = await autofile(new Uint8Array([1]), [], { fetchImpl: async () => { called = true; return { status: 200, json: async () => ({}) }; }, getToken: async () => null });
    expect(r.skipped).toBe(true);
    expect(called).toBe(false);
  });
  it("a 503 from a not-yet-deployed proxy → skip", async () => {
    const r = await autofile(new Uint8Array([1]), [], { fetchImpl: async () => ({ status: 503, json: async () => ({ error: "DOC_FILING_URL unset" }) }), getToken: async () => "tok" });
    expect(r).toMatchObject({ ok: false, skipped: true });
  });
});

describe("autofiling provider — honest backendReady gating (B270)", () => {
  it("disabled (default) → backendReady false, autofile skips, never calls the network", async () => {
    let called = false;
    const p = createAutofilingProvider({ enabled: false, fetchImpl: async () => { called = true; return { status: 200, json: async () => ({}) }; }, getToken: async () => "tok" });
    expect(p.backendReady).toBe(false);
    const r = await p.autofile(new Uint8Array([1]), []);
    expect(r.skipped).toBe(true);
    expect(called).toBe(false);
    // capturePlacementFacts still returns the safe empty shape via the stub path
    const pf = await p.capturePlacementFacts(new Uint8Array([1]));
    expect(pf.captured).toBe(false);
  });
  it("enabled → backendReady true; capturePlacementFacts merges the SAME read's placement", async () => {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ ok: true, decision: { matched: true }, placement: placementIn, facts: {} }) });
    const p = createAutofilingProvider({ enabled: true, fetchImpl, getToken: async () => "tok" });
    expect(p.backendReady).toBe(true);
    const pf = await p.capturePlacementFacts(new Uint8Array([1]));
    expect(pf.captured).toBe(true);
    expect(pf.statedScale.feetPerInch).toBe(40);
    expect(pf.boundary.present).toBe(true);
  });
});
