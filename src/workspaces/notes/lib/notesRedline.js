/* notesRedline — a REDLINE between two note bodies: one document, changes marked in place.
 *
 * PURE. Built for NEW-2 of the conflict-comparison follow-up (amending B842624): the owner,
 * a real-estate developer, asked for this by name — *"wouldn't a redline be better, so I can
 * see the differences over each other"* — and named his own idiom: Word's Track Changes /
 * Compare Documents, Google Docs' suggesting mode as a second reference. Two side-by-side
 * columns make a reader diff by eye; his real case is two versions that are almost entirely
 * IDENTICAL, differing by a word or two inside a long formatted note, which is exactly the
 * case side-by-side hides worst.
 *
 * ⛔ THE NAMED ANTI-PATTERNS, and how this file avoids each one:
 *  - "A developer diff" (+/- gutters, monospace, line numbers). This produces prose blocks with
 *    the note's OWN tags (heading/paragraph/list item/…) — the renderer (`NoteRedline.jsx`) owns
 *    the visual register, but the data shape here carries real block semantics, never a line
 *    number.
 *  - "Character-level noise… diff at word level at least; prefer whole changed phrases." Below
 *    the block level this diffs at WORD granularity (reusing `lcsAlign` from
 *    `notesConflictDiff.js` — one DP, not a second copy); at the block level it prefers to show
 *    an entire changed/inserted/deleted BLOCK as one unit rather than fragmenting a paragraph.
 *  - "Losing the note's own formatting… a redline that flattens to plain text is not usable."
 *    This walks the raw ProseMirror JSON directly (never `docToText`, which throws formatting
 *    away on purpose for search) and keeps each run's MARKS (bold/italic/underline/color/
 *    highlight/link) and each block's TAG (heading level, list nesting, blockquote, a colored
 *    callout, a collapsible toggle) all the way to the renderer.
 *  - "Colour as the only signal." This file only decides WHICH words differ and on which side;
 *    the renderer is what pairs that with a shape distinction (underline for an insertion,
 *    strikethrough for a deletion) so nothing here needs to assume colour survives.
 *
 * ⛔ SCOPE, STATED RATHER THAN SILENTLY MISHANDLED. A note can hold a picture, an attachment, a
 * sketch, a placed box, or a table — none of them plain running text. Diffing INSIDE one of
 * those is out of scope here (the owner's named case is headings/bullets/a contact block, all
 * running text); each is instead treated as one OPAQUE unit that compares equal only if its
 * whole node is byte-identical, and otherwise renders as a labelled placeholder ("Picture",
 * "Attachment: <name>", "Table", "Sketch", "Box") carrying the same same/inserted/deleted/
 * changed status as any text block. Nothing throws on one; nothing is silently dropped.
 *
 * ⛔ WHICH SIDE IS "REVISED" — DECIDED BY THE CALLER, ON RECENCY, NEVER BY THIS FILE (B849105,
 * corrected from an earlier version that got this wrong). Neither copy is more authoritative
 * than the other (that is the whole reason a conflict was raised), so a direction has to be
 * picked to talk about insertions vs deletions at all — but the direction has to mean something
 * a reader can trust. It used to always be "whichever copy is open in THIS browser tab", which
 * silently inverts the moment that tab happens to hold the OLDER edit: the owner watched a
 * table that had genuinely been converted-to-text (removed) render as "Table — added", because
 * his "this window" copy was the one still holding the old table. `buildRedline`'s first
 * argument is always treated as REVISED and its second as ORIGINAL (Word's Compare Documents
 * convention) — it is purely positional and knows nothing about "local"/"server". The caller
 * orders the two copies by recency first (`lib/notesVersionOrder.js`'s `orderConflictVersions`)
 * and passes the NEWER one first, so "added"/"removed" reads as a true old → new story whenever
 * that ordering is knowable. A word present only in the first (revised) argument is an
 * INSERTION; a word present only in the second (original) argument is a DELETION.
 */
