/* NEW-1 — "Copy a notebook": a page AND everything under it, bodies, pictures and files.
 *
 * Since B1420 a "notebook" is a page with pages under it, so the copy is a SUBTREE copy. Three
 * properties are the whole feature, and each has a case below:
 *   1. PLACEMENT — the copy lands as the source's next sibling, in the SOURCE's project (it goes
 *      through `copyPageWithin`, the one copy op, which takes no project argument), with every
 *      node under a FRESH id and the nesting intact.
 *   2. BYTES — every body is copied, and every picture/file is copied to a NEW id owned by the
 *      copy. A copy that shared an asset id with its source would lose its pictures the day the
 *      source is purged (`purgePages` clears every asset the purged body references) — so that
 *      exact sequence is driven here, and the MUTATION case proves the guard goes red on a copy
 *      that shares ids.
 *   3. ALL-OR-NOTHING — a refused write leaves no copied body and no copied bytes behind.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addPage, copyPageTree, findPage, migrate, subtreePageIds } from "../src/workspaces/notes/lib/notesModel.js";
import { assetIdsInDoc, remapAssetIds } from "../src/workspaces/notes/lib/notesMarkdown.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let windowSeq = 0;
async function openWindow({ breakPageWrites = false } = {}) {
  const mem = new Map();
  let broken = false;
  const localStorage = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      if (broken && k.includes(":page:")) throw new DOMException("quota exceeded", "QuotaExceededError");
      mem.set(k, String(v));
    },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  globalThis.window = {
    localStorage,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  };
  globalThis.document = { visibilityState: "visible" };
  vi.resetModules();
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  // A distinct signed-out-shaped scope per window, so the shared fake IndexedDB never leaks
  // one case's pictures into another.
  store.setNotesScope(`copy_${(windowSeq += 1)}`);
  return { store, breakWrites: () => { if (breakPageWrites) broken = true; } };
}

const imageDoc = (imageId, text = "site photo") => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
    { type: "noteImage", attrs: { imageId, alt: "" } },
  ],
});

/** Project P holds "Entitlements" › ("Bonding" › "Surety"), "Zoning". */
function fixture() {
  let t = migrate(null);
  const top = addPage(t, { projectId: "proj_P", title: "Entitlements", id: "pg_ent" }); t = top.tree;
  t = addPage(t, { parentId: "pg_ent", title: "Bonding", id: "pg_bond" }).tree;
  t = addPage(t, { parentId: "pg_bond", title: "Surety", id: "pg_sur" }).tree;
  t = addPage(t, { parentId: "pg_ent", title: "Zoning", id: "pg_zon" }).tree;
  t = addPage(t, { projectId: "proj_P", title: "Coordination", id: "pg_coord" }).tree;
  return t;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("copyPageTree — where the copy lands", () => {
  it("copies the whole subtree as the next sibling, in the source's own project, under fresh ids", () => {
    const t = fixture();
    let n = 0;
    const r = copyPageTree(t, "pg_ent", { at: 1000, makeId: () => `new_${(n += 1)}` });
    expect(r.refused).toBeNull();
    expect(r.tree.pages.map((p) => p.title)).toEqual(["Entitlements", "Entitlements (copy)", "Coordination"]);
    const copy = r.tree.pages[1];
    expect(copy.projectId).toBe("proj_P");
    expect(copy.pages.map((p) => p.title)).toEqual(["Bonding", "Zoning"]);
    expect(copy.pages[0].pages.map((p) => p.title)).toEqual(["Surety"]);
    // Subpages never carry a project of their own — their root's is the only answer.
    expect(copy.pages[0].projectId).toBeUndefined();
    // Every copied node is new; nothing shares an id with the source.
    const copyIds = subtreePageIds(copy);
    expect(copyIds).toHaveLength(4);
    for (const id of subtreePageIds(findPage(t, "pg_ent").page)) expect(copyIds).not.toContain(id);
    expect([...r.idMap.entries()]).toEqual([["pg_ent", "new_1"], ["pg_bond", "new_2"], ["pg_sur", "new_3"], ["pg_zon", "new_4"]]);
    // The source is untouched (pure).
    expect(t.pages.map((p) => p.title)).toEqual(["Entitlements", "Coordination"]);
  });

  it("copying a SUBPAGE keeps it inside the same parent, right after the original", () => {
    const r = copyPageTree(fixture(), "pg_bond", { at: 1000 });
    const ent = findPage(r.tree, "pg_ent").page;
    expect(ent.pages.map((p) => p.title)).toEqual(["Bonding", "Bonding (copy)", "Zoning"]);
    expect(ent.pages[1].pages.map((p) => p.title)).toEqual(["Surety"]);
  });

  it("an unknown source is refused by name and the tree comes back untouched", () => {
    const t = fixture();
    const r = copyPageTree(t, "pg_nope");
    expect(r.refused).toBe("unknown-source");
    expect(r.tree).toBe(t);
    expect(r.pageId).toBeNull();
  });
});

describe("remapAssetIds", () => {
  it("re-points pictures and files, leaves everything else alone, never edits in place", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "noteImage", attrs: { imageId: "img_a" } },
        { type: "noteAnchor", attrs: { x: 1 }, content: [{ type: "noteImage", attrs: { imageId: "img_a" } }] },
        { type: "noteAttachment", attrs: { fileId: "file_b", name: "x.dwg" } },
        { type: "noteImage", attrs: { imageId: "img_unmapped" } },
      ],
    };
    const before = JSON.stringify(doc);
    const out = remapAssetIds(doc, new Map([["img_a", "img_A2"], ["file_b", "file_B2"]]));
    expect(assetIdsInDoc(out)).toEqual(["img_A2", "img_unmapped", "file_B2"]);
    expect(out.content[2].attrs.name).toBe("x.dwg");
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("duplicatePageTree — bodies and bytes", () => {
  it("copies every body and gives the copy its own pictures, which survive purging the original", async () => {
    const w = await openWindow();
    const { store } = w;
    const t = fixture();
    expect((await store.putNoteImage({ id: "img_src", pageId: "pg_sur", dataUrl: PNG, mime: "image/png", w: 1, h: 1 })).ok).toBe(true);
    store.writePage("pg_ent", { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "top words" }] }] });
    store.writePage("pg_sur", imageDoc("img_src", "surety bond"));
    // pg_bond and pg_zon deliberately have NO stored body — the copy must still get one each.

    const r = await store.duplicatePageTree(t, "pg_ent");
    expect(r.ok).toBe(true);
    expect(r.pages).toBe(4);
    expect(r.assets).toBe(1);
    expect(r.missing).toBe(0);

    const copy = findPage(r.tree, r.pageId).page;
    expect(store.readPage(copy.id).content[0].content[0].text).toBe("top words");
    for (const id of subtreePageIds(copy)) expect(store.readPage(id)).not.toBeNull();

    const surCopy = copy.pages[0].pages[0];
    const surDoc = store.readPage(surCopy.id);
    const [copiedImg] = assetIdsInDoc(surDoc);
    expect(copiedImg).toBeTruthy();
    expect(copiedImg).not.toBe("img_src");
    expect(await store.readNoteImage(copiedImg)).toBe(PNG);

    // THE REASON THE BYTES ARE COPIED: purge the ORIGINAL subtree forever — the copy's picture
    // must still be there, and the sweep that runs on load must not take it either.
    await store.purgePages(subtreePageIds(findPage(t, "pg_ent").page));
    expect(await store.readNoteImage("img_src")).toBeNull();
    expect(await store.readNoteImage(copiedImg)).toBe(PNG);
    await store.sweepImagesOfMissingPages(subtreePageIds(copy));
    expect(await store.readNoteImage(copiedImg)).toBe(PNG);
  });

  it("MUTATION — a copy that SHARES its source's picture id loses it when the source is purged", async () => {
    const { store } = await openWindow();
    await store.putNoteImage({ id: "img_shared", pageId: "pg_sur", dataUrl: PNG, mime: "image/png" });
    store.writePage("pg_sur", imageDoc("img_shared"));
    store.writePage("pg_naive_copy", imageDoc("img_shared"));   // what copying the body alone would do
    await store.purgePages(["pg_sur"]);
    expect(await store.readNoteImage("img_shared")).toBeNull();   // the copy's picture is gone — the defect
  });

  it("a picture already missing from the source is counted, re-keyed, and not a failure", async () => {
    const { store } = await openWindow();
    store.writePage("pg_sur", imageDoc("img_gone"));
    const r = await store.duplicatePageTree(fixture(), "pg_bond");
    expect(r.ok).toBe(true);
    expect(r.missing).toBe(1);
    const copy = findPage(r.tree, r.pageId).page;
    const [ref] = assetIdsInDoc(store.readPage(copy.pages[0].id));
    expect(ref).not.toBe("img_gone");
  });

  it("an unknown source is refused and nothing is written", async () => {
    const { store } = await openWindow();
    const t = fixture();
    const r = await store.duplicatePageTree(t, "pg_nope");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not be copied/);
    expect(r.tree).toBe(t);
  });

  it("ALL-OR-NOTHING — a refused body write rolls back every body and picture already copied", async () => {
    const w = await openWindow({ breakPageWrites: true });
    const { store } = w;
    await store.putNoteImage({ id: "img_src", pageId: "pg_ent", dataUrl: PNG, mime: "image/png" });
    store.writePage("pg_ent", imageDoc("img_src"));
    const before = store.listStoredPageIds().sort();
    const t = fixture();
    w.breakWrites();
    const r = await store.duplicatePageTree(t, "pg_ent");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing was copied/);
    expect(r.tree).toBe(t);
    expect(store.listStoredPageIds().sort()).toEqual(before);
    expect(await store.noteImageUsage()).toBe((await store.noteImageUsage(["pg_ent"])));   // only the source's bytes remain
  });
});
