import { describe, it, expect } from "vitest";
import {
  QUEUE_STATUS, RECENT_BEAT_MS, RECENT_COLLAPSE_AT,
  isAcceptedFile, makeQueueItem, makeQueueItems, splitQueue, hasPendingDemote, runPool,
  entryToFiles, flattenEntries, dropItemsToEntries, partitionAccepted,
} from "../src/shared/files/uploadQueue.js";

const pdf = (name = "a.pdf", size = 1000) => ({ name, size, type: "application/pdf" });
const png = (name = "a.png", size = 1000) => ({ name, size, type: "image/png" });

// ── Fake FileSystemEntry helpers for the folder-drop walk (B664) ──
const fileEntry = (file) => ({ isFile: true, isDirectory: false, file: (res) => res(file) });
// A directory whose reader serves `batches` (arrays of entries) in order, then [] to end —
// mirroring the real chunked readEntries contract (you must call it until it returns empty).
const dirEntry = (batches) => ({
  isFile: false, isDirectory: true,
  createReader: () => { let i = 0; return { readEntries: (res) => res(i < batches.length ? batches[i++] : []) }; },
});

describe("uploadQueue — accepted file types (Amendment A)", () => {
  it("accepts PDFs by type and by extension; rejects everything else", () => {
    expect(isAcceptedFile(pdf())).toBe(true);
    expect(isAcceptedFile({ name: "deed.PDF", size: 1, type: "" })).toBe(true); // ext-only, no MIME
    expect(isAcceptedFile(png())).toBe(false);
    expect(isAcceptedFile(null)).toBe(false);
  });

  it("a PDF becomes a PROCESSING item; an unsupported type becomes a REJECTED row (not discarded)", () => {
    const ok = makeQueueItem(pdf("survey.pdf"));
    expect(ok.status).toBe(QUEUE_STATUS.PROCESSING);
    expect(ok.error).toBeNull();
    const bad = makeQueueItem(png("logo.png"));
    expect(bad.status).toBe(QUEUE_STATUS.REJECTED);
    expect(bad.error).toMatch(/PDF/i);
  });
});

describe("uploadQueue — multi-file ingestion is first-class (Amendment A)", () => {
  it("8 files in one action => 8 independent rows with distinct uploadIds", () => {
    let n = 0;
    const items = makeQueueItems(Array.from({ length: 8 }, (_, i) => pdf(`s${i}.pdf`)), () => `id${n++}`);
    expect(items).toHaveLength(8);
    expect(new Set(items.map((it) => it.uploadId)).size).toBe(8);
    expect(items.every((it) => it.status === QUEUE_STATUS.PROCESSING)).toBe(true);
  });

  it("a mixed drop accepts the PDFs and surfaces a per-file rejection for the rest", () => {
    const items = makeQueueItems([pdf("a.pdf"), png("b.png"), pdf("c.pdf")]);
    const byStatus = items.reduce((m, it) => ((m[it.status] = (m[it.status] || 0) + 1), m), {});
    expect(byStatus[QUEUE_STATUS.PROCESSING]).toBe(2);
    expect(byStatus[QUEUE_STATUS.REJECTED]).toBe(1);
  });
});

describe("uploadQueue — derived two-group view (Amendment B)", () => {
  const now = 1_000_000;
  const item = (over) => ({ ...makeQueueItem(pdf()), ...over });

  it("processing / needs-filing / failed / rejected are ALWAYS active (never auto-dismiss)", () => {
    const queue = [
      item({ status: QUEUE_STATUS.PROCESSING }),
      item({ status: QUEUE_STATUS.NEEDS_FILING, filedAt: now - 10 * RECENT_BEAT_MS }),
      item({ status: QUEUE_STATUS.FAILED }),
      item({ status: QUEUE_STATUS.REJECTED }),
    ];
    const { active, recent } = splitQueue(queue, now);
    expect(active).toHaveLength(4);
    expect(recent).toHaveLength(0);
  });

  it("a freshly-filed item stays active during the beat, then demotes to recently-filed", () => {
    const fresh = item({ status: QUEUE_STATUS.DONE, filedAt: now - 1000 }); // within 3s beat
    const settled = item({ status: QUEUE_STATUS.DONE, filedAt: now - 5000 }); // past the beat
    const { active, recent } = splitQueue([fresh, settled], now);
    expect(active.map((i) => i.uploadId)).toEqual([fresh.uploadId]);
    expect(recent.map((i) => i.uploadId)).toEqual([settled.uploadId]);
  });

  it("recently-filed is newest-first", () => {
    const older = item({ status: QUEUE_STATUS.DONE, filedAt: now - 9000 });
    const newer = item({ status: QUEUE_STATUS.DONE, filedAt: now - 5000 });
    const { recent } = splitQueue([older, newer], now);
    expect(recent.map((i) => i.uploadId)).toEqual([newer.uploadId, older.uploadId]);
  });

  it("is a pure derived view — the source array is not mutated", () => {
    const queue = [item({ status: QUEUE_STATUS.DONE, filedAt: now - 5000 })];
    const snapshot = JSON.parse(JSON.stringify(queue));
    splitQueue(queue, now);
    expect(queue).toEqual(snapshot);
  });
});

