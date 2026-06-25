/* PURE revision-compare core (B464): register rev B onto rev A, resample B into A's grid, diff.
 * Imports only the other pure engines (rasterRegister, rasterDiff) — no canvas/DOM/pdf.js — so the
 * whole register→resample→diff pipeline is unit-testable in Node. The browser glue (PDF render +
 * binarize) lives in doc-review/lib/compareRegister.js and calls `compareBinaries` here.
 */
import { registerRasters, manualRegister } from "./rasterRegister.js";
import { diffRasters } from "./rasterDiff.js";

/** Resample a source binary (Wb×Hb) onto a target W×H grid via `mapFn` (target pt → source pt).
 *  Nearest-neighbor; out-of-bounds → background. Pure. */
export function resampleBinary(srcBin, Wb, Hb, W, H, mapFn) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = mapFn({ x, y });
      const sx = Math.round(s.x), sy = Math.round(s.y);
      if (sx >= 0 && sy >= 0 && sx < Wb && sy < Hb && srcBin[sy * Wb + sx]) out[y * W + x] = 1;
    }
  }
  return out;
}

/* Place a Wb×Hb binary into a Wa×Ha grid (top-left), clipping/padding — so the coarse-offset profile
 * correlation has equal-length arrays even when the two renders differ slightly in size. */
function padTo(bin, Wb, Hb, Wa, Ha) {
  if (Wb === Wa && Hb === Ha) return bin;
  const out = new Uint8Array(Wa * Ha);
  const w = Math.min(Wa, Wb), h = Math.min(Ha, Hb);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * Wb + x]) out[y * Wa + x] = 1;
  return out;
}

/** PURE compare of two binaries (rev A old, rev B new), possibly different sizes. Registers B→A
 *  (auto, or with `manualPairs` for the 2-point fallback), resamples B into A's grid, diffs.
 *  Returns { codes, regions, counts, transform, W, H } or { error, transform:null }.
 *  `manualPairs` = { a:[p1A,p2A], b:[p1B,p2B] } forces the manual transform. */
export function compareBinaries(binA, Wa, Ha, binB, Wb, Hb, opts = {}) {
  const { tol = 1, minArea = 24, manualPairs } = opts;
  let t;
  if (manualPairs && manualPairs.a && manualPairs.b) {
    t = manualRegister(manualPairs.a[0], manualPairs.a[1], manualPairs.b[0], manualPairs.b[1]);
  } else {
    t = registerRasters(binA, padTo(binB, Wb, Hb, Wa, Ha), Wa, Ha, opts);
  }
  if (!t || !t.inv) return { error: "no-fit", transform: null };
  const regB = resampleBinary(binB, Wb, Hb, Wa, Ha, t.inv);
  const { codes, regions, counts } = diffRasters(binA, regB, Wa, Ha, { tol, minArea });
  return { codes, regions, counts, transform: t, W: Wa, H: Ha };
}
