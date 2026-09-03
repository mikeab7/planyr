/* notesRedline — the block-aware, formatting-preserving redline behind the conflict review's
 *  default view (the follow-up brief's NEW-2, amending B842624). PURE: every case here is a
 *  plain function call over raw ProseMirror JSON, no DOM, no editor.
 */
import { describe, it, expect } from "vitest";
import { buildRedline, buildComparison, flattenBlocks, nestByPath } from "../src/workspaces/notes/lib/notesRedline.js";

const doc = (...content) => ({ type: "doc", content });
const p = (text, marks) => ({ type: "paragraph", content: text ? [{ type: "text", text, marks }] : [] });
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const bulletList = (...items) => ({ type: "bulletList", content: items.map((c) => ({ type: "listItem", content: [c] })) });
const attachment = (name) => ({ type: "noteAttachment", attrs: { name } });
const tableRow = (text) => ({ type: "tableRow", content: [{ type: "tableCell", content: [p(text)] }] });
const table = (...rows) => ({ type: "table", content: rows.map(tableRow) });

/** Walk `buildRedline`'s nested tree and collect every LEAF in document order, for assertions
 *  that don't care about the wrapper structure. */
function leaves(nodes) {
  const out = [];
  const walk = (list) => {
    for (const n of list) {
      if (n.leaf) out.push(n.leaf);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const text = (spans) => (spans || []).map((s) => s.text).join("");

describe("buildRedline — identical documents", () => {
  it("everything reads as 'same' and changed is false", () => {
    const d = doc(h(1, "Grand Port"), p("Entitlements are on track."), bulletList(p("Item one"), p("Item two")));
    const r = buildRedline(d, d);
    expect(r.changed).toBe(false);
    expect(leaves(r.blocks).every((l) => l.status === "same")).toBe(true);
  });

  it("two empty documents produce one same, empty paragraph", () => {
    const empty = doc(p(""));
    const r = buildRedline(empty, empty);
    expect(r.changed).toBe(false);
    expect(leaves(r.blocks)).toHaveLength(1);
  });
});

describe("buildRedline — a word or two inside a long formatted note (the owner's own case)", () => {
  const local = doc(
    h(1, "Grand Port — Entitlements"),
    p("Point of contact for the utility easement is still pending review."),
    bulletList(p("Site plan submitted"), p("Drainage report submitted")),
    p("Dustin O'Neal, P: 713-428-2400"),
  );
  const server = doc(
    h(1, "Grand Port — Entitlements"),
    p("Point of contact for the utility easement is now approved."),
    bulletList(p("Site plan submitted"), p("Drainage report submitted")),
    p("Dustin O'Neal, P: 713-428-2400"),
  );
  const r = buildRedline(local, server);
  const ls = leaves(r.blocks);

  it("flags the document as changed", () => {
    expect(r.changed).toBe(true);
  });

  it("the heading, the untouched bullets and the contact line all read as 'same'", () => {
    expect(ls[0].status).toBe("same");
    expect(text(ls[0].spans)).toBe("Grand Port — Entitlements");
    expect(ls[ls.length - 1].status).toBe("same");
    expect(text(ls[ls.length - 1].spans)).toBe("Dustin O'Neal, P: 713-428-2400");
  });

  it("ONLY the one edited paragraph is 'changed' — never re-rendered as two whole competing paragraphs", () => {
    const changed = ls.filter((l) => l.status === "changed");
    expect(changed).toHaveLength(1);
    expect(ls.filter((l) => l.status === "inserted" || l.status === "deleted")).toHaveLength(0);
  });

  it("the changed block marks only the differing words — local's new wording is 'ins', server's old wording is 'del', never the reverse", () => {
    const [c] = ls.filter((l) => l.status === "changed");
    const ins = c.spans.filter((s) => s.kind === "ins").map((s) => s.text).join("");
    const del = c.spans.filter((s) => s.kind === "del").map((s) => s.text).join("");
    // local (the revised/"this window" copy) reads "…is still pending review."
    for (const w of ["still", "pending", "review"]) expect(ins).toContain(w);
    expect(ins).not.toContain("now");
    expect(ins).not.toContain("approved");
    // server (the original/"other window" copy) reads "…is now approved."
    for (const w of ["now", "approved"]) expect(del).toContain(w);
    expect(del).not.toContain("still");
    expect(del).not.toContain("pending");
    // The untouched prefix survived as ONE same-run, not fragmented word by word.
    const same = c.spans.filter((s) => s.kind === "same");
    expect(same[0].text).toBe("Point of contact for the utility easement is ");
  });

  it("both sides reconstruct exactly from the changed block's spans, whitespace included", () => {
    const [c] = ls.filter((l) => l.status === "changed");
    const sideA = c.spans.filter((s) => s.kind !== "del").map((s) => s.text).join("");
    const sideB = c.spans.filter((s) => s.kind !== "ins").map((s) => s.text).join("");
    expect(sideA).toBe("Point of contact for the utility easement is still pending review.");
    expect(sideB).toBe("Point of contact for the utility easement is now approved.");
  });
});

describe("buildRedline — whole blocks added or removed", () => {
  it("a paragraph only in the local (revised) copy is 'inserted'", () => {
    const server = doc(p("First."), p("Third."));
    const local = doc(p("First."), p("Second."), p("Third."));
    const ls = leaves(buildRedline(local, server).blocks);
    expect(ls.map((l) => l.status)).toEqual(["same", "inserted", "same"]);
    expect(text(ls[1].spans)).toBe("Second.");
    expect(ls[1].spans.every((s) => s.kind === "ins")).toBe(true);
  });

  it("a paragraph only in the server (original) copy is 'deleted'", () => {
    const server = doc(p("First."), p("Second."), p("Third."));
    const local = doc(p("First."), p("Third."));
    const ls = leaves(buildRedline(local, server).blocks);
    expect(ls.map((l) => l.status)).toEqual(["same", "deleted", "same"]);
    expect(ls[1].spans.every((s) => s.kind === "del")).toBe(true);
  });
});

describe("buildRedline — a structural change (paragraph became a heading) is never merged into a word diff", () => {
  it("shows the old paragraph deleted and the new heading inserted, not one 'changed' block wearing two tags", () => {
    const server = doc(p("Grand Port"));
    const local = doc(h(1, "Grand Port"));
    const ls = leaves(buildRedline(local, server).blocks);
    expect(ls.map((l) => l.status).sort()).toEqual(["deleted", "inserted"]);
    const ins = ls.find((l) => l.status === "inserted");
    const del = ls.find((l) => l.status === "deleted");
    expect(ins.tag).toBe("h");
    expect(del.tag).toBe("p");
  });
});

describe("buildRedline — marks survive the diff (formatting is not flattened away)", () => {
  it("a bold run that is unchanged keeps its bold mark on the 'same' span", () => {
    const boldMark = [{ type: "bold" }];
    const server = doc(p("call now", boldMark));
    const local = doc(p("call soon", boldMark));
    const ls = leaves(buildRedline(local, server).blocks);
    const same = ls[0].spans.find((s) => s.kind === "same" && s.text.includes("call"));
    expect(same.marks).toEqual(boldMark);
  });
});

describe("buildRedline — a picture/attachment/table is opaque, never diffed word-by-word", () => {
  it("an identical attachment reads as 'same'", () => {
    const d = doc(attachment("survey.pdf"));
    const r = buildRedline(d, d);
    expect(r.changed).toBe(false);
    expect(leaves(r.blocks)[0].opaque).toBe(true);
  });

  it("a different attachment shows as removed + added, each labelled by name", () => {
    const local = doc(attachment("survey-v2.pdf"));
    const server = doc(attachment("survey-v1.pdf"));
    const ls = leaves(buildRedline(local, server).blocks);
    expect(ls.map((l) => l.status).sort()).toEqual(["deleted", "inserted"]);
    expect(ls.find((l) => l.status === "inserted").label).toContain("survey-v2.pdf");
    expect(ls.find((l) => l.status === "deleted").label).toContain("survey-v1.pdf");
  });
});

describe("nestByPath — rebuilds real nesting from a flat, path-carrying list", () => {
  it("groups sibling list items under ONE bulletList wrapper", () => {
    const d = doc(bulletList(p("one"), p("two"), p("three")));
    const blocks = flattenBlocks(d);
    const tree = nestByPath(blocks);
    expect(tree).toHaveLength(1);
    expect(tree[0].wrapper.type).toBe("bulletList");
    expect(tree[0].children).toHaveLength(3);
    expect(tree[0].children.every((c) => c.wrapper?.type === "listItem")).toBe(true);
  });

  it("an unchanged list surrounding one inserted item still renders as ONE list, not two fragments", () => {
    const server = doc(bulletList(p("one"), p("three")));
    const local = doc(bulletList(p("one"), p("two"), p("three")));
    const r = buildRedline(local, server);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].wrapper.type).toBe("bulletList");
    expect(r.blocks[0].children).toHaveLength(3);
  });
});

describe("buildRedline — an opaque leaf now carries its real node (B1077680/NEW-1)", () => {
  it("a table leaf's `node` is the actual table (rows/cells), not just its label", () => {
    const d = doc(table("Executive Assistant", "O: 281-305-1115"));
    const r = buildRedline(d, d);
    const [leaf] = leaves(r.blocks);
    expect(leaf.opaque).toBe(true);
    expect(leaf.label).toBe("Table");
    expect(leaf.node.type).toBe("table");
    const rows = leaf.node.content.filter((n) => n.type === "tableRow");
    expect(rows).toHaveLength(2);
  });
});

describe("buildComparison — NEW-1/NEW-2's exact reported case: a table on one side, the same content as plain paragraphs on the other", () => {
  const CONTACT_LINES = ["Executive Assistant", "O: 281-305-1115", "M: (281) 705-2931", "E: Kandicec@quadvest.com"];
  const olderDoc = doc(p("Utility contacts"), table(...CONTACT_LINES));
  const newerDoc = doc(p("Utility contacts"), ...CONTACT_LINES.map((l) => p(l)));
  // buildComparison's first argument is always REVISED (newer); second is ORIGINAL (older).
  const cmp = buildComparison(newerDoc, olderDoc);

  it("the unified redline carries the table's real node on the removed leaf, not just its label", () => {
    const removed = leaves(cmp.blocks).find((l) => l.opaque && l.status === "deleted");
    expect(removed).toBeTruthy();
    expect(removed.node.type).toBe("table");
    const cellText = JSON.stringify(removed.node);
    for (const line of CONTACT_LINES) expect(cellText).toContain(line);
  });

  it("the OLDER pane contains the real table (an opaque 'table' leaf) — not a bare label", () => {
    const olderLeaves = leaves(cmp.panes.older);
    const tableLeaf = olderLeaves.find((l) => l.opaque && l.tag === "table");
    expect(tableLeaf).toBeTruthy();
    expect(tableLeaf.node.content.some((r) => r.type === "tableRow")).toBe(true);
  });

  it("the NEWER pane has NO table leaf at all — the table only ever existed on the older side", () => {
    const newerLeaves = leaves(cmp.panes.newer);
    expect(newerLeaves.some((l) => l.opaque && l.tag === "table")).toBe(false);
  });

  it("the NEWER pane instead carries the four contact lines as plain paragraphs", () => {
    const newerLeaves = leaves(cmp.panes.newer);
    const bodyText = newerLeaves.filter((l) => !l.opaque).map((l) => text(l.spans)).join(" ");
    for (const line of CONTACT_LINES) expect(bodyText).toContain(line);
  });

  it("REGRESSION — the two panes cannot render identically (this is the bug the owner hit: 'where is the table')", () => {
    const shapeOf = (blocks) => leaves(blocks).map((l) => (l.opaque ? `opaque:${l.tag}` : `${l.tag}:${text(l.spans)}`));
    const olderShape = shapeOf(cmp.panes.older);
    const newerShape = shapeOf(cmp.panes.newer);
    expect(olderShape).not.toEqual(newerShape);
    // The concrete, human-legible assertion: one pane's shape list literally contains the
    // table, the other's doesn't — a plain-text flatten (the old `docToText` approach) could
    // never produce this distinction, since both sides say the same words.
    expect(olderShape.some((s) => s.startsWith("opaque:table"))).toBe(true);
    expect(newerShape.some((s) => s.startsWith("opaque:table"))).toBe(false);
  });

  it("a block unchanged on both sides (the 'Utility contacts' heading paragraph) appears in BOTH panes", () => {
    const inBoth = (blocks) => leaves(blocks).some((l) => !l.opaque && text(l.spans).includes("Utility contacts"));
    expect(inBoth(cmp.panes.newer)).toBe(true);
    expect(inBoth(cmp.panes.older)).toBe(true);
  });
});

describe("buildComparison — a word-level 'changed' block splits its spans correctly per pane", () => {
  it("the newer pane shows only kept+inserted words; the older pane shows only kept+deleted words", () => {
    const server = doc(p("Point of contact is now approved."));
    const local = doc(p("Point of contact is still pending review."));
    const cmp = buildComparison(local, server);
    const newerText = leaves(cmp.panes.newer).map((l) => text(l.spans)).join("");
    const olderText = leaves(cmp.panes.older).map((l) => text(l.spans)).join("");
    expect(newerText).toBe("Point of contact is still pending review.");
    expect(olderText).toBe("Point of contact is now approved.");
  });
});

describe("buildComparison — identical documents produce two identical, unmarked panes", () => {
  it("both panes read the same when nothing differs", () => {
    const d = doc(h(1, "Grand Port"), p("Entitlements are on track."));
    const cmp = buildComparison(d, d);
    expect(cmp.changed).toBe(false);
    const shapeOf = (blocks) => leaves(blocks).map((l) => text(l.spans));
    expect(shapeOf(cmp.panes.newer)).toEqual(shapeOf(cmp.panes.older));
  });
});
