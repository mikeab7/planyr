/* NEW-1 — open an uploaded Excel in Spreadsheet: the small pure pieces and the wiring guards.
 *  · lib/fileDraft.js   — the on-device safety copy and the rule for when it may be applied
 *  · lib/activeFile.js  — which Library file a place's Spreadsheet is showing
 *  · the parse worker's import discipline (a DOM/React/Supabase import crashes at WORKER RUNTIME, not build time)
 *  · source guards that the Shell, the Library and the Spreadsheet stay joined up (the same shape
 *    test/modelAppOrgScope.test.js uses for this huge component). */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), "utf8");

// A tiny in-memory localStorage (the suite runs in node).
function installStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }, clear: () => m.clear(),
  };
  return m;
}

describe("fileDraft — the on-device copy of unsaved edits", () => {
  let store;
  beforeEach(() => { store = installStorage(); });
  it("round-trips a draft and clears it", async () => {
    const d = await import("../src/workspaces/model/lib/fileDraft.js");
    expect(d.writeFileDraft("u1", "rv1", "srcA", { sheets: [] })).toBe("written");
    expect(d.readFileDraft("u1", "rv1")).toMatchObject({ baseSrcId: "srcA", workbook: { sheets: [] } });
    expect(d.readFileDraft("u2", "rv1")).toBeNull(); // another account never sees it
    d.clearFileDraft("u1", "rv1");
    expect(d.readFileDraft("u1", "rv1")).toBeNull();
  });
  it("only a draft sitting on THIS stored version is restored; a stale one is set aside, never deleted", async () => {
    const d = await import("../src/workspaces/model/lib/fileDraft.js");
    d.writeFileDraft("u1", "rv1", "srcA", { sheets: [] });
    expect(d.decideDraft(d.readFileDraft("u1", "rv1"), "srcA")).toBe("restore");
    expect(d.decideDraft(d.readFileDraft("u1", "rv1"), "srcB")).toBe("stale");
    expect(d.decideDraft(null, "srcA")).toBe("none");
    d.setAsideFileDraft("u1", "rv1");
    expect(d.readFileDraft("u1", "rv1")).toBeNull();
    expect([...store.keys()].some((k) => k.endsWith(":aside"))).toBe(true); // recoverable
  });
  it("a very large workbook is NOT mirrored into the small localStorage tier (TIER-BY-REBUILDABILITY)", async () => {
    const d = await import("../src/workspaces/model/lib/fileDraft.js");
    const big = { cells: "x".repeat(d.MAX_DRAFT_CHARS + 10) };
    expect(d.writeFileDraft("u1", "rv1", "srcA", big)).toBe("skipped-large");
    expect(d.readFileDraft("u1", "rv1")).toBeNull();
  });
  it("a blocked/full store reports failure instead of throwing", async () => {
    const d = await import("../src/workspaces/model/lib/fileDraft.js");
    globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(d.writeFileDraft("u1", "rv1", "s", {})).toBe("failed");
    expect(d.readFileDraft("u1", "rv1")).toBeNull();
  });
});

describe("activeFile — which file a place's Spreadsheet shows", () => {
  beforeEach(() => { installStorage(); });
  it("is remembered per place and cleared by null; listeners hear both", async () => {
    const a = await import("../src/workspaces/model/lib/activeFile.js");
    const heard = [];
    const off = a.onActiveFileChanged((scope, id) => heard.push([scope, id]));
    const p = a.scopeKeyFor({ projectId: "proj1" });
    expect(p).toBe("p:proj1");
    expect(a.scopeKeyFor({ org: true })).toBe("org");
    expect(a.scopeKeyFor({})).toBe("none");
    a.setActiveFile(p, "rv9");
    expect(a.readActiveFile(p)).toBe("rv9");
    expect(a.readActiveFile("org")).toBeNull();
    a.setActiveFile(p, null);
    expect(a.readActiveFile(p)).toBeNull();
    expect(heard).toEqual([[p, "rv9"], [p, null]]);
    off();
  });
});

