/* notesBlockMerge — PER-PARAGRAPH concurrent-edit merge (NEW-1, "like we do on the site
 * planner… if I'm editing and someone else is editing, both the edits go in").
 *
 * ⛔ OWNER DECISION, ALREADY MADE — DO NOT RE-OPEN IT. Per-PARAGRAPH (block-level) merge.
 * Per-CHARACTER (a CRDT) was offered explicitly and deliberately deferred. This file does
 * NOT change how a note is stored — the persisted shape is still one ProseMirror JSON `doc`
 * per page — it only decides, PURELY, what the merged `doc` looks like when two copies of
 * the same page have diverged from a shared ancestor.
 *
 * ⛔ WHAT THE SITE PLANNER ACTUALLY DOES, AND WHY THIS IS NOT A PORT OF IT. Site Planner's
 * `elementSync.js` is a live, per-tab, in-memory optimistic-concurrency engine over a
 * REALTIME stream of per-element rows (shadow/dirty/recent maps, a 15s "I just authored
 * this" window, `direct`-vs-derived tagging, semantic-equality-suppressed toasts — see
 * `docs/NOTES-CARRY-FORWARD.md`'s NEW-1 entry for the full digest). Notes has no such
 * per-keystroke wire: a page is one WHOLE DOCUMENT, synced by a `rev`-guarded push/pull
 * (see `lib/notesCloud.js`), and a conflict is detected only when a push is refused because
 * the server's row moved. So the REUSABLE part of the analogy is the CONCEPT — resolve at a
 * finer grain than "the whole object", let non-overlapping edits combine silently, keep a
 * real disagreement visible and non-destructive — not the mechanism. The pieces that ARE
 * reused directly: `judgeConflict`'s existing semantic-equality suppression (identical /
 * litter-only), the existing pick-one UI (`ConflictNotice`/`ConflictReview`) as the
 * unconditional fallback, and `notesVersionOrder.js`'s recency ordering. The pieces that do
 * NOT translate: shadow/dirty/recent maps (there is nothing to track per-keystroke), a
 * `direct`-vs-derived authorship tag (Notes already has the equivalent protection —
 * `hasUserInputRef`, B1662464 — gating what counts as a real edit in the first place, so a
 * derived write here never reaches `dirty` at all), and per-tab-session journal namespacing
 * (Notes' cross-tab coordination already goes through the server-owned `rev` +
 * `mergeSyncState`'s dirty-flag reconciliation, not a separate journal file — the Silvestri
 * "Utility" banner is NOT a repeat of Site Planner's B846 namespacing bug; it is today's
 * conflict system correctly detecting a real divergence at WHOLE-DOCUMENT granularity, which
 * is exactly what this file narrows).
 *
 * ⛔ A REAL 3-WAY MERGE NEEDS A REAL BASE, WHICH IS WHY THIS DOES NOT TRY TO GUESS ONE FROM
 * JUST THE TWO CURRENT COPIES. Given only `localDoc` and `serverDoc`, a block that differs
 * between them is ambiguous: did local change it (server's copy is the untouched original),
 * did server change it (local's copy is the untouched original), or did BOTH change the same
 * original into two different things? Two-way diffing cannot tell these apart. The caller
 * (`lib/notesStore.js`) is responsible for supplying `baseDoc` — the last document BOTH sides
 * are known to have agreed on (see `notesMergeBase` functions there) — and this file simply
 * declines (returns `null`) when no base is available, which sends the caller back to the
 * existing whole-document pick-one banner. THAT FALLBACK IS THE CORRECT OUTCOME, NOT A
 * FAILURE — see the header of `ConflictNotice.jsx`.
 *
 * ═══ THE ALGORITHM — a standard "diff3" three-way merge over BLOCKS, not lines ═════════════
 * 1. Flatten base/local/server into ordered leaf blocks (`notesRedline.js`'s `flattenBlocks`,
 *    already used by the redline view — one flattener, not a second copy).
 * 2. Diff base→local and base→server independently (`lcsAlign`, from `notesConflictDiff.js`).
 * 3. Turn each diff into an ordered list of DISPUTED RANGES over the shared base-index space —
 *    a contiguous run of base blocks one side changed/removed, or a zero-width point where
 *    that side inserted something new. Untouched base blocks need no range at all.
 * 4. Merge the two sides' range lists by CLUSTERING any ranges that overlap or touch (from
 *    either side) into one region. A cluster touched by only one side applies silently. A
 *    cluster touched by both sides is a real conflict UNLESS both sides produced the exact
 *    same resulting blocks (a coincidental identical edit is not a disagreement).
 * 5. Rebuild a full document from the untouched blocks plus each cluster's resolution,
 *    walking the base's own order — twice, once preferring local at any true conflict and
 *    once preferring server, so the caller always has both full candidates even when they
 *    turn out identical (no real conflict at all).
 *
 * ⛔ CONSERVATIVE WHERE IT MATTERS, NOT EVERYWHERE. Two ranges cluster (and are therefore
 * judged a potential conflict) only on a GENUINE overlap — sharing at least one base block.
 * Merely touching at a boundary (a pure insertion anchored right where the other side edited
 * the very next block) is not a disagreement about the same content and does not cluster —
 * an earlier version used "touching" as the bar and it produced false conflicts on the most
 * common shape this feature exists for (an insertion beside an edit, a deletion beside an
 * edit — see `test/notesBlockMerge.test.js`). Where two edits truly do touch the same base
 * block, this file never guesses: a missed conflict would mean silently picking one person's
 * words over the other's, so any genuine overlap is judged a conflict unless both sides
 * produced byte-identical results. The cost of that caution is, at worst, one more trip
 * through the existing (safe, non-destructive) pick-one banner. See "KEEP THE SAFETY NET" in
 * the dispatch brief this file answers.
 */
