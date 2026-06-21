import { describe, it, expect } from "vitest";
import { filingConfig } from "../server/filing/config.js";
import { fmtDocDate, composeFiledName } from "../server/filing/naming.js";
import { scoreProject, matchProject } from "../server/filing/matcher.js";
import { readTitleBlock, toPlacementFacts, parseStatedScaleFeetPerInch } from "../server/filing/titleBlockReader.js";
import { fileDocument } from "../server/filing/filingService.js";
import { createFilingServer } from "../server/filing/server.js";

const bytes = (s) => Buffer.from(s);

describe("filingConfig — env parsing, key dormant by default (B299)", () => {
  it("ANTHROPIC_API_KEY is null unless set (read stays dormant)", () => {
    expect(filingConfig({}).anthropic.apiKey).toBeNull();
    expect(filingConfig({ ANTHROPIC_API_KEY: "sk-x" }).anthropic.apiKey).toBe("sk-x");
  });
  it("defaults the model to claude-opus-4-8 (matches the client title reader)", () => {
    expect(filingConfig({}).anthropic.model).toBe("claude-opus-4-8");
  });
  it("PORT defaults to 8080 (Cloud Run overrides)", () => {
    expect(filingConfig({}).port).toBe(8080);
    expect(filingConfig({ PORT: "5000" }).port).toBe(5000);
  });
  it("does not read any VITE_ var (the key stays server-side)", () => {
    expect(filingConfig({ VITE_ANTHROPIC_API_KEY: "leak" }).anthropic.apiKey).toBeNull();
  });
  it("exposes tunable matcher thresholds", () => {
    expect(filingConfig({}).match.minConfidence).toBe(0.6);
    expect(filingConfig({ FILING_MIN_CONFIDENCE: "0.8" }).match.minConfidence).toBe(0.8);
  });
});

describe("naming — '<Project> - <Item> - YYYY.MM.DD' (mirrors reviewStore.composeTitle)", () => {
  it("formats a date", () => {
    expect(fmtDocDate("2026-06-20")).toBe("2026.06.20");
    expect(fmtDocDate("nonsense")).toBe("");
  });
  it("composes the canonical name, dropping empty pieces", () => {
    expect(composeFiledName({ project: "Katy Grand", item: "Grading Plan", docDate: "2026-06-20" })).toBe("Katy Grand - Grading Plan - 2026.06.20");
    expect(composeFiledName({ item: "Survey", docDate: "2026-06-20" })).toBe("Survey - 2026.06.20");
    // No date defaults to today (matches reviewStore.fmtDocDate); head falls back to "Untitled".
    expect(composeFiledName({})).toMatch(/^Untitled - \d{4}\.\d{2}\.\d{2}$/);
    expect(composeFiledName({ item: "Survey", docDate: "nope" })).toBe("Survey"); // unparseable date drops out
  });
});

describe("parseStatedScaleFeetPerInch — engineer + architectural, NTS → null", () => {
  it("reads an engineer's scale", () => { expect(parseStatedScaleFeetPerInch("1\"=40'")).toBe(40); });
  it("reads an architectural fractional scale", () => { expect(parseStatedScaleFeetPerInch("1/4\"=1'-0\"")).toBe(4); });
  it("maps NOT TO SCALE / unparseable to null (never a guess)", () => {
    expect(parseStatedScaleFeetPerInch("NOT TO SCALE")).toBeNull();
    expect(parseStatedScaleFeetPerInch("AS NOTED")).toBeNull();
    expect(parseStatedScaleFeetPerInch("")).toBeNull();
  });
});

describe("toPlacementFacts — maps the read into placementFacts shape", () => {
  it("marks captured + carries presence/values, leaving pixel-geometry for the CV step", () => {
    const f = toPlacementFacts({ embeddedCoords: true, coordSystem: "NAD83 TX South Central", scaleBarPresent: true, statedScale: "1\"=40'", northArrowPresent: true, boundaryPresent: true, dimensions: [{ valueFt: 240.5, label: "240'-6\"" }, { valueFt: 0, label: "n/a" }] });
    expect(f.captured).toBe(true);
    expect(f.embeddedCoords).toEqual({ present: true, crs: "NAD83 TX South Central" });
    expect(f.statedScale.feetPerInch).toBe(40);
    expect(f.scaleBar.present).toBe(true);
    expect(f.scaleBar.drawnLenPx).toBeNull(); // measured later (CV)
    expect(f.dimensions).toHaveLength(1); // the 0-length one is dropped
    expect(f.dimensions[0]).toMatchObject({ valueFt: 240.5, p1: null, p2: null });
  });
});