import { lcsAlign } from "./notesConflictDiff.js";

/* ---- flatten a document into leaf blocks, each carrying its own nesting PATH ------------
 *
 * A path entry is `{ type, ...meta }` — e.g. `{ type: "bulletList" }`, `{ type: "listItem" }`,
 * `{ type: "callout", tone }`, `{ type: "toggle", title }` — and DELIBERATELY carries no
 * per-node instance id: two blocks compare as siblings under "the same wrapper" whenever their
 * path entries are deep-equal at that depth, which is what lets `nestByPath` re-group a flat,
 * diffed sequence back into real nested lists/blockquotes/callouts for rendering. The one
 * upside of dropping instance identity: a list that is unchanged except for one added/removed
 * item still renders as ONE <ul>, because the "local" and "server" copies of that unchanged
 * wrapper carry an identical path signature. */

function runsOfInline(content) {
  const runs = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text") { runs.push({ text: n.text || "", marks: Array.isArray(n.marks) ? n.marks : [] }); return; }
    if (n.type === "hardBreak") { runs.push({ text: "\n", marks: [] }); return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  (content || []).forEach(walk);
  return runs;
}

const plainText = (runs) => runs.map((r) => r.text).join("");

/** Every wrapper path entry carries a `uid`, minted once per AST node visited (a running,
 *  cross-call counter — see `nextUid`) — the property that makes TWO ADJACENT LIST ITEMS,
 *  which otherwise carry an IDENTICAL `{type:"listItem"}` signature, group as two separate
 *  <li>s rather than collapse into one (`nestByPath` groups by deep-equality, and without a
 *  discriminator two structurally-identical siblings are indistinguishable to it). Using a
 *  GLOBAL counter rather than one scoped to a single `flattenBlocks` call also means a wrapper
 *  from the local doc's flatten can never coincidentally collide with one from the server
 *  doc's — the one accepted trade-off is that two doc's copies of "the same" unchanged list no
 *  longer merge into one <ul> when a replace-hunk straddles them (a rare, purely cosmetic case:
 *  two adjacent lists of the same kind, never a correctness issue).
 *
 *  ⛔ THE `uid` NEVER REACHES THE SIGNATURE. `sigPath` strips it before block-matching compares
 *  two sides — matching has to survive a `uid` that is different on every call by construction
 *  (it always is, local and server are always separately flattened), so equality here has to
 *  rest on the STRUCTURAL fields alone (type, level, list kind, tone, title, …). Only the
 *  render-time nesting (`nestByPath`, run on the flat list AFTER matching already happened)
 *  ever looks at `uid`. */
let uidSeq = 0;
const nextUid = () => { uidSeq += 1; return uidSeq; };

const sigPath = (path) => path.map(({ uid, ...meta }) => meta);

function leafBlock(tag, attrs, runs, path) {
  return { tag, attrs: attrs || {}, runs, path, sig: JSON.stringify(["leaf", tag, attrs || {}, sigPath(path), plainText(runs)]) };
}

function opaqueBlock(tag, label, node, path) {
  return { tag, opaque: true, label, path, sig: JSON.stringify(["opaque", tag, sigPath(path), node]) };
}

/** Walk one document model into a flat, in-order list of leaf blocks (paragraphs, headings,
 *  code blocks, and opaque non-text nodes) — never throws on a node type it doesn't know;
 *  an unrecognised node's own content is walked as more blocks, so nothing silently vanishes. */
export function flattenBlocks(doc) {
  const out = [];

  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "doc":
        (node.content || []).forEach((k) => walk(k, path));
        return;
      case "paragraph":
        out.push(leafBlock("p", {}, runsOfInline(node.content), path));
        return;
      case "heading":
        out.push(leafBlock("h", { level: node.attrs?.level || 1 }, runsOfInline(node.content), path));
        return;
      case "codeBlock": {
        const text = (node.content || []).map((c) => c.text || "").join("");
        out.push(leafBlock("code", {}, [{ text, marks: [] }], path));
        return;
      }
      case "horizontalRule":
        out.push(opaqueBlock("hr", "Divider", node, path));
        return;
      /* ⛔ THE WRAPPER OBJECT IS BUILT ONCE, OUTSIDE THE `forEach`, AND REUSED BY REFERENCE FOR
       * EVERY CHILD — `nextUid()` inside the callback would mint a FRESH id per child, which
       * defeats the whole point (every sibling would then look like its own, un-mergeable
       * wrapper instead of sharing the one list/quote/callout it actually belongs to). */
      case "blockquote": {
        const p2 = [...path, { type: "blockquote", uid: nextUid() }];
        (node.content || []).forEach((k) => walk(k, p2));
        return;
      }
      case "bulletList":
      case "orderedList": {
        const p2 = [...path, { type: node.type, start: node.attrs?.start || 1, uid: nextUid() }];
        (node.content || []).forEach((k) => walk(k, p2));
        return;
      }
      case "taskList": {
        const p2 = [...path, { type: "taskList", uid: nextUid() }];
        (node.content || []).forEach((k) => walk(k, p2));
        return;
      }
      case "listItem": {
        const p2 = [...path, { type: "listItem", uid: nextUid() }];
        (node.content || []).forEach((k) => walk(k, p2));
        return;
      }
      case "taskItem": {
        const p2 = [...path, { type: "taskItem", checked: !!node.attrs?.checked, uid: nextUid() }];
        (node.content || []).forEach((k) => walk(k, p2));
        return;
      }
      case "noteCallout": {
        const p2 = [...path, { type: "callout", tone: node.attrs?.tone || node.attrs?.color || null, uid: nextUid() }];
        (node.content || []).forEach((k) => walk(k, p2));
        return;
      }
      case "noteToggle": {
        const titleNode = (node.content || []).find((c) => c.type === "noteToggleTitle");
        const title = titleNode ? plainText(runsOfInline(titleNode.content)) : "";
        const p2 = [...path, { type: "toggle", title, uid: nextUid() }];
        (node.content || []).filter((c) => c.type !== "noteToggleTitle").forEach((k) => walk(k, p2));
        return;
      }
      case "noteImage":
        out.push(opaqueBlock("image", "Picture", node, path));
        return;
      case "noteAttachment":
        out.push(opaqueBlock("attachment", node.attrs?.name ? `Attachment: ${node.attrs.name}` : "Attachment", node, path));
        return;
      case "noteSketch":
        out.push(opaqueBlock("sketch", "Sketch", node, path));
        return;
      case "noteAnchor":
        out.push(opaqueBlock("box", "Box", node, path));
        return;
      case "table":
        out.push(opaqueBlock("table", "Table", node, path));
        return;
      default:
        if (Array.isArray(node.content)) node.content.forEach((k) => walk(k, path));
        return;
    }
  };

  walk(doc, []);
  return out;
}