import { flattenBlocks } from "./notesRedline.js";
import { lcsAlign } from "./notesConflictDiff.js";

/* ---- step 2/3: one side's diff against base, as ordered disputed ranges ------------------ */

/** `baseSigs`/`otherSigs` are the flattened blocks' `.sig` strings. Returns an ordered list of
 *  `{ start, end, blocks }` — `[start, end)` is the base-index range this range replaces
 *  (`start === end` for a pure insertion, anchored immediately before base index `start`).
 *  `blocks` are the OTHER side's actual flattened block objects for this range, in order.
 *  Untouched ("same") base blocks contribute nothing — there is nothing to dispute. */
function disputedRanges(baseSigs, otherBlocks) {
  const otherSigs = otherBlocks.map((b) => b.sig);
  const raw = lcsAlign(baseSigs, otherSigs);
  const ranges = [];
  let i = 0;
  let pos = 0; // next expected base index, since "same"/"a" ops consume base indexes in order
  while (i < raw.length) {
    if (raw[i].type === "same") { pos += 1; i += 1; continue; }
    let j = i;
    let removedCount = 0;
    const otherIdxs = [];
    while (j < raw.length && raw[j].type !== "same") {
      if (raw[j].type === "a") removedCount += 1; else otherIdxs.push(raw[j].bj);
      j += 1;
    }
    ranges.push({ start: pos, end: pos + removedCount, blocks: otherIdxs.map((k) => otherBlocks[k]) });
    pos += removedCount;
    i = j;
  }
  return ranges;
}

/* ---- step 4: cluster both sides' ranges, deciding what's silent vs. a real conflict ------- */

/** One merged region of base-index space. `mineBlocks`/`theirsBlocks` are what LOCAL/SERVER
 *  each want there; `conflict` is true only when both sides touched it AND their results
 *  genuinely differ. A region touched by only one side has that side's blocks on both
 *  `mineBlocks` and `theirsBlocks` (there is nothing to disagree about, so both candidates
 *  agree here too — that is what lets the caller build one clean merged doc when there is no
 *  conflict anywhere at all). */