describe("the parse worker is worker-safe", () => {
  const fileFor = (spec, from) => {
    const base = dirname(from);
    const p = resolve(base, spec);
    return existsSync(p) ? p : null;
  };
  function closure(entry) {
    const seen = new Set(), stack = [entry];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:from\s+|import\s+)"(\.[^"]+)"/g)) { const p = fileFor(m[1], f); if (p && /\.(js|jsx|mjs)$/.test(p)) stack.push(p); }
    }
    return [...seen];
  }
  const workerPath = resolve(here, "../src/workspaces/model/lib/spreadsheetWorker.js");
  it("imports ONLY lib/spreadsheetFile.js (parse) and lib/xlsxIO.js (export) directly", () => {
    const imports = [...read("../src/workspaces/model/lib/spreadsheetWorker.js").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["./spreadsheetFile.js", "./xlsxIO.js"]);
  });
  it("nothing it can reach touches the DOM, React, Supabase or storage", () => {
    const bad = [];
    for (const f of closure(workerPath)) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/from\s+"react"|from\s+"leaflet"|supabase|\bdocument\.|\bwindow\.|localStorage/.test(src)) bad.push(f.replace(resolve(here, ".."), ""));
    }
    expect(bad).toEqual([]);
  });
  it("answers every job, success or failure (LOUD-FAILURE) and the client spawns it via ?worker", () => {
    const w = read("../src/workspaces/model/lib/spreadsheetWorker.js");
    expect(w).toMatch(/op === "export"/); expect(w).toMatch(/ok: true/); expect(w).toMatch(/ok: false/); expect(w).toMatch(/self\.onmessage/);
    const c = read("../src/workspaces/model/lib/spreadsheetClient.js");
    expect(c).toMatch(/spreadsheetWorker\.js\?worker/);
    expect(c).toMatch(/timeoutMs/); // never a spinner that doesn't end
    expect(c).not.toMatch(/import\("\.\/spreadsheetFile\.js"\)|import\("\.\/xlsxIO\.js"\)/); // no main-thread fallback: it would ship a second ExcelJS
  });
});

describe("the doors are joined up", () => {
  it("the Shell sends a Library spreadsheet row to the Spreadsheet tab, writing the pointer first", () => {
    const sh = read("../src/app/Shell.jsx");
    const at = sh.indexOf("isSpreadsheetName(row.sfile || row.sourceFile)");
    expect(at).toBeGreaterThan(0);
    const block = sh.slice(at, at + 400);
    expect(block.indexOf("setActiveFile(")).toBeGreaterThan(-1);
    expect(block.indexOf("setActiveFile(")).toBeLessThan(block.indexOf('module: "model"'));
  });
  it("the Library opens (not downloads) a spreadsheet row and labels the menu item for it", () => {
    const fb = read("../src/workspaces/library/components/FileBrowser.jsx");
    expect(fb).toMatch(/!isPdfFile\(f\) && !isDocFile\(f\) && !isSheetFile\(f\)/);
    expect(fb).toMatch(/sheetRow: isSheetFile\(f\)/);
    expect(read("../src/workspaces/library/lib/fileMove.js")).toMatch(/Open in Spreadsheet/);
  });
  it("in file mode the project's own load / write-through / push never run (they would write the file into the project)", () => {
    const m = read("../src/workspaces/model/ModelApp.jsx");
    expect(m).toMatch(/if \(fileMode\) return undefined;/);
    expect(m).toMatch(/!ready \|\| !openWorkbook \|\| fileMode/);
    expect(m).toMatch(/!ready \|\| !openWorkbook \|\| !userId \|\| fileMode/);
    expect(m).toMatch(/if \(flipped\) return;/);
  });
  it("the File menu has the in-module door and it files into the Library first", () => {
    expect(read("../src/workspaces/model/components/FileMenu.jsx")).toMatch(/Open Excel or CSV file…/);
    const m = read("../src/workspaces/model/ModelApp.jsx");
    expect(m).toMatch(/fileNewReview\(\{/);
    expect(m.indexOf("fileNewReview({")).toBeLessThan(m.indexOf("setActiveFile(fileScopeRef.current, res.id)"));
  });
  it("heavy parsers stay out of the eager Spreadsheet/Shell/Library chunks", () => {
    for (const f of ["../src/app/Shell.jsx", "../src/workspaces/model/ModelApp.jsx", "../src/workspaces/library/components/FileBrowser.jsx", "../src/workspaces/model/lib/fileWorkbook.js", "../src/workspaces/model/lib/fileWorkbookStore.js", "../src/workspaces/model/lib/useFileWorkbook.js", "../src/workspaces/model/lib/spreadsheetClient.js", "../src/workspaces/model/lib/activeFile.js"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(/from\s+"exceljs"|from\s+"xlsx"|from\s+"\.\/(xlsxIO|spreadsheetFile)\.js"|from\s+"[^"]*\/model\/lib\/(xlsxIO|spreadsheetFile)\.js"/);
    }
  });
});

describe("input-autofill house rule on the Spreadsheet's editors", () => {
  it("every text <input> in the Spreadsheet's components carries the shared NO_AUTOFILL bag", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = resolve(here, "../src/workspaces/model/components");
    const missing = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsx"))) {
      const src = readFileSync(resolve(dir, f), "utf8");
      for (const m of src.matchAll(/^\s*<input\n([\s\S]{0,400}?)\/>/gm)) {
        if (!m[1].includes("{...NO_AUTOFILL}")) missing.push(f);
      }
    }
    expect(missing).toEqual([]);
  });
});