/* ---- word-level diff WITHIN one matched pair of blocks, marks preserved ------------------ */

function tokenizeRuns(runs) {
  const toks = [];
  for (const run of runs) {
    for (const part of String(run.text || "").split(/(\s+)/)) {
      if (part !== "") toks.push({ word: part, marks: run.marks || [] });
    }
  }
  return toks;
}

const sameMarks = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/** `runsA` is the REVISED (local) side, `runsB` the ORIGINAL (server) side — see the header for
 *  why. Returns spans `{ kind: "same" | "ins" | "del", text, marks }`, minimally split (a run
 *  only breaks where its kind or its marks actually change, never on every word). */
function diffRuns(runsA, runsB) {
  const ta = tokenizeRuns(runsA), tb = tokenizeRuns(runsB);
  const raw = lcsAlign(ta.map((t) => t.word), tb.map((t) => t.word));
  const spans = [];
  for (const r of raw) {
    const kind = r.type === "same" ? "same" : r.type === "a" ? "ins" : "del";
    const tok = r.type === "b" ? tb[r.bj] : ta[r.ai];
    const last = spans[spans.length - 1];
    if (last && last.kind === kind && sameMarks(last.marks, tok.marks)) last.text += tok.word;
    else spans.push({ kind, text: tok.word, marks: tok.marks });
  }
  return spans;
}

