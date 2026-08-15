/* A PICTURE IS A CANVAS OBJECT, NOT AN INLINE ATTACHMENT (NEW-PICTURE-CANVAS).
 *
 * ⛔ HIS ASK: *"I feel like I should just be able to drop a picture in there and move it around,
 * like, however I want to, like a proper canvas."* And the architectural instruction that came
 * with it, which this file exists to hold to: *"the positioned anchor you already have is a box
 * at an (x, y) with a width that happens to hold TEXT. Generalise it to hold CONTENT — text or an
 * image. Then everything already built and hard-won comes free and stays consistent… A parallel
 * 'image object' implementation would be a second copy of every bug we have spent two days
 * finding once."*
 *
 * ⛔ SO THE POINT OF THIS FILE IS TO PROVE THE THINGS THAT ARE SUPPOSED TO COME FOR FREE ACTUALLY
 * DO. "It reuses the existing machinery" is a claim, and every one of the four properties below
 * is a place where a nested picture could silently fall out of that machinery:
 *   1. the PRUNE could eat it (an anchor holding no text is not an empty anchor);
 *   2. the PURGE CASCADE could miss it (a picture nested one level deeper than any before it);
 *   3. the MARKDOWN export could drop it, or drop it SILENTLY, which is worse;
 *   4. the stored round trip could change a document that has no pictures in it at all.
 * Each is asserted rather than reasoned about, because each was true by inheritance and none of
 * them was true by design — an inherited property nobody has checked is a coincidence.
 */
import { describe, expect, it } from "vitest";

import { anchorIsEmpty, countEmptyAnchors, pruneEmptyAnchors } from "../src/workspaces/notes/lib/notesAnchorPrune.js";
import { assetIdsInDoc, docToMarkdown, imageIdsInDoc } from "../src/workspaces/notes/lib/notesMarkdown.js";
import { handlesFor, hasFixedHeight } from "../src/workspaces/notes/lib/notesBoxResize.js";

/** A picture dropped on the page: a positioned box whose whole content is one image. */
const pictureBox = (attrs = {}) => ({
  type: "noteAnchor",
  attrs: { x: 620, y: 240, w: 320, h: 180, aid: "a1", ...attrs },
  content: [{ type: "noteImage", attrs: { imageId: "img_dropped", alt: "site.png", w: 1600, h: 900 } }],
});

const textBox = () => ({
  type: "noteAnchor",
  attrs: { x: 100, y: 40, w: 180, h: null, aid: "a2" },
  content: [{ type: "paragraph", content: [{ type: "text", text: "MUD 377" }] }],
});

const emptyBox = () => ({ type: "noteAnchor", attrs: { x: 10, y: 10, w: 180, h: null }, content: [{ type: "paragraph" }] });

