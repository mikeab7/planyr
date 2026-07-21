// Callout / text-box box geometry (B913) — the ONE source of truth for the committed SVG render AND
// the inline text editor, which must never drift (B616/B680). Pure: no React / DOM, so it unit-tests
// without a browser and both surfaces read the same numbers.
//
// Two modes:
//   • AUTO width (default, pre-B913) — the box hugs its widest hard line; text never wraps.
//   • EXPLICIT width (`c.boxW`, in feet — the user dragged a width handle) — the text WRAPS to that
//     width and the box height auto-grows to fit the wrapped lines. Clearing `boxW` (the "Fit to
//     text" action / Alt+Z) returns to AUTO.
// Widths are stored in FEET (the drawing frame) so the box is zoom-invariant, exactly like the
// auto-sized box: every pixel term below scales with `ppf`, so `w/ppf` is constant across zoom.
//
// B931 — the box now measures REAL glyph widths, not a flat monospace `length * charW` guess. That
// guess under-sized any line whose characters run wider than the average (all-caps, M/W-heavy text
// like "COULD ADD VOLUME TO ADJACENT MASON BASIN"), so the committed <text> drew straight past the
// rect — the exact overflow B913 was thought to have cured. We reuse the shared, purpose-built
// text-wrap/measure module (`bestMeasurer` = a real <canvas> in the browser matching the app's Inter
// face, the per-char heuristic in Node) so both the AUTO width and the wrapped line breaks track the
// glyphs that actually render. `bestMeasurer` guards `typeof document`, so this file stays Node-pure.

import { bestMeasurer, wrapText } from "../../../shared/markup/textWrap.js";

// Greedy CHAR-COUNT word-wrap `text` to at most `maxChars` per line, preserving hard "\n" breaks.
// A single word longer than `maxChars` is hard-broken into `maxChars`-sized chunks so it can never
// spill past the box. Returns at least one line (possibly ""). Pure. (Standalone helper retained for
// its tests; `calloutLayout` itself now wraps by real measured WIDTH via `wrapText`, B931.)
export function wrapLines(text, maxChars) {
  const paras = String(text == null ? "" : text).split("\n");
  if (!(maxChars >= 1)) return paras.length ? paras : [""]; // can't wrap → keep the hard lines
  const out = [];
  for (const para of paras) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    for (const rawWord of para.split(" ")) {
      let word = rawWord;
      // Hard-break an over-long word (URLs, long part numbers) so nothing overflows the box.
      while (word.length > maxChars) {
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (word === "" && rawWord !== "") continue; // exact-multiple break consumed the whole word
      const cand = line ? `${line} ${word}` : word;
      if (cand.length <= maxChars) line = cand;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

// Full box geometry for a callout `c` under resolved style `st` at zoom `ppf`. Returns the on-screen
// pixel metrics plus the display `lines` (wrapped when `boxW` is set). Mirrors the exact per-line
// metrics the SVG render uses (zk / fontPx / charW / lineH / padX / padY), so the committed box, its
// selection handles, and the inline editor all agree.
export function calloutLayout(c, st, ppf) {
  const zk = ppf / 0.35;                                  // scale relative to the default working zoom
  const fontPx = st.size * zk;
  const charW = fontPx * 0.56 * (st.bold ? 1.05 : 1);     // coarse per-char floor, only for minCalloutWidthFt
  const lineH = fontPx * st.lineHeight;
  const padX = st.padX * zk, padY = st.padY * zk;
  // Real glyph measurement (B931) — matches the Inter face the <text> renders in, so the box can't
  // be narrower than what actually draws. Bold/italic widen the glyphs, so feed them to the measurer.
  const measure = bestMeasurer({ bold: !!st.bold, italic: !!st.italic });
  const hasExplicitW = c && c.boxW != null && c.boxW > 0;
  let lines, w;
  if (hasExplicitW) {
    w = c.boxW * ppf;                                     // explicit width (feet → px) — stays exact
    const innerPx = Math.max(fontPx, w - padX * 2);       // usable text width inside the padding
    lines = wrapText(c && c.text, fontPx, innerPx, measure); // width-based wrap (mirrors the editor's soft-wrap)
  } else {
    lines = String(c && c.text != null ? c.text : "").split("\n");
    const tw = Math.max(fontPx, ...lines.map((l) => measure(l, fontPx))); // auto width — hugs the widest REAL line
    w = tw + padX * 2;
  }
  const h = lines.length * lineH + padY * 2;
  return { zk, fontPx, charW, lineH, padX, padY, w, h, lines, wrapped: hasExplicitW };
}

// The minimum sensible explicit width (feet) for a callout at the current zoom: room for a few
// characters plus the horizontal padding, so a width-handle drag can't collapse the box to nothing.
// Uses the SAME pixel metrics as calloutLayout, divided back to feet (zoom-invariant). Pure.
export function minCalloutWidthFt(st, ppf, minChars = 3) {
  const zk = ppf / 0.35;
  const fontPx = st.size * zk;
  const charW = fontPx * 0.56 * (st.bold ? 1.05 : 1);
  const padX = st.padX * zk;
  return (minChars * charW + padX * 2) / ppf;
}
