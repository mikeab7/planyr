/* Notes, round two — the bin, timestamps, pictures, the print sheet.
 *
 * These cover the four things the module could not do when it shipped, at the layer where
 * each one is actually decided:
 *   • DELETE WAS PERMANENT AND INSTANT (B1310) — the bin's whole lifecycle, including the
 *     two restores that are easy to get wrong (a parent that is itself binned, and a parent
 *     that is gone for good) and the purge that must free EVERY byte the entry is holding.
 *   • NOTHING RECORDED WHEN A NOTE WAS TOUCHED (B1312) — including the honest `null`, which
 *     a migrated page keeps rather than claiming it was edited at upgrade time.
 *   • A NOTE COULD NOT HOLD A PICTURE (B1311) — the storage seam under a real IndexedDB
 *     (fake-indexeddb), the ceilings, and the cascade that takes a page's images with it.
 *   • A NOTE COULD NOT BE PRINTED (B1314) — the pure sheet builder.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addPage, allPageIds, deleteNode, emptyTree, expiredTrashIds, findPage, makePage, migrate,
  purgeTrashEntry, recentPages, restoreNode, touchPage, trashEntries, trashPageIds,
  TRASH_RETENTION_DAYS,
} from "../src/workspaces/notes/lib/notesModel.js";
import { absoluteStamp, daysLeft, editedLabel, relativeTime } from "../src/workspaces/notes/lib/notesTime.js";
import { docToMarkdown, imageIdsInDoc, imageIdsInDocs, notebookToMarkdown } from "../src/workspaces/notes/lib/notesMarkdown.js";
import { buildPrintDocument } from "../src/workspaces/notes/lib/notesPrint.js";

/* A minimal localStorage, installed before the store module is reached. The store resolves
 * `window.localStorage` per call (never captured), so this is enough for the real code path
 * — no mock of the module itself, which is what would make these tests prove nothing. */
const mem = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};

const store = await import("../src/workspaces/notes/lib/notesStore.js");

const DAY = 86400000;