const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "notes" }] }, ...content] });

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 1 · THE PRUNE MUST NOT EAT IT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ a box holding only a picture is not an EMPTY box", () => {
  /* ⛔ THIS IS THE ONE THAT WOULD HAVE DESTROYED REAL WORK. An abandoned press leaves a
   * provisional box, and `writePage` prunes every empty one at the STORAGE SEAM — so if a picture
   * box read as empty, dropping a photo would put it on screen and then quietly fail to save it,
   * with the loss only visible after a reload. It is safe because `anchorIsEmpty` is a WHITELIST
   * (only a plain paragraph can leave a box empty) rather than a text check, which is the design
   * decision this test exists to pin: the file says "a node type added next year is UNKNOWN, and
   * unknown must mean keep", and a picture in a box is exactly that case arriving. */
  it("⛔ a picture box survives the prune — it is somebody's work, not an abandoned press", () => {
    expect(anchorIsEmpty(pictureBox())).toBe(false);
    const before = doc(pictureBox(), emptyBox());
    const { doc: after, removed } = pruneEmptyAnchors(before);
    expect(removed, "only the genuinely empty one goes").toBe(1);
    expect(imageIdsInDoc(after), "the picture is still there").toEqual(["img_dropped"]);
  });

  it("…and it is not counted as one either", () => {
    expect(countEmptyAnchors(doc(pictureBox(), emptyBox()))).toBe(1);
  });

  it("a box holding a picture AND a caption is not empty either", () => {
    const captioned = { ...pictureBox(), content: [...pictureBox().content, { type: "paragraph" }] };
    expect(anchorIsEmpty(captioned)).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 2 · THE PURGE CASCADE MUST SEE IT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ the purge cascade reaches a picture nested inside a box (TOMBSTONE-DELETES)", () => {
  /* ⛔ HIS INSTRUCTION, verbatim: *"Mind the purge cascade — an image on a purged note must not be
   * orphaned in the bucket, and a restored note must still find its picture."* A picture inside a
   * box sits one level deeper in the document than any picture before it, and `assetIdsInDoc` is
   * what every delete path asks. It happens to recurse, so this works — which is a reason to
   * ASSERT it, not a reason to assume it: the day somebody optimises that walk to look only at
   * the document's top-level children, a purged note leaves bytes in the bucket forever and
   * nothing anywhere says so. */
  it("⛔ `imageIdsInDoc` finds a picture inside a positioned box", () => {
    expect(imageIdsInDoc(doc(pictureBox()))).toEqual(["img_dropped"]);
  });

  it("⛔ …and so does `assetIdsInDoc`, which is what the purge actually asks", () => {
    expect(assetIdsInDoc(doc(pictureBox()))).toEqual(["img_dropped"]);
  });

  it("it finds one nested inside a box inside a callout — depth is not a special case", () => {
    const deep = doc({ type: "noteCallout", attrs: { tone: "note" }, content: [pictureBox()] });
    expect(assetIdsInDoc(deep)).toEqual(["img_dropped"]);
  });

  it("several dropped at once are all accounted for, in document order", () => {
    const many = doc(
      pictureBox({ aid: "a1" }),
      { ...pictureBox({ aid: "a2" }), content: [{ type: "noteImage", attrs: { imageId: "img_b" } }] },
      { ...pictureBox({ aid: "a3" }), content: [{ type: "noteImage", attrs: { imageId: "img_c" } }] },
    );
    expect(imageIdsInDoc(many)).toEqual(["img_dropped", "img_b", "img_c"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 3 · MARKDOWN CARRIES IT, AND NAMES WHAT IT CANNOT CARRY
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ the Markdown export carries the picture and STATES that the position did not survive", () => {
  /* ⛔ HIS INSTRUCTION: *"Markdown cannot represent a position — state what happens there rather
   * than silently dropping it."* Both halves matter and the second is the one that rots: an
   * export that quietly flattens a placed picture into an ordinary inline image claims to be a
   * faithful copy of the page when it is not, and nobody finds out until they need the copy. */
  it("the picture itself is exported", () => {
    const { markdown } = docToMarkdown(doc(pictureBox()), { images: { img_dropped: "data:image/png;base64,AAA" } });
    expect(markdown).toContain("data:image/png;base64,AAA");
    expect(markdown).toContain("site.png");
  });

  it("⛔ …and the lost placement is NAMED rather than dropped in silence", () => {
    const { lossy } = docToMarkdown(doc(pictureBox()), { images: {} });
    expect(lossy.join(" | ")).toMatch(/placed at a point on the page/);
  });

  it("a note with no placed box claims no such loss", () => {
    const { lossy } = docToMarkdown(doc({ type: "paragraph", content: [{ type: "text", text: "plain" }] }), {});
    expect(lossy.join(" | ")).not.toMatch(/placed at a point/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 4 · NOTHING THAT HAS NO PICTURES IN IT MAY CHANGE
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ `h: null` is a meaning, so no existing note is rewritten", () => {
  /* ⛔ A NEW ATTRIBUTE IS A MIGRATION UNLESS IT RENDERS NOTHING AT ITS DEFAULT. Every box written
   * before this round has no height, and `null` has to keep meaning "my height is my content" —
   * both so a text box behaves exactly as it did, and so opening an old note does not rewrite
   * thousands of blocks with a setting nobody chose. That is the same discipline `indent` follows
   * in `notesIndentLevel.js`, and it is why the round trip below is asserted on the BYTES. */
  it("a text box has no height of its own", () => {
    expect(hasFixedHeight(textBox())).toBe(false);
    expect(textBox().attrs.h).toBeNull();
  });

  it("a picture box does", () => {
    expect(hasFixedHeight(pictureBox())).toBe(true);
  });

  it("⛔ a document with no pictures survives a prune round trip BYTE-IDENTICAL", () => {
    const before = doc(textBox());
    const json = JSON.stringify(before);
    const { doc: after, removed } = pruneEmptyAnchors(before);
    expect(removed).toBe(0);
    expect(after, "the same object, not a fresh copy").toBe(before);
    expect(JSON.stringify(after)).toBe(json);
  });

  /* ⛔ AND THE HANDLES A BOX OFFERS FOLLOW ITS CONTENT, which is the whole of "generalise the box
   * to hold CONTENT". A text box gets the two that are fully defined for it; the north/south
   * question on text is open with the owner (B539650) and is not guessed at here. */
  it("⛔ a picture box offers all eight handles, a text box the two that are defined", () => {
    expect(handlesFor(pictureBox())).toHaveLength(8);
    expect(handlesFor(textBox()).sort()).toEqual(["e", "w"]);
  });
});
