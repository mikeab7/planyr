/* notesConflictDiff — a readable, word-level diff between two note bodies (B842624).
 *
 * PURE. Built for the conflict-resolution side-by-side comparison (ConflictSideBySide.jsx): the owner
 * could not decide "Keep this one" vs "Use the other" because the bar showed neither version's
 * content — this is the piece that lets both be shown in full, with only the words that
 * genuinely differ marked, the way Google Docs' version history marks a changed passage rather
 * than printing a raw +/- diff.
 *
 * ⛔ A CAPPED LCS, NEVER AN UNBOUNDED O(n·m) TABLE. Word-for-word is exact and cheap for
 * anything a person actually writes in a note; a genuinely enormous document falls back to
 * line-level (far fewer tokens), and an enormous SINGLE-LINE document — the case neither cap
 * protects — falls back to a linear prefix/suffix anchor diff that cannot blow up at all. Three
 * tiers, `granularity` names which one ran so a caller (or a test) can tell.
 */

const WORD_TOKEN_CAP = 1200;
const LINE_TOKEN_CAP = 1200;

/** Split into words and the whitespace between them, whitespace kept as its own token so
 *  concatenating every token back together (regardless of diff type) reconstructs the input
 *  exactly — there is no separate "joiner" to get wrong. */
function tokenizeWords(text) {
  return String(text || "").split(/(\s+)/).filter((t) => t !== "");
}

/** Split into lines, each carrying its own trailing "\n" (but the last), for the same
 *  self-delimiting-token reason as `tokenizeWords`. */
function tokenizeLines(text) {
  const parts = String(text || "").split("\n");
  return parts.map((line, i) => (i < parts.length - 1 ? `${line}\n` : line));
}

/** Longest-common-subsequence ALIGNMENT over two arbitrary token arrays, compared by `===`.
 *  Returns the raw, UNMERGED alignment in order — `{ type: "same" | "a" | "b", ai?, bj? }`,
 *  carrying INDEXES rather than the token values themselves, so a caller can map back to
 *  whatever richer object each side's array actually held (a word, a line, or — see
 *  `notesRedline.js` — a whole formatted block). "a"-only means the token exists only in `a`
 *  (lost if `b` is chosen), "b"-only only in `b`. This is the shared primitive under BOTH
 *  `lcsDiff` below (which merges consecutive same-type STRING tokens by concatenation) and the
 *  redline's block/word matching (which cannot concatenate — a block is an object, not a
 *  string — and needs the index to recover it). One DP, two consumers, never two copies. */
export function lcsAlign(a, b) {
  const n = a.length, m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const dpi = dp[i], dpi1 = dp[i + 1];
    for (let j = m - 1; j >= 0; j -= 1) {
      dpi[j] = a[i] === b[j] ? dpi1[j + 1] + 1 : Math.max(dpi1[j], dpi[j + 1]);
    }
  }
  const raw = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { raw.push({ type: "same", ai: i, bj: j }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ type: "a", ai: i }); i += 1; }
    else { raw.push({ type: "b", bj: j }); j += 1; }
  }
  while (i < n) { raw.push({ type: "a", ai: i }); i += 1; }
  while (j < m) { raw.push({ type: "b", bj: j }); j += 1; }
  return raw;
}

/** Longest-common-subsequence diff over two token arrays, generic over the token shape (words
 *  or lines) since both tokenizers hand back self-delimiting strings. Returns ops merged into
 *  runs: `{ type: "same" | "a" | "b", text }` — "a" is a run found only in `a` (i.e. lost if
 *  `b` is chosen), "b" only in `b`. Concatenating every op's `text` in order reconstructs `a`
 *  if you keep "same"+"a" ops, or `b` if you keep "same"+"b" — see `sideText`. */
function lcsDiff(a, b) {
  const raw = lcsAlign(a, b);
  const ops = [];
  for (const r of raw) {
    const token = r.type === "b" ? b[r.bj] : a[r.ai];
    const last = ops[ops.length - 1];
    if (last && last.type === r.type) last.text += token;
    else ops.push({ type: r.type, text: token });
  }
  return ops;
}

/** The linear fallback for text too large for either capped LCS: the longest common prefix and
 *  suffix are "same", and whatever sits between them is wholly "a" / "b" — coarser (an edit
 *  anywhere in the middle marks the whole middle as differing) but O(n) and safe at any size. */
function anchorDiff(a, b) {
  const minLen = Math.min(a.length, b.length);
  let start = 0;
  while (start < minLen && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < minLen - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;

  const ops = [];
  if (start) ops.push({ type: "same", text: a.slice(0, start) });
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  if (midA) ops.push({ type: "a", text: midA });
  if (midB) ops.push({ type: "b", text: midB });
  if (end) ops.push({ type: "same", text: a.slice(a.length - end) });
  return ops;
}

/** The public entry. `textA`/`textB` are plain text (block boundaries already flattened to
 *  newlines — see `notesMarkdown.js`'s `docToText`). Returns `{ granularity, ops }`; `ops` is
 *  never empty for non-empty input. */
export function diffNoteText(textA, textB) {
  const a = String(textA || "");
  const b = String(textB || "");
  if (a === b) return { granularity: "none", ops: a ? [{ type: "same", text: a }] : [] };

  const wordsA = tokenizeWords(a);
  const wordsB = tokenizeWords(b);
  if (wordsA.length <= WORD_TOKEN_CAP && wordsB.length <= WORD_TOKEN_CAP) {
    return { granularity: "word", ops: lcsDiff(wordsA, wordsB) };
  }

  const linesA = tokenizeLines(a);
  const linesB = tokenizeLines(b);
  if (linesA.length <= LINE_TOKEN_CAP && linesB.length <= LINE_TOKEN_CAP) {
    return { granularity: "line", ops: lcsDiff(linesA, linesB) };
  }

  return { granularity: "anchor", ops: anchorDiff(a, b) };
}

/** Whether a diff found anything a person would call a real difference. */
export function diffHasChanges(ops) {
  return (ops || []).some((op) => op.type !== "same");
}

/** The ops for ONE side, in order: `"a"` keeps `same` + `a` runs (reconstructs `textA`),
 *  `"b"` keeps `same` + `b` runs (reconstructs `textB`). Each kept op also carries `changed`
 *  (true for the side-only runs) so a renderer can highlight without re-deriving it. */
export function sideOps(ops, side) {
  const keep = side === "a" ? "a" : "b";
  return (ops || [])
    .filter((op) => op.type === "same" || op.type === keep)
    .map((op) => ({ text: op.text, changed: op.type !== "same" }));
}