function clusterRegions(localRanges, serverRanges, baseBlocks) {
  const tagged = [
    ...localRanges.map((r) => ({ ...r, side: "local" })),
    ...serverRanges.map((r) => ({ ...r, side: "server" })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters = [];
  for (const r of tagged) {
    const last = clusters[clusters.length - 1];
    /* ⛔ STRICT overlap (`<`), never touching (`<=`) — a hunk sharing only a BOUNDARY POINT
     * with another is not a disagreement about the same content. A pure insertion is a
     * zero-width range anchored right before some base index; a neighbouring side's edit to
     * that exact base index starts exactly where the insertion sits, and the two are
     * genuinely independent (insert-before-X and edit-X do not touch the same words). Using
     * `<=` here merged them into one false "conflict" every time — caught by this file's own
     * unit tests (an insertion by one side beside an edit by the other, and a deletion beside
     * an edit, both failed until this was corrected). Two zero-width insertions anchored at
     * the exact same point are the one case this leaves unclustered — a fine outcome: both
     * apply, in the order they were compared (stable sort keeps local before server), same
     * as any two independent insertions. */
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
      last.items.push(r);
    } else {
      clusters.push({ start: r.start, end: r.end, items: [r] });
    }
  }

  /* ⛔ A SIDE'S OWN HUNKS INSIDE A CLUSTER MAY NOT COVER THE WHOLE CLUSTER (found by this
   * file's own two-client integration test, not reasoned out in advance). A cluster's range
   * is the UNION of every hunk that touches it from either side — one side's single hunk can
   * make the union wider than the OTHER side's own hunk(s) inside it, when that other side
   * left some of the union's base blocks alone. Naively concatenating only "the touching
   * side's own replacement blocks" for the whole union then SILENTLY DROPS whatever that
   * side left untouched in the gap — exactly the safety-net violation this feature exists to
   * prevent, and it does not even show up as a conflict (it looked, and was, "clean" for
   * that side's own candidate). The fix: reconstruct a side's contribution to the WHOLE
   * cluster range by walking base-index order and filling any gap between/around that side's
   * own hunks with the ORIGINAL base blocks — which is exactly what "this side left it alone"
   * means. */
  const sideBlocksFor = (items, start, end) => {
    const out = [];
    let pos = start;
    for (const it of items) {
      while (pos < it.start) { out.push(baseBlocks[pos]); pos += 1; }
      out.push(...it.blocks);
      pos = it.end;
    }
    while (pos < end) { out.push(baseBlocks[pos]); pos += 1; }
    return out;
  };

  return clusters.map((c) => {
    const localItems = c.items.filter((it) => it.side === "local").sort((a, b) => a.start - b.start);
    const serverItems = c.items.filter((it) => it.side === "server").sort((a, b) => a.start - b.start);
    const hasLocal = localItems.length > 0;
    const hasServer = serverItems.length > 0;
    let mineBlocks, theirsBlocks, conflict;
    if (hasLocal && hasServer) {
      mineBlocks = sideBlocksFor(localItems, c.start, c.end);
      theirsBlocks = sideBlocksFor(serverItems, c.start, c.end);
      const same = sameBlockSeq(mineBlocks, theirsBlocks);
      if (same) theirsBlocks = mineBlocks;
      conflict = !same;
    } else if (hasLocal) {
      mineBlocks = sideBlocksFor(localItems, c.start, c.end); theirsBlocks = mineBlocks; conflict = false;
    } else {
      mineBlocks = sideBlocksFor(serverItems, c.start, c.end); theirsBlocks = mineBlocks; conflict = false;
    }
    return { start: c.start, end: c.end, mineBlocks, theirsBlocks, conflict };
  });
}

const sameBlockSeq = (a, b) => a.length === b.length && a.every((blk, i) => blk.sig === b[i].sig);

/* ---- step 5: rebuild a full flat block list from base + clusters, then a real PM doc ------ */

function buildFlat(baseBlocks, clusters, prefer) {
  const out = [];
  let bi = 0;
  for (const cluster of clusters) {
    while (bi < cluster.start) { out.push(baseBlocks[bi]); bi += 1; }
    const blocks = prefer === "local" ? cluster.mineBlocks : cluster.theirsBlocks;
    out.push(...blocks);
    bi = cluster.end;
  }
  while (bi < baseBlocks.length) { out.push(baseBlocks[bi]); bi += 1; }
  return out;
}

/* ---- flat leaf blocks → a real ProseMirror document --------------------------------------
 *
 * The inverse of `flattenBlocks`. Every leaf in the flat list already carries its own exact,
 * untouched `node` (a leaf's own JSON) or, for an opaque block, `node` is already the whole
 * node — so rebuilding is purely a matter of re-nesting by `path`, the same grouping
 * `notesRedline.js`'s `nestByPath` already does for its own (rendering-shaped) tree, done
 * here to produce REAL ProseMirror nodes instead. */
/** `raw`, when present, is the WRAPPER NODE's own original `attrs` — captured by
 *  `flattenBlocks` specifically so this function never has to re-derive an attribute the
 *  signature's cherry-picked fields don't cover (a toggle's `open` state, most concretely).
 *  It always wins over the cherry-picked fallback below, which exists only for a wrapper
 *  `flattenBlocks` never attached one to (there is no such case today, but a future node type
 *  added to that switch without a matching `raw` should still reconstruct SOMETHING rather
 *  than throw). */
function wrapperToNode(w, content) {
  switch (w.type) {
    case "blockquote": return { type: "blockquote", ...(w.raw ? { attrs: w.raw } : {}), content };
    // ⛔ `bulletList`'s wrapper signature carries a `start` field too (see `flattenBlocks` —
    // both list types share one case arm), but a bulletList node has no `start` ATTRIBUTE in
    // the schema at all, so it must never be written back onto one — `raw` is the real attrs
    // of the ORIGINAL bulletList node (never containing `start`), so it stays safe to spread.
    case "bulletList": return { type: "bulletList", ...(w.raw ? { attrs: w.raw } : {}), content };
    case "orderedList": return { type: "orderedList", attrs: w.raw || { start: w.start || 1 }, content };
    case "taskList": return { type: "taskList", ...(w.raw ? { attrs: w.raw } : {}), content };
    case "listItem": return { type: "listItem", attrs: w.raw || (w.indent ? { indent: w.indent } : {}), content };
    case "taskItem": return { type: "taskItem", attrs: w.raw || { checked: !!w.checked, indent: w.indent || 0 }, content };
    case "callout": return { type: "noteCallout", attrs: w.raw || { tone: w.tone ?? null }, content };
    case "toggle": return {
      type: "noteToggle",
      ...(w.raw?.attrs ? { attrs: w.raw.attrs } : {}),
      content: [
        w.raw?.titleNode || { type: "noteToggleTitle", content: w.title ? [{ type: "text", text: w.title }] : [] },
        ...content,
      ],
    };
    default: return { type: w.type, ...(w.raw ? { attrs: w.raw } : {}), content };
  }
}

function nestToNodes(items, depth) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const w = items[i].path[depth];
    if (w === undefined) { out.push(items[i].node); i += 1; continue; }
    const key = JSON.stringify(w);
    let j = i;
    while (j < items.length && items[j].path[depth] !== undefined && JSON.stringify(items[j].path[depth]) === key) j += 1;
    out.push(wrapperToNode(w, nestToNodes(items.slice(i, j), depth + 1)));
    i = j;
  }
  return out;
}