describe("uploadQueue — demote timing", () => {
  const now = 1_000_000;
  it("hasPendingDemote is true only while a done item is still inside its beat", () => {
    const fresh = { ...makeQueueItem(pdf()), status: QUEUE_STATUS.DONE, filedAt: now - 1000 };
    const settled = { ...makeQueueItem(pdf()), status: QUEUE_STATUS.DONE, filedAt: now - 5000 };
    expect(hasPendingDemote([fresh], now)).toBe(true);
    expect(hasPendingDemote([settled], now)).toBe(false);
    expect(hasPendingDemote([{ ...makeQueueItem(pdf()), status: QUEUE_STATUS.PROCESSING }], now)).toBe(false);
    expect(hasPendingDemote([], now)).toBe(false);
  });

  it("exposes sane convention constants", () => {
    expect(RECENT_BEAT_MS).toBe(3000);
    expect(RECENT_COLLAPSE_AT).toBe(3);
  });
});

describe("uploadQueue — folder-aware drops (B664)", () => {
  it("entryToFiles: a file entry yields its one File", async () => {
    const f = pdf("survey.pdf");
    expect(await entryToFiles(fileEntry(f))).toEqual([f]);
  });

  it("entryToFiles: recurses nested folders and reads EVERY chunk of a directory reader", async () => {
    const a = pdf("a.pdf"), b = pdf("b.pdf"), c = pdf("c.pdf"), d = pdf("deep.pdf");
    // root/ → [a, b (served in TWO chunks)] + sub/ → [c] + sub/deeper/ → [d]
    const deeper = dirEntry([[fileEntry(d)]]);
    const sub = dirEntry([[fileEntry(c), deeper]]);
    const root = dirEntry([[fileEntry(a)], [fileEntry(b), sub]]); // two batches at the top level
    const files = await entryToFiles(root);
    expect(files).toEqual([a, b, c, d]);
  });

  it("entryToFiles: an unreadable entry is skipped, not fatal", async () => {
    const boom = { isFile: true, isDirectory: false, file: (_res, rej) => rej(new Error("nope")) };
    expect(await entryToFiles(boom)).toEqual([]);
    expect(await entryToFiles(null)).toEqual([]);
    expect(await entryToFiles({ isFile: false, isDirectory: false })).toEqual([]);
  });

  it("flattenEntries: flattens a mix of loose files and a folder", async () => {
    const loose = pdf("loose.pdf"), inside = pdf("inside.pdf");
    const out = await flattenEntries([fileEntry(loose), dirEntry([[fileEntry(inside)]])]);
    expect(out).toEqual([loose, inside]);
  });

  it("dropItemsToEntries: pulls entries synchronously and flags a dropped folder", () => {
    const folder = dirEntry([[fileEntry(pdf("in.pdf"))]]);
    const dt = {
      files: [pdf("flat.pdf")], // browsers leave this empty for a folder; kept as fallback
      items: [
        { kind: "file", webkitGetAsEntry: () => folder },
        { kind: "file", webkitGetAsEntry: () => fileEntry(pdf("loose.pdf")) },
        { kind: "string", webkitGetAsEntry: () => null }, // dragged text — ignored
      ],
    };
    const r = dropItemsToEntries(dt);
    expect(r.hasEntryApi).toBe(true);
    expect(r.hasDirectory).toBe(true);
    expect(r.entries).toHaveLength(2);
    expect(r.files).toHaveLength(1);
  });

  it("dropItemsToEntries: falls back to the flat file list when the entry API is absent", () => {
    const r = dropItemsToEntries({ files: [pdf("x.pdf"), pdf("y.pdf")], items: [{ kind: "file" }] });
    expect(r.hasEntryApi).toBe(false);
    expect(r.hasDirectory).toBe(false);
    expect(r.files).toHaveLength(2);
    expect(dropItemsToEntries(null).files).toEqual([]);
  });

  it("partitionAccepted: files the PDFs, sets the rest aside for one honest summary", () => {
    const { accepted, skipped } = partitionAccepted([pdf("a.pdf"), png("logo.png"), pdf("b.pdf"), { name: "notes.docx", type: "" }]);
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(skipped.map((f) => f.name)).toEqual(["logo.png", "notes.docx"]);
    expect(partitionAccepted(null)).toEqual({ accepted: [], skipped: [] });
  });
});

describe("uploadQueue — concurrency pool (Amendment A)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("processes every item but never exceeds the concurrency limit", async () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const seen = [];
    let inFlight = 0;
    let peak = 0;
    await runPool(items, async (n) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await tick(); await tick();
      seen.push(n);
      inFlight -= 1;
    }, 3);
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // genuinely concurrent, not a serial chain
  });

  it("treats limit < 1 as 1 and handles an empty list", async () => {
    let count = 0;
    await runPool([1, 2], async () => { count += 1; }, 0);
    expect(count).toBe(2);
    await expect(runPool([], async () => { throw new Error("should not run"); }, 3)).resolves.toBeUndefined();
  });
});