/** A whole block rendered as one uniform kind — used for a block that exists on only one side
 *  (no word-level pairing to do; the whole thing is the change). */
const wholeSpans = (runs, kind) => runs.map((r) => ({ kind, text: r.text, marks: r.marks }));

/* ---- block-level alignment, then group replace-hunks into changed/inserted/deleted -------- */

function sameShape(a, b) {
  return !a.opaque && !b.opaque && a.tag === b.tag && JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
}

function renderedLeaf(status, block, spans) {
  return block.opaque
    ? { status, path: block.path, tag: block.tag, opaque: true, label: block.label }
    : { status, path: block.path, tag: block.tag, attrs: block.attrs, spans };
}

/** The public entry. Returns `{ blocks, changed }` — `blocks` is a tree ready for
 *  `NoteRedline.jsx` to render (see `nestByPath`), `changed` is whether anything differs at
 *  all (an identical pair renders as plain "same" text with nothing to show). */
export function buildRedline(localDoc, serverDoc) {
  const blocksA = flattenBlocks(localDoc);   // revised
  const blocksB = flattenBlocks(serverDoc);  // original
  const raw = lcsAlign(blocksA.map((b) => b.sig), blocksB.map((b) => b.sig));

  const flat = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i].type === "same") {
      const b = blocksA[raw[i].ai];
      flat.push(renderedLeaf("same", b, b.opaque ? undefined : wholeSpans(b.runs, "same")));
      i += 1;
      continue;
    }
    let j = i;
    const as = [], bs = [];
    while (j < raw.length && raw[j].type !== "same") {
      if (raw[j].type === "a") as.push(raw[j].ai); else bs.push(raw[j].bj);
      j += 1;
    }
    const pairCount = Math.min(as.length, bs.length);
    for (let k = 0; k < pairCount; k += 1) {
      const A = blocksA[as[k]], B = blocksB[bs[k]];
      if (sameShape(A, B)) {
        flat.push(renderedLeaf("changed", A, diffRuns(A.runs, B.runs)));
      } else {
        flat.push(renderedLeaf("inserted", A, A.opaque ? undefined : wholeSpans(A.runs, "ins")));
        flat.push(renderedLeaf("deleted", B, B.opaque ? undefined : wholeSpans(B.runs, "del")));
      }
    }
    for (let k = pairCount; k < as.length; k += 1) {
      const A = blocksA[as[k]];
      flat.push(renderedLeaf("inserted", A, A.opaque ? undefined : wholeSpans(A.runs, "ins")));
    }
    for (let k = pairCount; k < bs.length; k += 1) {
      const B = blocksB[bs[k]];
      flat.push(renderedLeaf("deleted", B, B.opaque ? undefined : wholeSpans(B.runs, "del")));
    }
    i = j;
  }

  return { blocks: nestByPath(flat), changed: flat.some((b) => b.status !== "same") };
}

/** Group a flat, path-carrying list back into a nested tree — the inverse of flattening. Two
 *  consecutive items whose `path[depth]` is deep-equal are siblings under one wrapper; the
 *  recursion bottoms out at `path.length === depth`, where the item itself is the leaf. */
export function nestByPath(items, depth = 0) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const w = items[i].path[depth];
    if (w === undefined) { out.push({ leaf: items[i] }); i += 1; continue; }
    const key = JSON.stringify(w);
    let j = i;
    while (j < items.length && items[j].path[depth] !== undefined && JSON.stringify(items[j].path[depth]) === key) j += 1;
    out.push({ wrapper: w, children: nestByPath(items.slice(i, j), depth + 1) });
    i = j;
  }
  return out;
}
