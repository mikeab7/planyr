/* B2084480 / B2084481 — owner report 2026-10-04 (build 4ca9ff1).
 *  NEW-1: a file saved in Review did not show in the Library (Recent / Unfiled) until a full reload — the Library
 *         only refetched on tab activation, and nothing told it the write had landed. Every Library-visible write
 *         (reviewStore.upsertReview, delete, restore, a Recent open) now announces via libraryChanged, and the
 *         Library surfaces re-read.
 *  NEW-2: a .doc and the .docx saved from it rendered identical Library rows. Each card now carries its type tag.
 * Matrix required by the brief: .docx, .txt, .doc → .docx, PDF.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const h = vi.hoisted(() => ({ user: { id: "u1" }, calls: [] }));

function builder(table) {
  const ops = [];
  const settle = () => { h.calls.push({ table, ops }); return { data: [{ id: "rv1", version: 1 }], error: null }; };
  const b = { then(resolve, reject) { try { resolve(settle()); } catch (e) { reject(e); } } };
  for (const m of ["select", "update", "delete", "upsert", "insert", "eq", "neq", "is", "not", "lt", "contains", "limit", "order", "or"])
    b[m] = (...args) => { ops.push([m, ...args]); return b; };
  b.maybeSingle = () => Promise.resolve().then(settle);
  return b;
}
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabaseConfigured: () => true, supabaseRest: () => ({ url: "http://x", anon: "a" }), currentAccessToken: () => "tok",
  connectionInfo: () => ({}), testConnection: async () => ({ ok: true }),
  supabase: {
    from: (t) => builder(t),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), list: async () => ({ data: [] }) }) },
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
  },
}));
vi.mock("../src/workspaces/site-planner/lib/auth.js", () => ({
  signUp: async () => ({}), signIn: async () => ({}), signOut: async () => ({}), resetPassword: async () => ({}),
  updatePassword: async () => ({}), getUser: async () => h.user, onAuthChange: () => () => {},
}));
vi.mock("../src/workspaces/site-planner/lib/storage.js", () => ({ ensureProjectRow: vi.fn(async () => ({ ok: true })) }));

import { upsertReview, deleteReview, restoreReview } from "../src/workspaces/doc-review/lib/reviewStore.js";
import { notifyLibraryChanged, subscribeLibraryChanged } from "../src/shared/library/libraryChanged.js";
import { recordOpen } from "../src/shared/recents/recentDocs.js";
import { fileTypeTag } from "../src/workspaces/library/lib/fileTypeTag.js";
import { UnfiledCard } from "../src/workspaces/library/components/LibraryHome.jsx";

const MATRIX = [
  ["a.docx", "DOCX"],
  ["notes.txt", "TXT"],
  ["old-doc-test-delete-me.doc", "DOC"],
  ["old-doc-test-delete-me.docx", "DOCX"], // the .doc → .docx save-as-new
  ["plan.pdf", "PDF"],
];

describe("libraryChanged signal", () => {
  it("delivers to subscribers and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribeLibraryChanged(fn);
    notifyLibraryChanged();
    expect(fn).toHaveBeenCalledTimes(1);
    off(); notifyLibraryChanged();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("one throwing listener does not mute the others", () => {
    const bad = subscribeLibraryChanged(() => { throw new Error("x"); });
    const good = vi.fn(); const off = subscribeLibraryChanged(good);
    notifyLibraryChanged();
    expect(good).toHaveBeenCalled(); bad(); off();
  });
});

describe("NEW-1 — every Library-visible write announces itself", () => {
  beforeEach(() => { h.calls.length = 0; });
  for (const [name] of MATRIX) {
    it(`saving ${name} (no project → Unfiled) announces after the row is written`, async () => {
      const fn = vi.fn(); const off = subscribeLibraryChanged(fn);
      const res = await upsertReview({ id: `rv-${name}`, kind: "single", title: name, sourceFile: name, updatedAt: Date.now() });
      off();
      expect(res.ok).toBe(true);
      expect(fn).toHaveBeenCalled();
    });
  }
  it("a failed write does NOT announce (nothing changed)", async () => {
    const fn = vi.fn(); const off = subscribeLibraryChanged(fn);
    const res = await upsertReview(null);
    off();
    expect(res.ok).toBeFalsy();
    expect(fn).not.toHaveBeenCalled();
  });
  it("delete and restore announce", async () => {
    const fn = vi.fn(); const off = subscribeLibraryChanged(fn);
    await deleteReview("rv1"); await restoreReview("rv1");
    off();
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("opening a file (Recent) announces", () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
    const fn = vi.fn(); const off = subscribeLibraryChanged(fn);
    recordOpen("u1", { id: "rv9", projectId: null });
    off();
    expect(fn).toHaveBeenCalled();
    delete globalThis.localStorage;
  });
  it("both Library surfaces subscribe (source wiring)", () => {
    const read = (r) => readFileSync(fileURLToPath(new URL(r, import.meta.url)), "utf8");
    expect(read("../src/workspaces/library/components/LibraryHome.jsx")).toMatch(/subscribeLibraryChanged\(/);
    expect(read("../src/workspaces/library/components/FileBrowser.jsx")).toMatch(/subscribeLibraryChanged\(/);
  });
});

describe("NEW-2 — a .doc and the .docx made from it are distinguishable", () => {
  for (const [name, tag] of MATRIX) {
    it(`${name} → ${tag}`, () => {
      expect(fileTypeTag({ sfile: name })).toBe(tag);
      const html = renderToStaticMarkup(createElement(UnfiledCard, { doc: { id: "r", title: "2026.10.04 old-doc-test-delete-me", discipline: "Other", sfile: name, updated_at: "2026-10-04T12:00:00Z" } }));
      expect(html).toContain(`>${tag}</span>`);
    });
  }
  it("a review with no source filename is a PDF drawing", () => { expect(fileTypeTag({})).toBe("PDF"); });
  it("the two rows differ in their rendered markup", () => {
    const row = (sfile) => renderToStaticMarkup(createElement(UnfiledCard, { doc: { id: "r", title: "2026.10.04 old-doc-test-delete-me", discipline: "Other", sfile } }));
    expect(row("x.doc")).not.toEqual(row("x.docx"));
  });
});