const fixture = () => ({
  v: 2,
  trash: [],
  notebooks: [
    { id: "nb1", title: "Goose Creek", projectId: null, sections: [
      { id: "s1", title: "Survey", pages: [
        { id: "p1", title: "Deed", createdAt: 1000, updatedAt: 5000 },
        { id: "p2", title: "Plat", createdAt: 1000, updatedAt: 9000 },
      ] },
      { id: "s2", title: "Drainage", pages: [{ id: "p3", title: "Detention", createdAt: 1000, updatedAt: 1000 }] },
    ] },
    { id: "nb2", title: "Brokers", projectId: "P2", sections: [
      { id: "s3", title: "Calls", pages: [{ id: "p4", title: "CBRE", createdAt: 1, updatedAt: null }] },
    ] },
  ],
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 1. THE BIN (B1310)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("delete bins rather than destroys", () => {
  it("a deleted page leaves the live tree and lands in the bin with its cascade", () => {
    const { tree, removedPageIds, entry } = deleteNode(fixture(), "p1", { at: 5000, entryId: "t1" });
    expect(allPageIds(tree)).not.toContain("p1");
    expect(removedPageIds).toEqual(["p1"]);
    expect(entry).toMatchObject({ id: "t1", kind: "page", parentId: "s1", index: 0, title: "Deed", deletedAt: 5000 });
    expect(entry.pageIds).toEqual(["p1"]);
    expect(trashPageIds(tree)).toEqual(["p1"]);
  });

  it("a deleted notebook bins the WHOLE cascade, not just the node that was clicked", () => {
    const { tree, entry } = deleteNode(fixture(), "nb1", { entryId: "t1" });
    expect(entry.pageIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(trashPageIds(tree).sort()).toEqual(["p1", "p2", "p3"]);
    expect(allPageIds(tree)).toEqual(["p4"]);
  });

  it("a binned page is INVISIBLE to every live read — the bin is not a second tree", () => {
    const { tree } = deleteNode(fixture(), "p1");
    expect(findPage(tree, "p1")).toBeNull();
    expect(recentPages(tree).map((r) => r.pageId)).not.toContain("p1");
  });

  it("restore puts a page back at the index it came from", () => {
    const { tree, entry } = deleteNode(fixture(), "p1", { entryId: "t1" });
    const back = restoreNode(tree, entry.id);
    expect(back.tree.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(back.tree.trash).toHaveLength(0);
    expect(back.pageIds).toEqual(["p1"]);
  });

  it("restoring a page whose SECTION is also binned brings the section back first", () => {
    let t = fixture();
    const pageDel = deleteNode(t, "p1", { entryId: "tp" });
    t = pageDel.tree;
    const secDel = deleteNode(t, "s1", { entryId: "ts" });
    t = secDel.tree;
    expect(t.notebooks[0].sections.map((s) => s.id)).toEqual(["s2"]);

    const back = restoreNode(t, "tp");
    expect(back.tree.trash, "both entries are gone — the parent was restored on the way").toHaveLength(0);
    const sec = back.tree.notebooks[0].sections.find((s) => s.id === "s1");
    expect(sec.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("restoring into a parent that is gone FOR GOOD lands in a named home rather than failing", () => {
    let t = fixture();
    const del = deleteNode(t, "p1", { entryId: "tp" });
    t = del.tree;
    // The section is purged for real while the page sits in the bin.
    const secDel = deleteNode(t, "s1", { entryId: "ts" });
    t = purgeTrashEntry(secDel.tree, "ts").tree;

    const back = restoreNode(t, "tp");
    expect(back.restored).toBeTruthy();
    const home = back.tree.notebooks.find((n) => n.title === "Recovered notes");
    expect(home, "a restore must never fail into nothing").toBeTruthy();
    expect(home.sections[0].pages.map((p) => p.id)).toEqual(["p1"]);
  });

  it("restoring an unknown entry is a no-op, not a crash (a double-clicked Undo)", () => {
    const { tree } = deleteNode(fixture(), "p1", { entryId: "t1" });
    const r = restoreNode(tree, "nope");
    expect(r.restored).toBeNull();
    expect(r.tree.trash).toHaveLength(1);
  });

  it("purge hands back the FULL page set whose bytes the caller must now destroy", () => {
    const { tree, entry } = deleteNode(fixture(), "nb1", { entryId: "t1" });
    const r = purgeTrashEntry(tree, entry.id);
    expect(r.pageIds.sort()).toEqual(["p1", "p2", "p3"]);
    expect(r.tree.trash).toHaveLength(0);
    expect(trashPageIds(r.tree)).toEqual([]);
  });

  it("only entries past the retention window are due for the sweep", () => {
    const now = 100 * DAY;
    let t = fixture();
    t = deleteNode(t, "p1", { at: now - (TRASH_RETENTION_DAYS + 1) * DAY, entryId: "old" }).tree;
    t = deleteNode(t, "p2", { at: now - DAY, entryId: "new" }).tree;
    expect(expiredTrashIds(t, { now })).toEqual(["old"]);
  });

  it("the bin lists newest first, with an expiry and whether it can actually be restored", () => {
    let t = fixture();
    t = deleteNode(t, "p1", { at: 1000, entryId: "a" }).tree;
    t = deleteNode(t, "p2", { at: 2000, entryId: "b" }).tree;
    const list = trashEntries(t);
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(list[0].expiresAt).toBe(2000 + TRASH_RETENTION_DAYS * DAY);
    expect(list.every((e) => e.restorable)).toBe(true);
  });

  it("a corrupt bin entry keeps its page ids (so the bytes can still be freed) but refuses to restore", () => {
    const t = migrate({ v: 2, notebooks: [], trash: [{ id: "bad", kind: "page", node: null, pageIds: ["pX"], deletedAt: 5 }] });
    expect(trashPageIds(t)).toEqual(["pX"]);
    expect(trashEntries(t)[0].restorable).toBe(false);
    expect(restoreNode(t, "bad").restored).toBeNull();
    expect(purgeTrashEntry(t, "bad").pageIds).toEqual(["pX"]);
  });

  it("deleteNode stays PURE — the input tree is untouched", () => {
    const t = Object.freeze(fixture());
    const before = JSON.stringify(t);
    deleteNode(t, "nb1");
    expect(JSON.stringify(t)).toBe(before);
  });

  it("migrate carries the bin through additively, and tolerates a tree that has none", () => {
    const t = deleteNode(fixture(), "p1", { entryId: "t1" }).tree;
    const round = migrate(JSON.parse(JSON.stringify(t)));
    expect(round.trash).toHaveLength(1);
    expect(round.trash[0].node.id).toBe("p1");
    // A v1 tree (no `trash` key at all) reads as an empty bin, never as a crash.
    expect(migrate({ notebooks: [] }).trash).toEqual([]);
    expect(emptyTree().trash).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2. TIMESTAMPS (B1312)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("a page records when it was made and when it was touched", () => {
  it("a new page is stamped on both fields", () => {
    const p = makePage({ id: "x", at: 4242 });
    expect(p).toMatchObject({ id: "x", createdAt: 4242, updatedAt: 4242 });
  });

  it("a page added to a section is stamped too", () => {
    const r = addPage(fixture(), "s1", { id: "pz", at: 777 });
    expect(findPage(r.tree, "pz").page.updatedAt).toBe(777);
  });

  it("touchPage moves only updatedAt, only on the page named", () => {
    const t = touchPage(fixture(), "p1", 9999);
    expect(findPage(t, "p1").page.updatedAt).toBe(9999);
    expect(findPage(t, "p1").page.createdAt).toBe(1000);
    expect(findPage(t, "p2").page.updatedAt).toBe(9000);
  });

  it("touchPage on an unknown page returns the SAME object, so the caller can skip a write", () => {
    const t = fixture();
    expect(touchPage(t, "nope")).toBe(t);
  });

  it("a page written before timestamps existed keeps NULL rather than being invented", () => {
    const t = migrate({ notebooks: [{ id: "nb", sections: [{ id: "s", pages: [{ id: "p", title: "Old" }] }] }] });
    expect(t.notebooks[0].sections[0].pages[0]).toMatchObject({ createdAt: null, updatedAt: null });
  });

  it("Recent is newest first, and an unknown time sorts LAST rather than pretending to be new", () => {
    expect(recentPages(fixture()).map((r) => r.pageId)).toEqual(["p2", "p1", "p3", "p4"]);
  });

  it("Recent respects project visibility, like every other read", () => {
    expect(recentPages(fixture(), { projectId: "P1" }).map((r) => r.pageId)).toEqual(["p2", "p1", "p3"]);
    expect(recentPages(fixture(), { projectId: "P2" }).map((r) => r.pageId)).toEqual(["p2", "p1", "p3", "p4"]);
  });

  it("relative time is coarse, and says NOTHING when the time is unknown", () => {
    const now = 1_800_000_000_000;   // a real epoch: 20 days ago has to still be positive
    expect(relativeTime(null)).toBe("");
    expect(relativeTime(0)).toBe("");
    expect(relativeTime(now - 5000, { now })).toBe("just now");
    expect(relativeTime(now - 12 * 60000, { now })).toBe("12m");
    expect(relativeTime(now - 5 * 3600000, { now })).toBe("5h");
    expect(relativeTime(now - 3 * DAY, { now })).toBe("3d");
    expect(relativeTime(now - 20 * DAY, { now })).toBe("2w");
    expect(editedLabel(null)).toBe("");
    expect(editedLabel(now - 5 * 3600000, { now })).toBe("Edited 5h ago");
    expect(editedLabel(now - 1000, { now })).toBe("Edited just now");
    expect(absoluteStamp(null)).toBe("");
    expect(absoluteStamp(now)).not.toBe("");
  });

  it("a clock that ran backwards is not reported as a note from the future", () => {
    expect(relativeTime(2000, { now: 1000 })).toBe("just now");
  });

  it("the bin's countdown counts down, and names the due state instead of going negative", () => {
    const now = 0;
    expect(daysLeft(3 * DAY, { now })).toBe("3 days left");
    expect(daysLeft(DAY, { now })).toBe("1 day left");
    expect(daysLeft(-DAY, { now })).toBe("due to be cleared");
    expect(daysLeft(null)).toBe("");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 3. IMAGES — the document holds an id, the bytes live in IndexedDB (B1311)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const imgNode = (id, alt = "site photo") => ({ type: "noteImage", attrs: { imageId: id, alt } });
const docWith = (...nodes) => ({ type: "doc", content: nodes });

describe("the Markdown export inlines pictures, and names one it could not find", () => {
  it("imageIdsInDoc finds every image, in order, once each", () => {
    const doc = docWith(imgNode("a"), { type: "paragraph", content: [{ type: "text", text: "x" }] }, imgNode("b"), imgNode("a"));
    expect(imageIdsInDoc(doc)).toEqual(["a", "b"]);
    expect(imageIdsInDoc(null)).toEqual([]);
    expect(imageIdsInDocs({ p1: docWith(imgNode("a")), p2: docWith(imgNode("b")) }).sort()).toEqual(["a", "b"]);
  });

  it("an image whose bytes we HAVE is inlined as a data URL — an export is self-contained", () => {
    const { markdown, lossy } = docToMarkdown(docWith(imgNode("a")), { images: { a: PNG } });
    expect(markdown).toContain(`![site photo](${PNG})`);
    expect(lossy).toEqual([]);
  });

  it("an image whose bytes are GONE is a named broken reference AND is reported lossy", () => {
    const { markdown, lossy } = docToMarkdown(docWith(imgNode("a")), {});
    expect(markdown).toContain("![site photo](#image-not-stored)");
    expect(lossy).toEqual(["an image whose stored copy has gone"]);
  });

  it("a notebook export carries pictures too", () => {
    const nb = { title: "N", sections: [{ title: "S", pages: [{ id: "p1", title: "P" }] }] };
    const { markdown } = notebookToMarkdown(nb, { p1: docWith(imgNode("a")) }, { images: { a: PNG } });
    expect(markdown).toContain(PNG);
  });

  it("an image inside a table cell survives the HTML fallback path", () => {
    const doc = docWith({
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [imgNode("a"), { type: "paragraph" }] }] }],
    });
    const { markdown } = docToMarkdown(doc, { images: { a: PNG } });
    expect(markdown).toContain("<table>");
    expect(markdown).toContain(PNG);
  });
});

describe("the image store — ceilings, reads, and the cascade", () => {
  /* Each case gets its OWN scope. IndexedDB persists across cases in one file, and the
   * store keys every record by scope — so a fresh scope is the honest isolation (it
   * exercises the real scoping) rather than a teardown that could hide a leak. */
  let n = 0;
  beforeEach(() => {
    mem.clear();
    store.clearNotesStorageError();
    n += 1;
    store.setNotesScope(`case${n}`);
  });

  it("a stored picture reads back, and is counted against its page", async () => {
    const r = await store.putNoteImage({ id: "i1", pageId: "p1", dataUrl: PNG, mime: "image/png" });
    expect(r.ok).toBe(true);
    expect(await store.readNoteImage("i1")).toBe(PNG);
    expect(await store.noteImageUsage(["p1"])).toBe(PNG.length);
    expect(await store.readNoteImages(["i1", "missing"])).toEqual({ i1: PNG });
  });

  it("an image over the per-image ceiling is REFUSED BY NAME and stores nothing", async () => {
    const huge = `data:image/png;base64,${"A".repeat(store.MAX_IMAGE_BYTES + 10)}`;
    const r = await store.putNoteImage({ id: "big", pageId: "p1", dataUrl: huge });
    expect(r.ok).toBe(false);
    expect(r.error, "a refusal must say what happened, not fail silently").toMatch(/too large/i);
    expect(r.error).toMatch(/NOT added/);
    expect(store.lastNotesStorageError()?.message).toBe(r.error);
    expect(await store.readNoteImage("big")).toBeNull();
  });

  it("a notebook over its total ceiling is refused too, and the message names the limit", async () => {
    await store.putNoteImage({ id: "i1", pageId: "p1", dataUrl: PNG });
    const r = await store.putNoteImage({
      id: "i2", pageId: "p1", dataUrl: `data:image/png;base64,${"A".repeat(store.MAX_NOTEBOOK_IMAGE_BYTES)}`,
      notebookPageIds: ["p1"],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/picture limit|too large/i);
  });

  it("an EMPTY notebook is charged zero, not the whole account", async () => {
    await store.putNoteImage({ id: "other", pageId: "pOther", dataUrl: PNG });
    expect(await store.noteImageUsage([])).toBe(0);
    expect(await store.noteImageUsage(null)).toBe(PNG.length);
  });

  it("two accounts on one machine never see each other's pictures", async () => {
    store.setNotesScope("userA");
    await store.putNoteImage({ id: "i1", pageId: "p1", dataUrl: PNG });
    store.setNotesScope("userB");
    expect(await store.readNoteImage("i1")).toBeNull();
    store.setNotesScope("userA");
    expect(await store.readNoteImage("i1")).toBe(PNG);
  });

  it("PURGING A PAGE DESTROYS ITS BODY **AND** ITS PICTURES", async () => {
    store.writePage("p1", docWith(imgNode("i1"), imgNode("i2")));
    await store.putNoteImage({ id: "i1", pageId: "p1", dataUrl: PNG });
    await store.putNoteImage({ id: "i2", pageId: "p1", dataUrl: PNG });
    expect(store.listStoredPageIds()).toEqual(["p1"]);

    const r = await store.purgePages(["p1"]);
    expect(r).toMatchObject({ pages: 1, images: 2 });
    expect(store.readPage("p1")).toBeNull();
    expect(await store.readNoteImage("i1")).toBeNull();
    expect(await store.readNoteImage("i2")).toBeNull();
  });

  it("the orphan sweep SPARES a binned page's pictures — that is the bin's whole point", async () => {
    await store.putNoteImage({ id: "live", pageId: "pLive", dataUrl: PNG });
    await store.putNoteImage({ id: "binned", pageId: "pBinned", dataUrl: PNG });
    await store.putNoteImage({ id: "orphan", pageId: "pGone", dataUrl: PNG });

    const swept = await store.sweepImagesOfMissingPages(["pLive", "pBinned"]);
    expect(swept).toEqual(["orphan"]);
    expect(await store.readNoteImage("live")).toBe(PNG);
    expect(await store.readNoteImage("binned"), "a restore would have nothing to show").toBe(PNG);
    expect(await store.readNoteImage("orphan")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4. THE PRINT SHEET (B1314)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the print sheet", () => {
  it("one page prints as one document, with no section furniture and no repeated title", () => {
    const html = buildPrintDocument({ title: "Deed notes", meta: "Goose Creek › Survey", pages: [{ title: "Deed notes", html: "<p>North line</p>", updatedAt: 1 }] });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<h1 class="doc-title">Deed notes</h1>');
    expect(html).toContain("Goose Creek › Survey");
    expect(html).toContain("<p>North line</p>");
    expect(html, "a single page must not be forced onto a new sheet").not.toContain('class="note-page page-break"');
  });

  it("a notebook prints section headings and starts each later page on its own sheet", () => {
    const html = buildPrintDocument({
      title: "Goose Creek",
      pages: [
        { title: "Deed", html: "<p>a</p>", sectionTitle: "Survey" },
        { title: "Plat", html: "<p>b</p>", sectionTitle: "Survey" },
        { title: "Detention", html: "<p>c</p>", sectionTitle: "Drainage" },
      ],
    });
    expect(html).toContain("Survey");
    expect(html).toContain("Drainage");
    const breaks = (html.match(/ page-break"/g) || []).length;
    expect(breaks, "the second page and the second section each start a new sheet").toBe(2);
    expect(html).toContain('<h2 class="note-page-head">Plat</h2>');
  });

  it("an empty page says so rather than printing a blank block", () => {
    expect(buildPrintDocument({ title: "T", pages: [{ title: "T", html: "" }] })).toContain("This page is empty.");
  });

  it("a title cannot inject markup into the sheet", () => {
    const html = buildPrintDocument({ title: '<script>x</script>', pages: [] });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("the sheet is light-on-white and carries no theme token — paper has no dark mode", () => {
    const html = buildPrintDocument({ title: "T", pages: [{ title: "T", html: "<p>x</p>" }] });
    expect(html).not.toContain("var(--");
    expect(html).toContain("background: #FFFFFF");
  });

  it("PDF-PARITY: every construct the screen styles is styled on the sheet as well", async () => {
    const screenCss = await import("node:fs").then((fs) => fs.readFileSync("src/workspaces/notes/components/NoteEditor.jsx", "utf8"));
    const sheet = buildPrintDocument({ title: "T", pages: [] });
    for (const construct of ["h1", "h2", "h3", "h4", "blockquote", "code", "pre", "hr", "table", "th", "img", "taskList"]) {
      expect(screenCss, `the screen must style ${construct}`).toContain(construct);
      expect(sheet, `the sheet must style ${construct} too — a screen fix that skips paper is half-done`).toContain(construct);
    }
  });
});