function flatToDoc(flat) {
  return { type: "doc", content: nestToNodes(flat, 0) };
}

/* ---- the public entry ---------------------------------------------------------------------
 *
 * Returns `null` when a merge cannot be attempted at all (no usable base — the caller falls
 * back to the existing whole-document banner). Otherwise:
 *   `{ clean: true,  mergedDoc }`                 — no real conflict anywhere; use `mergedDoc`.
 *   `{ clean: false, mineDoc, theirsDoc, regions }` — at least one region is genuinely
 *      disputed. `mineDoc` keeps THIS side's content there (and everything else from both
 *      sides); `theirsDoc` keeps the OTHER side's. `regions` names how many blocks are in
 *      dispute, for telemetry/testing — never rendered to the user as a number (house style).
 */
export function mergeNoteDocs({ baseDoc, localDoc, serverDoc }) {
  if (baseDoc == null || localDoc == null || serverDoc == null) return null;

  const baseBlocks = flattenBlocks(baseDoc);
  const localBlocks = flattenBlocks(localDoc);
  const serverBlocks = flattenBlocks(serverDoc);
  const baseSigs = baseBlocks.map((b) => b.sig);

  const localRanges = disputedRanges(baseSigs, localBlocks);
  const serverRanges = disputedRanges(baseSigs, serverBlocks);
  if (!localRanges.length && !serverRanges.length) {
    // Neither side touched anything relative to base — the docs are identical to it (and so
    // to each other). `judgeConflict`'s "identical" path already covers this; reaching here
    // with nothing to do is harmless.
    return { clean: true, mergedDoc: baseDoc, regions: 0 };
  }

  const clusters = clusterRegions(localRanges, serverRanges, baseBlocks);
  const conflicted = clusters.filter((c) => c.conflict);

  if (!conflicted.length) {
    const mergedDoc = flatToDoc(buildFlat(baseBlocks, clusters, "local"));
    return { clean: true, mergedDoc, regions: clusters.length };
  }

  const mineDoc = flatToDoc(buildFlat(baseBlocks, clusters, "local"));
  const theirsDoc = flatToDoc(buildFlat(baseBlocks, clusters, "server"));
  return { clean: false, mineDoc, theirsDoc, regions: conflicted.length };
}
