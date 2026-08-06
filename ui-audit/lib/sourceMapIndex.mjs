/* sourceMapIndex — turn a minified (chunk, line, column) back into the SOURCE FILE it came from.
 *
 * WHY THIS EXISTS (NEW-1 of the speed program's phase 3, 2026-07-31).
 * The boot timeline has to attribute four unexplained seconds to NAMED phases. The only
 * instrument that can see inside a boot is a CPU sample profile, and every frame in it looks
 * like this on a production build:
 *
 *     14.5%  (anonymous)  SitePlannerApp-BxMJopPJ.js:7
 *      3.1%  Qse          SitePlannerApp-BxMJopPJ.js:7
 *
 * One chunk, one line, minified identifiers — which tells you the planner is busy and nothing
 * else. "React mount", "first-render geometry" and "the road dissolve" are all `SitePlannerApp:7`,
 * so a phase table built on those names would be a guess with a number next to it. That is the
 * exact failure this program exists to stop.
 *
 * A build with `--sourcemap` carries the answer already: every generated (line, column) maps back
 * to a real path under `src/` or `node_modules/`. This module is the smallest correct reader for
 * that — a base64-VLQ decoder plus a per-line binary search. Deliberately dependency-free: the
 * decoder is forty lines of a frozen, fully-specified format, and adding a runtime dependency to
 * this repo for it would cost more than it saves (`CLAUDE.md` → dependency notes).
 *
 * PURE, so it is unit-tested (test/bootTimeline.test.js) and cannot drift from what the harness
 * claims it does. File IO lives in the caller.
 */

const B64 = new Map([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

/** Decode one base64-VLQ run into its signed integers. Returns [] for an empty/!valid run. */
export function decodeVlq(segment) {
  const out = [];
  let value = 0, shift = 0;
  for (const ch of segment) {
    const digit = B64.get(ch);
    if (digit == null) return out;                 // an unrecognised character ends the run, never throws
    value += (digit & 31) << shift;
    if (digit & 32) { shift += 5; continue; }      // continuation bit
    const negative = value & 1;
    value >>= 1;
    out.push(negative ? (value === 0 ? -0x80000000 : -value) : value);
    value = 0; shift = 0;
  }
  return out;
}

/* A source map's `mappings` is one ";"-separated group per GENERATED LINE, each a ","-separated
 * list of segments. Every field is a DELTA: generated column resets per line, the other three
 * (source index, source line, source column) carry across lines. Segments of length 1 are
 * "generated code with no origin" and are kept as nulls so a lookup lands on "unknown" rather
 * than on whatever mapping happened to precede them. */
export function decodeMappings(mappings) {
  const lines = [];
  let srcIdx = 0, srcLine = 0, srcCol = 0;
  for (const group of String(mappings || "").split(";")) {
    let genCol = 0;
    const segs = [];
    if (group) {
      for (const seg of group.split(",")) {
        const f = decodeVlq(seg);
        if (!f.length) continue;
        genCol += f[0];
        if (f.length >= 4) {
          srcIdx += f[1]; srcLine += f[2]; srcCol += f[3];
          segs.push({ col: genCol, src: srcIdx, line: srcLine });
        } else {
          segs.push({ col: genCol, src: null, line: null });
        }
      }
    }
    segs.sort((a, b) => a.col - b.col);
    lines.push(segs);
  }
  return lines;
}

/** Normalise a source-map `sources` entry to a repo-relative-ish path a phase rule can match. */
export function normalizeSource(source, sourceRoot = "") {
  let s = String(source || "");
  if (sourceRoot && !s.startsWith("/") && !/^[a-z]+:/i.test(s)) s = `${sourceRoot.replace(/\/?$/, "/")}${s}`;
  s = s.replace(/\\/g, "/").replace(/^\0+/, "");
  // Vite writes sources relative to the chunk ("../../src/…") and vendor code under node_modules.
  const nm = s.lastIndexOf("node_modules/");
  if (nm >= 0) return s.slice(nm);
  const src = s.indexOf("src/");
  if (src >= 0) return s.slice(src);
  return s.replace(/^(\.\.\/)+/, "");
}

/* THE LOOKUP. `line`/`column` are ZERO-BASED, matching CDP's `callFrame` exactly (its
 * `lineNumber`/`columnNumber` are 0-based; only the harness's printed output adds 1).
 *
 * The rule is "the last mapping at or before this column ON THIS LINE" — the standard
 * resolution. A column BEFORE the first segment on the line is deliberately UNKNOWN rather than
 * charged to the previous line's file: on a one-line minified bundle that mistake would silently
 * attribute a whole chunk to whichever module happened to be emitted first. */
export function makeSourceLocator(map) {
  const sources = (map?.sources || []).map((s) => normalizeSource(s, map?.sourceRoot));
  const lines = decodeMappings(map?.mappings);
  return (line, column) => {
    const segs = lines[line];
    if (!segs || !segs.length) return null;
    let lo = 0, hi = segs.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].col <= column) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found < 0) return null;
    const seg = segs[found];
    if (seg.src == null) return null;
    const source = sources[seg.src] ?? null;
    return source == null ? null : { source, line: seg.line + 1 };   // 1-based, for printing
  };
}

/** The common case: just the file. */
export function makeSourceLookup(map) {
  const at = makeSourceLocator(map);
  return (line, column) => at(line, column)?.source ?? null;
}
