/* Sheet NOTES / LEGEND reader (B350) — keep the general notes & legend visible across a stitched
 * set, and capture ALL of them even when they change page to page.
 *
 * PURE + browser-free: takes the reconstructed text LINES of one page (from sheetMeta) and finds
 * each notes/legend BLOCK — a heading ("GENERAL NOTES", "GRADING NOTES", "KEYED NOTES",
 * "LEGEND", "ABBREVIATIONS") followed by its body lines in the same column. Returns
 *   [{ heading, x, y, lines:[...] }]
 *
 * Why this matters for stitching: B338 crops the title-block band so drawings butt cleanly — but
 * the general notes often live in/near that band, so cropping would HIDE them. Reading them here
 * lets the Stitcher pull every sheet's notes into one pinned key (aggregateNotes), and flag the
 * ones that differ by sheet — so a note that only appears on C-6 isn't lost behind the crop.
 *
 * Conservative: a heading must look like a heading (short line ending in NOTES / a bare
 * LEGEND|ABBREVIATIONS), and a body run stops at a blank gap or the next heading — so we don't
 * sweep half the drawing into a "notes" blob. Unit-tested with hand-built line lists.
 */

const clean = (s) => (s || "").toString().replace(/\s+/g, " ").trim();

// A heading: "... NOTES" (optionally trailing ":") on a short line, or a bare LEGEND/ABBREVIATIONS.
// The leading words let "GENERAL CONSTRUCTION NOTES" through while the length cap rejects a
// sentence that merely ends in "...see notes".
const HEADING = /^(?:[A-Z][A-Za-z&/]*\s+){0,3}notes?\s*:?$|^legend\s*:?$|^abbreviations?\s*:?$|^key\s*notes?\s*:?$/i;
const isHeading = (t) => t.length <= 42 && HEADING.test(t);

/* Find every notes/legend block on the page from its reconstructed lines (each
 * { text, x, y, w, h, lineH }). Lines need not be pre-sorted. */
export function parseNotes(lines = [], dims = {}) {
  const ls = (lines || [])
    .map((l) => ({ ...l, text: clean(l.text) }))
    .filter((l) => l.text)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks = [];
  for (let i = 0; i < ls.length; i++) {
    if (!isHeading(ls[i].text)) continue;
    const head = ls[i];
    const lineH = head.lineH || head.h || 10;
    const body = [];
    let lastY = head.y;
    let colX = null; // the column left, set by the first body line
    for (let j = i + 1; j < ls.length; j++) {
      const ln = ls[j];
      if (ln.y < head.y) continue;
      if (isHeading(ln.text)) break;                              // next block starts
      const gap = ln.y - lastY;
      if (body.length && gap > 3.2 * lineH) break;                // a real vertical break ends the block
      if (colX == null) colX = ln.x;
      // Body lines hold the same column (notes are left-aligned under their heading). Allow a wide
      // band right of the column (wrapped/indented sub-points) but reject a far-away column.
      else if (ln.x < colX - 1.5 * lineH || ln.x > colX + 0.5 * Math.max(1, dims.width || 0)) continue;
      body.push(ln.text);
      lastY = ln.y;
      if (body.length >= 60) break;                               // safety cap
    }
    if (body.length) blocks.push({ heading: head.text.replace(/:\s*$/, ""), x: head.x, y: head.y, lines: body });
  }
  return blocks;
}

const normNote = (s) => clean(s).toLowerCase().replace(/^[\d.)\-•·\s]+/, "").trim(); // drop the enumerator
const normHeading = (s) => clean(s).toUpperCase().replace(/[^A-Z ]/g, "").trim();

/* Merge the note blocks of MANY sheets into one pinned-key model, so a stitched set shows every
 * note once and flags the ones that vary by sheet (the headline ask: "get all the notes in case
 * they change by page"). `sheets` = [{ sheet, notes:[{heading,lines}] }]. Returns
 *   [{ heading, lines:[{ text, sheets:[...] }], sheetsWithHeading:[...] }]
 * A note line carries the set of sheets it appeared on; the caller tags any line that didn't
 * appear on every sheet bearing that heading. Order: first-seen. */
export function aggregateNotes(sheets = []) {
  const groups = new Map(); // normHeading → { heading, withHeading:Set, lines:Map(normNote → {text,sheets:Set}) }
  for (const s of sheets) {
    const tag = s.sheet || "";
    for (const blk of s.notes || []) {
      const hk = normHeading(blk.heading) || "NOTES";
      let g = groups.get(hk);
      if (!g) { g = { heading: blk.heading, withHeading: new Set(), lines: new Map(), order: groups.size }; groups.set(hk, g); }
      if (tag) g.withHeading.add(tag);
      for (const raw of blk.lines || []) {
        const nk = normNote(raw);
        if (!nk) continue;
        let entry = g.lines.get(nk);
        if (!entry) { entry = { text: clean(raw), sheets: new Set(), order: g.lines.size }; g.lines.set(nk, entry); }
        if (tag) entry.sheets.add(tag);
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      heading: g.heading,
      sheetsWithHeading: [...g.withHeading],
      lines: [...g.lines.values()].sort((a, b) => a.order - b.order).map((e) => ({ text: e.text, sheets: [...e.sheets] })),
    }));
}