describe("matcher — confident single match, else needs-filing (never auto-guess) (B299)", () => {
  const projects = [
    { id: "g1", name: "Katy Grand", aliases: { addresses: ["1234 FM 1093, Katy TX"], parcels: ["1234567000001"], jobNumbers: ["KG-2025"] } },
    { id: "g2", name: "Cypress Logistics Park" },
    { id: "g3", name: "Grand Parkway Commerce Center" },
  ];

  it("exact parcel → confident match", () => {
    const m = matchProject({ parcel: "1234567-000-001" }, projects);
    expect(m.matched).toBeTruthy();
    expect(m.projectId).toBe("g1");
    expect(m.needsFiling).toBe(false);
  });
  it("exact job number → confident match", () => {
    const m = matchProject({ projectNumber: "KG 2025" }, projects);
    expect(m.matched.id).toBe("g1");
  });
  it("strong project-name overlap → match", () => {
    const m = matchProject({ projectName: "Cypress Logistics Park — Phase 2" }, projects);
    expect(m.projectId).toBe("g2");
    expect(m.needsFiling).toBe(false);
  });
  it("empty read → needs filing, reason no-readable-identifiers (NOT a guess)", () => {
    const m = matchProject({}, projects);
    expect(m.matched).toBeNull();
    expect(m.needsFiling).toBe(true);
    expect(m.reason).toBe("no-readable-identifiers");
  });
  it("a name that matches nothing → needs filing, reason no-match", () => {
    const m = matchProject({ projectName: "Somewhere Else Entirely Unrelated" }, projects);
    expect(m.needsFiling).toBe(true);
    expect(m.reason).toBe("no-match");
  });
  it("two projects equally plausible → needs filing, reason ambiguous (no coin-flip)", () => {
    const ambig = [{ id: "a", name: "Grand Parkway Commerce Center" }, { id: "b", name: "Grand Parkway Commerce Center" }];
    const m = matchProject({ projectName: "Grand Parkway Commerce Center" }, ambig);
    expect(m.matched).toBeNull();
    expect(m.needsFiling).toBe(true);
    expect(m.reason).toBe("ambiguous");
  });
  it("scoreProject is transparent — lists the signal it matched on", () => {
    const s = scoreProject({ parcel: "1234567000001" }, projects[0]);
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.signals.some((g) => g.kind === "parcel")).toBe(true);
  });
});

describe("readTitleBlock — server-side read, no silent failures (B299)", () => {
  const cfg = { anthropic: { apiKey: "sk-test", model: "claude-opus-4-8", baseUrl: "https://api.test", version: "2023-06-01", maxTokens: 100, timeoutMs: 0 } };
  const apiReturning = (obj) => async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] }) });
  const sample = { projectName: "Katy Grand", projectNumber: "KG-2025", address: "", parcel: "", discipline: "Civil", sheetNumber: "C-2.01", sheetTitle: "GRADING PLAN", revision: "IFC", date: "2026-06-20", placement: { embeddedCoords: false, coordSystem: "", scaleBarPresent: true, statedScale: "1\"=40'", northArrowPresent: true, boundaryPresent: true, dimensions: [] } };

  it("fails clearly when not configured (no key) — never a fabricated read", async () => {
    const r = await readTitleBlock(bytes("PDF"), { anthropic: { apiKey: null } });
    expect(r.ok).toBe(false);
    expect(r.configured).toBe(false);
    expect(r.error).toMatch(/ANTHROPIC_API_KEY/);
  });
  it("rejects empty input before calling the API", async () => {
    let called = false;
    const r = await readTitleBlock(Buffer.alloc(0), cfg, { fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it("parses the structured read into fields + placement", async () => {
    const r = await readTitleBlock(bytes("PDF"), cfg, { fetchImpl: apiReturning(sample) });
    expect(r.ok).toBe(true);
    expect(r.fields).toMatchObject({ projectName: "Katy Grand", discipline: "Civil", sheetNumber: "C-2.01", revision: "IFC" });
    expect(r.placement.captured).toBe(true);
    expect(r.placement.statedScale.feetPerInch).toBe(40);
  });
  it("sends the right request shape (model, json_schema, base64 PDF document)", async () => {
    let sent;
    const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body), headers: opts.headers }; return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(sample) }] }) }; };
    await readTitleBlock(bytes("PDFBYTES"), cfg, { fetchImpl });
    expect(sent.url).toMatch(/\/v1\/messages$/);
    expect(sent.headers["x-api-key"]).toBe("sk-test");
    expect(sent.body.model).toBe("claude-opus-4-8");
    expect(sent.body.output_config.format.type).toBe("json_schema");
    expect(sent.body.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
  });
  it("surfaces a safety refusal, never a fake read", async () => {
    const r = await readTitleBlock(bytes("PDF"), cfg, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "refusal", content: [] }) }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/declined/i);
  });
  it("surfaces a non-200 API error visibly", async () => {
    const r = await readTitleBlock(bytes("PDF"), cfg, { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rate limited/);
  });
  it("recovers JSON even when wrapped in stray prose", async () => {
    const r = await readTitleBlock(bytes("PDF"), cfg, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Here you go: " + JSON.stringify(sample) + " done" }] }) }) });
    expect(r.ok).toBe(true);
    expect(r.fields.projectName).toBe("Katy Grand");
  });
});

