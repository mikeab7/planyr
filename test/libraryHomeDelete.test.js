/* B2086368 — the Library Home's RECENT and UNFILED rows had no delete (owner report 2026-10-04, build f853752): a file
 * saved from Review with no project could never be removed. Red on the unmodified tree: neither card rendered any
 * delete control. The browser-level proof (real clicks, the PATCH on the wire, restore, delete-forever, 44px target)
 * is ui-audit/verify-library-home-delete.mjs; this is the CI-runnable half. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { UnfiledCard, FileCard } from "../src/workspaces/library/components/LibraryHome.jsx";
import { DeleteButton } from "../src/workspaces/library/components/ReviewTrash.jsx";

const read = (r) => readFileSync(fileURLToPath(new URL(r, import.meta.url)), "utf8");
const trash = { armed: false, onArm() {}, onCancel() {}, onConfirm() {} };
const TITLE = 'title="Delete (moves to Recently deleted)"';

describe("Home rows carry the project tree's delete ✕", () => {
  for (const sfile of ["a.pdf", "b.docx", "c.png"]) {
    it(`an UNFILED ${sfile} row has the ✕`, () => {
      const html = renderToStaticMarkup(createElement(UnfiledCard, { doc: { id: "r1", title: "T", sfile }, trash }));
      expect(html).toContain(TITLE);
      expect(html).toContain(">✕<");
    });
    it(`a RECENT ${sfile} row has the ✕`, () => {
      const html = renderToStaticMarkup(createElement(FileCard, { doc: { id: "r1", title: "T", sfile }, trash }));
      expect(html).toContain(TITLE);
    });
  }
  it("the ✕ is a real, enabled <button> (keyboard reachable) with an accessible name and the coarse-pointer class", () => {
    const html = renderToStaticMarkup(createElement(DeleteButton, { id: "r1", armed: false, label: "Memo", onArm() {} }));
    expect(html).toMatch(/^<button /);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("tabindex");
    expect(html).toContain('aria-label="Delete “Memo” (moves to Recently deleted)"');
    expect(html).toContain('class="trash-del"');
  });
  it("armed, it asks 'Move to Recently deleted?' with a confirm that takes focus", () => {
    const html = renderToStaticMarkup(createElement(DeleteButton, { id: "r1", armed: true, label: "Memo", onConfirm() {}, onCancel() {} }));
    expect(html).toContain("Move to Recently deleted?");
    expect(html).toContain('data-testid="trash-confirm"');
  });
  it("without the prop a row has no ✕ (a card never offers a delete it cannot honour)", () => {
    expect(renderToStaticMarkup(createElement(UnfiledCard, { doc: { id: "r1", title: "T" } }))).not.toContain("Recently deleted");
  });
});

describe("one implementation, two surfaces", () => {
  const home = read("../src/workspaces/library/components/LibraryHome.jsx");
  const fb = read("../src/workspaces/library/components/FileBrowser.jsx");
  it("Home wires the delete into BOTH the Recent and the Unfiled rows, and renders the shared bin", () => {
    expect(home).toMatch(/<FileCard doc=\{r\.doc\}[\s\S]{0,300}trash=\{rowTrash\(r\.id\)\}/);
    expect(home).toMatch(/<UnfiledCard[\s\S]{0,300}trash=\{rowTrash\(d\.id\)\}/);
    expect(home).toContain("<RecentlyDeletedList");
    expect(home).toContain("listDeletedReviews");
  });
  it("neither surface calls restoreReview/purgeReview, or deletes a ROW, itself — only the shared hook does", () => {
    for (const src of [home, fb]) {
      expect(src).toContain("ReviewTrash.jsx");
      expect(src).not.toMatch(/\b(restoreReview|purgeReview)\(/);
    }
    expect(home).not.toMatch(/\bdeleteReview\(/);
    // FileBrowser's one remaining call is the upload "Replace existing" path (a different flow, not a row ✕).
    expect((fb.match(/\bdeleteReview\(/g) || []).length).toBe(1);
    expect(fb).toContain("useReviewTrash(");
    expect(home).toContain("useReviewTrash(");
  });
  it("the 44px coarse-pointer rule exists for the ✕", () => {
    expect(read("../src/index.css")).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.trash-del\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px/);
  });
});
