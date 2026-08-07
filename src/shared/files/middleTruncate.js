/* Middle-ellipsis label splitting (NEW-4).
 *
 * A drawing set's file names are identical for their whole readable length and differ only at
 * the END — "2024-10-08 - JACINTOPORT - MEP - ISSUE FOR CONSTRUCTION - p1" … "- p32". Plain CSS
 * `text-overflow: ellipsis` cuts the TAIL, so all 32 rows render the identical string
 * "2024-10-08 - JACI…" and the list is unusable: the only distinguishing part is exactly what is
 * thrown away.
 *
 * This splits a label into { head, tail } so the renderer can let the HEAD ellipsize while the
 * TAIL is pinned and always drawn. Pure + unit-tested here; the CSS that pins it lives in
 * `shared/ui/MiddleTruncate.jsx`. `head + tail === text` always, so nothing is invented and
 * nothing is silently dropped.
 *
 * The tail is chosen at a real token boundary when one is close enough to the end — so it reads
 * " - p17", not "7". Separators are tried MOST-MEANINGFUL FIRST (a dash-delimited token beats a
 * bare word break), and the first one whose suffix fits the budget wins. With no usable boundary
 * we still keep the last `maxTail` characters: a blunt cut preserves identity, losing the tail
 * does not.
 */

/* Ordered by how well the boundary reads once pinned: an explicit delimiter, then a word break. */
const SEPARATORS = [" · ", " — ", " – ", " - ", " -", "- ", "_", "/", "\\", " "];
/* A pinned tail has to SAY something. "SHEET LIST - " must not split to a tail of " - ": that
 * pins punctuation and throws away the only words on the row. */
const SUBSTANTIVE = /[^\s·—–_/\\-]/;

/**
 * @param {string} text                 the full label
 * @param {object} [opts]
 * @param {number} [opts.maxTail=14]    longest suffix worth pinning (chars)
 * @param {number} [opts.minHead=4]     below this the head has nothing left to say — don't split
 * @returns {{head: string, tail: string}} `head + tail === String(text ?? "")`
 */
export function splitLabel(text, { maxTail = 14, minHead = 4 } = {}) {
  const s = text == null ? "" : String(text);
  if (!s) return { head: "", tail: "" };

  // The EARLIEST boundary that still fits the budget, so the pinned tail keeps as much of the
  // distinguishing end as it can afford: " ROOF PLAN", not a bare " PLAN" that tells two sheets
  // apart no better than the head did. Separators are priority-ordered, so an explicit delimiter
  // still beats a bare word break when both fit.
  const floor = Math.max(1, s.length - maxTail);
  let cut = -1;
  for (const sep of SEPARATORS) {
    const i = s.indexOf(sep, floor);
    if (i <= 0) continue;                        // absent in range, or it STARTS the label (no head left)
    if (!SUBSTANTIVE.test(s.slice(i))) continue; // a trailing delimiter: pinning it says nothing
    cut = i;
    break;
  }

  if (cut < 0) {
    // No usable boundary. Short enough that the head alone survives? Leave it whole.
    if (s.length <= maxTail + minHead) return { head: s, tail: "" };
    cut = s.length - maxTail;                // blunt cut — identity beats prettiness
  }
  if (cut < minHead) return { head: s, tail: "" };
  return { head: s.slice(0, cut), tail: s.slice(cut) };
}

/** Convenience for a non-DOM consumer (a `title=`, a test): the label with a literal ellipsis. */
export function middleEllipsis(text, width = 24, opts) {
  const s = text == null ? "" : String(text);
  if (s.length <= width) return s;
  const { head, tail } = splitLabel(s, opts);
  if (!tail) return s.slice(0, Math.max(1, width - 1)) + "…";
  const room = Math.max(1, width - tail.length - 1);
  return head.length <= room ? head + tail : head.slice(0, room) + "…" + tail;
}
