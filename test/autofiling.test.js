import { describe, it, expect } from "vitest";
import { toFactsRow, factsRowToPatch, mergeFactsIntoReviews } from "../src/workspaces/doc-review/lib/fileIndex.js";
import { encodeProjects, interpretResponse, autofile, createAutofilingProvider } from "../src/workspaces/doc-review/lib/autofiling.js";

const placementIn = { captured: true, embeddedCoords: { present: false, crs: null }, scaleBar: { present: true, drawnLenPx: null, realLenFt: null }, statedScale: { present: true, text: "1\"=40'", feetPerInch: 40 }, northArrow: { present: true, orientationDeg: null }, boundary: { present: true }, dimensions: [{ valueFt: 240, label: "240'", p1: null, p2: null }] };

describe("fileIndex.toFactsRow — server facts → one DB row (B299)", () => {
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

describe("autofiling.autofile — local-first, AI fallback only when no text (B312)", () => {
  const decision = { matched: true, projectId: "g1", discipline: "Civil", item: "GRADING PLAN", docDate: "2026-06-20", needsFiling: false };
  const localHit = async () => ({ ok: true, hasText: true, decision, facts: { projectId: "g1" }, source: "local" });
  const localNoText = async () => ({ ok: true, hasText: false });

  it("a text PDF is read locally — no server call, no tokens", async () => {
    let posted = false;
    const r = await autofile(new Uint8Array([1]), [{ id: "g1", name: "Katy Grand" }], { localRead: localHit, fetchImpl: async () => { posted = true; return { status: 200, json: async () => ({}) }; }, getToken: async () => "tok", serverEnabled: true });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("local");
    expect(r.decision.projectId).toBe("g1");
    expect(posted).toBe(false); // the AI was never touched
  });
  it("a scanned PDF (no text) falls back to the AI when the backend is on", async () => {
    let sent;
    const fetchImpl = async (url, opts) => { sent = { url, opts }; return { status: 200, json: async () => ({ ok: true, decision, placement: placementIn, facts: {} }) }; };
    const r = await autofile(new Uint8Array([1]), [{ id: "g1", name: "Katy Grand" }], { localRead: localNoText, fetchImpl, getToken: async () => "tok", serverEnabled: true });
    expect(r.ok).toBe(true);
    expect(sent.opts.headers.authorization).toBe("Bearer tok");
    expect(sent.opts.headers["x-planyr-projects"]).toBeTruthy();
  });
  it("a scanned PDF with the AI fallback OFF → graceful skip (files manually), never posts", async () => {
    let posted = false;
    const r = await autofile(new Uint8Array([1]), [], { localRead: localNoText, fetchImpl: async () => { posted = true; return { status: 200, json: async () => ({}) }; }, getToken: async () => "tok", serverEnabled: false });
    expect(r).toMatchObject({ ok: false, skipped: true });
    expect(posted).toBe(false);
  });
  it("scanned + backend on + not signed in → skip (never posts)", async () => {
    let posted = false;
    const r = await autofile(new Uint8Array([1]), [], { localRead: localNoText, fetchImpl: async () => { posted = true; return { status: 200, json: async () => ({}) }; }, getToken: async () => null, serverEnabled: true });
    expect(r.skipped).toBe(true);
    expect(posted).toBe(false);
  });
});

describe("autofiling provider — local always on, AI gated (B312)", () => {
  const decision = { matched: true, projectId: "g1", discipline: "Civil", item: "X", docDate: "2026-06-20", needsFiling: false };
  it("auto-filing is ready by default (local); backendReady reflects the AI flag", async () => {
    const localHit = async () => ({ ok: true, hasText: true, decision, facts: {}, source: "local" });
    const p = createAutofilingProvider({ enabled: false, localRead: localHit, fetchImpl: async () => { throw new Error("AI should not be called"); } });
    expect(p.autofileReady).toBe(true);
    expect(p.backendReady).toBe(false); // AI fallback off
    const r = await p.autofile(new Uint8Array([1]), []);
    expect(r.ok).toBe(true);
    expect(r.source).toBe("local"); // filed for free, no AI
  });
  it("disabled → capturePlacementFacts returns the safe empty shape (placement is AI-only)", async () => {
    const p = createAutofilingProvider({ enabled: false });
    const pf = await p.capturePlacementFacts(new Uint8Array([1]));
    expect(pf.captured).toBe(false);
  });
  it("enabled → capturePlacementFacts forces the AI read and merges its placement", async () => {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ ok: true, decision: { matched: true }, placement: placementIn, facts: {} }) });
    const p = createAutofilingProvider({ enabled: true, fetchImpl, getToken: async () => "tok" });
    expect(p.backendReady).toBe(true);
    const pf = await p.capturePlacementFacts(new Uint8Array([1]));
    expect(pf.captured).toBe(true);
    expect(pf.statedScale.feetPerInch).toBe(40);
    expect(pf.boundary.present).toBe(true);
  });
});
