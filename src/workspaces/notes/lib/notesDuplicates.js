/* notesDuplicates — THE SAME NOTE LIVING IN TWO PROJECTS, FOUND BY A MACHINE (NEW-4).
 *
 * ⛔ WHY THIS EXISTS AT ALL. One note — Grand Port's "Coordination" — turned up with a
 * near-identical twin filed under an unrelated Colorado pursuit. It was found BY HAND, six
 * days later, and only because the pursuit had since been deleted and both copies fell into
 * a "from a project you deleted" heading the owner happened to open. Nothing in the product
 * could have told him. A defect nobody can observe is one that gets closed on a null and
 * comes back (STANDING RULE #2), so the observation is the deliverable here, not a nicety.
 *
 * ⛔ THE QUESTION IT ANSWERS IS DELIBERATELY NARROW: are there two pages whose TEXT is the
 * same or nearly the same while their PROJECTS differ? Not "are these pages similar" — two
 * meeting notes for the same job legitimately rhyme, and flagging those would train the
 * owner to ignore the banner, which is worse than not having one.
 *
 *   • SAME PROJECT IS NEVER A FINDING. Copying a note inside its own project is an ordinary
 *     thing to do, and `copyPageWithin` (notesModel.js) does exactly that on purpose.
 *   • AN EMPTY OR NEARLY-EMPTY PAGE IS NEVER A FINDING. Every untouched page is identical to
 *     every other untouched page; a detector that says so is a detector nobody reads.
 *   • THE BIN COUNTS. The two real copies were both binned by the time anyone looked, and a
 *     scan that only saw the live tree would have reported a clean account.
 *
 * PURE — no storage, no DOM, no network. The caller supplies the text (the store is the one
 * place that reads bodies), which is what lets the same function run in a unit test, in the
 * workspace banner, and over a database dump of the owner's real account.
 */

/** Two documents are called the same note at or above this. Chosen ABOVE the one real case
 *  it had to catch rather than tuned down to it: the reported pair differs by a single word
 *  in ~40 and scores ~0.97, so 0.90 leaves real headroom without reaching ordinary rhyme. */
export const NEAR_DUPLICATE_SIMILARITY = 0.9;

/** Below this much text a page is not distinctive enough for a match to mean anything. */
export const MIN_TEXT_CHARS = 40;

/** One note's text, reduced to what a human would call "the same words": case and spacing
 *  carry no meaning here, and a round trip through the editor and the server's jsonb can
 *  change both without anyone typing. */
export function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** WORD PAIRS, as a set. A bare word set calls two notes with the same vocabulary identical;
 *  pairs keep the ORDER that makes a document itself, and stay cheap enough to compare every
 *  page against every other. */
export function shingles(normalized) {
  const words = normalized.split(" ").filter(Boolean);
  if (!words.length) return new Set();
  if (words.length === 1) return new Set(words);
  const out = new Set();
  for (let i = 0; i < words.length - 1; i += 1) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Sørensen–Dice over those pairs: 1 is the same words in the same order, 0 shares nothing.
 *  Two empty sets are `0`, never `1` — "both say nothing" is not "both say the same thing",
 *  and answering 1 there is how a detector fills a banner with every blank page. */
export function similarity(a, b) {
  if (!a?.size || !b?.size) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/* Union-find, so three copies of one note come back as ONE finding rather than three pairs
 * the reader has to reassemble in their head. */
function grouper() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  return {
    join(a, b) { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); },
    of: find,
  };
}

/**
 * Find every set of pages that say the same thing while belonging to different projects.
 *
 * `pages` is `[{ pageId, title, projectId, text, where }]` — `where` is free-form provenance
 * ("live" / "bin") echoed back untouched so a caller can say where it found each one.
 *
 * Returns `[{ pages, projectIds, similarity, identical }]`, worst first (identical copies
 * ahead of near-identical ones), and an EMPTY array when there is nothing to say — which is
 * the answer this is most often supposed to give.
 */
export function findCrossProjectDuplicates(pages, {
  threshold = NEAR_DUPLICATE_SIMILARITY,
  minChars = MIN_TEXT_CHARS,
} = {}) {
  const rows = (pages || [])
    .filter((p) => p && p.pageId)
    .map((p) => ({ ...p, projectId: p.projectId == null ? null : String(p.projectId), norm: normalizeText(p.text) }))
    .filter((p) => p.norm.length >= minChars);
  for (const r of rows) r.sh = shingles(r.norm);

  const g = grouper();
  const matched = new Set();   // only pages that really paired with something
  const pairScores = [];       // [aId, bId, similarity] — scored again per group at the end

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a.projectId === b.projectId) continue;            // same project is never a finding
      const s = a.norm === b.norm ? 1 : similarity(a.sh, b.sh);
      if (s < threshold) continue;
      g.join(a.pageId, b.pageId);
      matched.add(a.pageId);
      matched.add(b.pageId);
      pairScores.push([a.pageId, s]);
    }
  }
  if (!matched.size) return [];

  /* Every root is read AFTER all the joins — a union performed late re-parents members that
   * were grouped earlier, so reading a root mid-loop puts one finding in two boxes. */
  const byRoot = new Map();
  for (const r of rows) {
    if (!matched.has(r.pageId)) continue;
    const root = g.of(r.pageId);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(r);
  }
  const lowest = new Map();
  for (const [pageId, s] of pairScores) {
    const root = g.of(pageId);
    lowest.set(root, Math.min(lowest.has(root) ? lowest.get(root) : 1, s));
  }

  const out = [];
  for (const [root, members] of byRoot) {
    const projectIds = [...new Set(members.map((m) => m.projectId))];
    if (members.length < 2 || projectIds.length < 2) continue;
    const identical = new Set(members.map((m) => m.norm)).size === 1;
    out.push({
      pages: members.map(({ norm, sh, ...rest }) => rest),
      projectIds,
      similarity: identical ? 1 : (lowest.get(root) ?? threshold),
      identical,
    });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}

/** ONE short line for the banner — the whole finding, in the fewest words that stay true
 *  (PANEL-BREVITY). Detail belongs behind the "Show me", never in the default view. */
export function duplicateNotice(groups) {
  const n = (groups || []).length;
  if (!n) return null;
  const pages = groups.reduce((t, g) => t + g.pages.length, 0);
  return n === 1
    ? `One note appears in ${groups[0].projectIds.length} different projects (${pages} copies).`
    : `${n} notes appear in more than one project (${pages} copies).`;
}