describe("fileDocument — read → match → decision (B299)", () => {
  const cfg = filingConfig({});
  const projects = [{ id: "g1", name: "Katy Grand" }, { id: "g2", name: "Cypress Logistics Park" }];
  const okRead = (fields) => async () => ({ ok: true, fields: { projectName: "", projectNumber: "", address: "", parcel: "", discipline: "Other", sheetNumber: "", sheetTitle: "", revision: "", date: "", ...fields }, placement: toPlacementFacts({}) });

  it("propagates a read failure (no fabricated filing)", async () => {
    const r = await fileDocument(bytes("PDF"), { projects }, cfg, { read: async () => ({ ok: false, error: "boom", configured: false }) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });
  it("confident match → decision matched + auto-name + index facts", async () => {
    const r = await fileDocument(bytes("PDF"), { projects }, cfg, { read: okRead({ projectName: "Katy Grand", discipline: "Civil", sheetTitle: "GRADING PLAN", date: "2026-06-20" }) });
    expect(r.ok).toBe(true);
    expect(r.decision.matched).toBe(true);
    expect(r.decision.projectId).toBe("g1");
    expect(r.decision.suggestedName).toBe("Katy Grand - GRADING PLAN - 2026.06.20");
    expect(r.facts).toMatchObject({ projectId: "g1", discipline: "Civil", needsFiling: false });
    expect(r.facts.placement.captured).toBe(true);
  });
  it("no confident match → needs filing (never auto-guess)", async () => {
    const r = await fileDocument(bytes("PDF"), { projects }, cfg, { read: okRead({ projectName: "Totally Unrelated Site" }) });
    expect(r.ok).toBe(true);
    expect(r.decision.matched).toBe(false);
    expect(r.decision.needsFiling).toBe(true);
    expect(r.facts.needsFiling).toBe(true);
  });
  it("empty body fails fast", async () => {
    expect((await fileDocument(Buffer.alloc(0), { projects }, cfg)).ok).toBe(false);
  });
});

// Drive the real HTTP server with an injected service (no key / network needed).
describe("filing HTTP server — routes + honest status codes (B299)", () => {
  const listen = (server) => new Promise((res) => { server.listen(0, "127.0.0.1", () => res(`http://127.0.0.1:${server.address().port}`)); });
  const decision = { matched: true, projectId: "g1", project: "Katy Grand", discipline: "Civil", item: "GRADING PLAN", suggestedName: "Katy Grand - GRADING PLAN - 2026.06.20", needsFiling: false, reason: "matched" };

  it("GET /health → 200 with configured flag", async () => {
    const server = createFilingServer(filingConfig({}));
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/health`);
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j.service).toBe("doc-filing");
      expect(j.configured).toBe(false);
    } finally { server.close(); }
  });

  it("POST /file success → 200 with the decision", async () => {
    const server = createFilingServer(filingConfig({ ANTHROPIC_API_KEY: "k" }), { fileDoc: async () => ({ ok: true, decision, placement: {}, facts: {} }) });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/file`, { method: "POST", body: bytes("PDF") });
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j.ok).toBe(true);
      expect(j.decision.projectId).toBe("g1");
    } finally { server.close(); }
  });

  it("decodes the X-Planyr-Projects header (base64 JSON) and passes it through", async () => {
    let seen;
    const server = createFilingServer(filingConfig({ ANTHROPIC_API_KEY: "k" }), { fileDoc: async (_b, ctx) => { seen = ctx.projects; return { ok: true, decision, placement: {}, facts: {} }; } });
    const base = await listen(server);
    try {
      const pj = Buffer.from(JSON.stringify([{ id: "g1", name: "Katy Grand" }])).toString("base64");
      await fetch(`${base}/file`, { method: "POST", body: bytes("PDF"), headers: { "x-planyr-projects": pj } });
      expect(seen).toEqual([{ id: "g1", name: "Katy Grand" }]);
    } finally { server.close(); }
  });

  it("POST /file not configured → 503 (infra fault), never a 200", async () => {
    const server = createFilingServer(filingConfig({}), { fileDoc: async () => ({ ok: false, error: "not configured", configured: false }) });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/file`, { method: "POST", body: bytes("PDF") });
      expect(r.status).toBe(503);
    } finally { server.close(); }
  });

  it("POST /file unreadable drawing → 422, never a 200", async () => {
    const server = createFilingServer(filingConfig({ ANTHROPIC_API_KEY: "k" }), { fileDoc: async () => ({ ok: false, error: "couldn't read" }) });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/file`, { method: "POST", body: bytes("PDF") });
      expect(r.status).toBe(422);
    } finally { server.close(); }
  });

  it("empty POST body → 400", async () => {
    const server = createFilingServer(filingConfig({ ANTHROPIC_API_KEY: "k" }));
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/file`, { method: "POST", body: bytes("") });
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it("GET /file → 405 (POST only)", async () => {
    const server = createFilingServer(filingConfig({}));
    const base = await listen(server);
    try { expect((await fetch(`${base}/file`)).status).toBe(405); } finally { server.close(); }
  });

  it("oversize body → 413", async () => {
    const server = createFilingServer({ ...filingConfig({ ANTHROPIC_API_KEY: "k" }), maxUploadBytes: 8 });
    const base = await listen(server);
    try {
      const r = await fetch(`${base}/file`, { method: "POST", body: bytes("way more than eight bytes") });
      expect(r.status).toBe(413);
    } finally { server.close(); }
  });
});
