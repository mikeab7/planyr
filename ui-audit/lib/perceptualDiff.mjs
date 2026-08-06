/* perceptualDiff — PERCEPTUAL-PARITY: the bar that replaces byte-identity for LOD-class changes.
 *
 * WHY THIS EXISTS (owner amendment, 2026-08-06, verbatim: "imperceptible at working zoom assuming
 * that one makes the most sense"). The previous bar was B1345's: byte-identical, or one unit out of
 * 255 on one channel. That bar is a MEASUREMENT OF THE FILE, not of the picture, and it cost real
 * work twice — B1350's dock-door leaves were rejected at 12-23/255 and 424 DOM nodes were left on
 * the table, the second time (PR #921) for a cause that turned out to be that Chromium does not
 * rasterise a <rect> and a rectangular <path> to the same antialiased edge AT ANY ZOOM. No gate
 * could ever have saved that, because the difference is not a level-of-detail decision at all: it
 * is one sub-pixel of coverage redistributed along an edge that is in both pictures.
 *
 * ⛔ THE THING TO UNDERSTAND, AND THE REASON A RAW PIXEL DIFF CANNOT ARBITRATE THIS. A raw diff
 * cannot tell those two events apart:
 *      (i)  the same ink, moved a fraction of a pixel along an edge   — invisible
 *      (ii) a line of ink REMOVED from the drawing                    — a downgrade
 * Both can read 23/255. One is an antialiasing artefact of how a shape was expressed; the other is
 * a stall stripe the owner can no longer see. Byte-identity refuses both, which is safe and is why
 * it was chosen — but it also refuses every representation change, forever, which is the cost.
 *
 * THE CONSTRUCTION, in one sentence: measure the two pictures at TWO SCALES — one near the eye's
 * resolution limit, which bounds HOW MUCH of the drawing a change is allowed to touch at all, and
 * one inside the eye's high-sensitivity band, which bounds WHAT THE EYE ACTUALLY RECEIVES after it
 * integrates. Case (i) passes the second test because the ink is still there; case (ii) fails it
 * because a neighbourhood genuinely lost ink. That is the discriminator, and it is the whole idea.
 *
 * THE COLOUR METRIC IS CIEDE2000 (ΔE00), the CIE's own perceptual colour-difference formula, not a
 * channel delta. 8-bit channel distance is not perceptually uniform — 10/255 in a dark blue and
 * 10/255 in a light yellow are nothing like each other to a viewer — which is the second reason
 * "23/255" was never an answer to "can he see it".
 *
 * THE VIEWING GEOMETRY, STATED SO IT CAN BE ARGUED WITH RATHER THAN ASSUMED. The owner reports a 2K
 * display and his browser reports devicePixelRatio ~2.15, i.e. OS scaling is in play, so CSS pixels
 * are not device pixels and the physical size of a CSS pixel is the number that matters. Defaults
 * below: 20/20 acuity (1 arcminute), 600 mm viewing distance, and 0.50 mm per CSS pixel (a 27-inch
 * 2560-wide panel driven at dpr 2.15). On that geometry ONE CSS PIXEL SUBTENDS ~2.9 ARCMINUTES.
 * Every one of those three numbers is a parameter, and the two this repo cannot measure from a
 * sandbox — his panel's physical width and how far he sits from it — are on OWNER-TODO. Changing
 * them changes the bar, so they are reported in every run's output rather than buried here.
 *
 * ⛔ THE BLUR RUNS IN LINEAR LIGHT, not in sRGB. Averaging gamma-encoded values is not averaging
 * light, and this whole file rests on the claim that "the same ink one sub-pixel over" averages
 * back to the same thing — which is only true in linear light.
 */

/* ---------------------------------------------------------------------------------------------
 * Viewing geometry
 * ------------------------------------------------------------------------------------------- */

/* 20/20 acuity: the classical minimum angle of resolution, one minute of arc. */
export const ACUITY_ARCMIN = 1;
/* Defaults for the owner's reported setup. Both are honestly unverified from here — see the header
 * and OWNER-TODO. They are deliberately on the STRICT side: a nearer viewer and a smaller CSS pixel
 * both make differences MORE visible, so a change that clears this bar clears it with headroom. */
export const DEFAULT_VIEW_DISTANCE_MM = 600;
export const DEFAULT_CSS_PX_MM = 0.50;

/* How many arcminutes one CSS pixel subtends at the given geometry. */
export function arcminPerCssPx({ viewDistanceMm = DEFAULT_VIEW_DISTANCE_MM, cssPxMm = DEFAULT_CSS_PX_MM } = {}) {
  if (!(viewDistanceMm > 0) || !(cssPxMm > 0)) throw new Error("viewing geometry must be positive");
  return Math.atan(cssPxMm / viewDistanceMm) * (180 / Math.PI) * 60;
}

/* THE TWO SCALES, both expressed in arcminutes so they are statements about the EYE and survive a
 * change of monitor:
 *
 *   DETAIL  — one acuity cell. Its job is not to model perception; it is to stop a change quietly
 *             touching a large share of the drawing. Sub-pixel on the default geometry, so it is
 *             very nearly a raw diff, deliberately.
 *   PERCEIVED — six arcminutes, i.e. ~5 cycles/degree, which is where the human contrast
 *             sensitivity function peaks. A difference that survives being viewed at the scale the
 *             eye is BEST at is a difference the eye can see; one that averages away there cannot
 *             be seen at any coarser scale either, and the DETAIL term already covers the finer
 *             ones. That pair is what makes this a two-sided test rather than a fudge factor.
 */
export const DETAIL_ARCMIN = ACUITY_ARCMIN;
export const PERCEIVED_ARCMIN = 6;

/* ---------------------------------------------------------------------------------------------
 * THE PASS BAR. Raising any of these five numbers is a product decision about drawing quality and
 * must be argued on the backlog item, never nudged to make a run pass. They are exported so a unit
 * test can pin them and a reviewer sees a diff when one moves.
 * ------------------------------------------------------------------------------------------- */

/* ⛔ THREE NUMBERS GATE, AND THEY ARE ALL MAGNITUDES. An earlier draft of this bar also capped the
 * SHARE OF THE FRAME allowed to differ, and that term was removed before it shipped because it
 * measures the wrong property: for an antialiasing-class change, the number of pixels touched
 * scales with the TOTAL EDGE LENGTH IN THE DRAWING, i.e. with how much is drawn, not with how much
 * changed. A dense plan would fail a coverage cap for being dense. Coverage is still reported on
 * every run — a reviewer wants to know what got touched — it just does not decide the verdict. */

/* DETAIL: no near-acuity sample may differ by a large colour step, anywhere, even at one pixel.
 * This is what the PERCEIVED terms below cannot see: a fine high-contrast TEXTURE replaced by its
 * own local average (stall stripes swapped for a flat tint) integrates to almost nothing and would
 * sail through an integrated-only bar, while being obviously wrong. ΔE00 6 is a plainly visible
 * step between two flat fields; permitting it at a single near-acuity sample is safe only because
 * the integrated terms still have to clear it. */
export const DETAIL_MAX_DE = 6.0;
/* PERCEIVED: the JND. ΔE00 1.0 is the classical just-noticeable difference for two large adjacent
 * uniform fields under controlled viewing — the most favourable case for an observer there is. In a
 * drawing, at working zoom, on a scaled display, it is a conservative floor: differences at this
 * level are not seen, they are computed. (The figure often quoted for ordinary viewing is ~2.3; we
 * deliberately take the strict end.) THIS IS THE TEST — the one that separates ink that moved a
 * sub-pixel from ink that was removed. */
export const PERCEIVED_MAX_DE = 1.0;
/* PERCEIVED: and the whole-frame mean, which is what stops a thousand individually-invisible
 * differences adding up to a drawing that reads differently. */
export const PERCEIVED_MEAN_DE = 0.10;

/* ---------------------------------------------------------------------------------------------
 * Colour: sRGB → linear → CIE XYZ (D65) → CIE Lab, then CIEDE2000
 * ------------------------------------------------------------------------------------------- */

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/* D65 white point, 2-degree observer. */
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);

/* Linear-light RGB (0..1) → CIE Lab. */
export function linearRgbToLab(r, g, b) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / YN;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / ZN;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/* Convenience for tests and callers holding 8-bit sRGB. */
export function srgbToLab(r, g, b) {
  return linearRgbToLab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

/* CIEDE2000 (Sharma/Wu/Dalal formulation). kL = kC = kH = 1 (reference conditions). */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const avgL = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const c7 = Math.pow(avgC, 7);
  const G = 0.5 * (1 - Math.sqrt(c7 / (c7 + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;

  const hp = (ap, bp) => {
    if (ap === 0 && bp === 0) return 0;
    const h = deg(Math.atan2(bp, ap));
    return h >= 0 ? h : h + 360;
  };
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);

  let avgHp;
  const hDiffAbs = Math.abs(h1p - h2p);
  if (C1p * C2p === 0) avgHp = h1p + h2p;
  else if (hDiffAbs <= 180) avgHp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) avgHp = (h1p + h2p + 360) / 2;
  else avgHp = (h1p + h2p - 360) / 2;

  const T = 1
    - 0.17 * Math.cos(rad(avgHp - 30))
    + 0.24 * Math.cos(rad(2 * avgHp))
    + 0.32 * Math.cos(rad(3 * avgHp + 6))
    - 0.20 * Math.cos(rad(4 * avgHp - 63));

  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (hDiffAbs <= 180) dhp = h2p - h1p;
  else if (h2p <= h1p) dhp = h2p - h1p + 360;
  else dhp = h2p - h1p - 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const sq = (avgL - 50) * (avgL - 50);
  const SL = 1 + (0.015 * sq) / Math.sqrt(20 + sq);
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const acp7 = Math.pow(avgCp, 7);
  const RC = 2 * Math.sqrt(acp7 / (acp7 + Math.pow(25, 7)));
  const RT = -RC * Math.sin(rad(2 * dTheta));

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
    Math.pow(dCp / SC, 2) +
    Math.pow(dHp / SH, 2) +
    RT * (dCp / SC) * (dHp / SH),
  );
}

/* ---------------------------------------------------------------------------------------------
 * Separable Gaussian blur in LINEAR light
 * ------------------------------------------------------------------------------------------- */

/* Kernel radius at 3 sigma — beyond that the weights are under 1.2% of the peak and rounding
 * them away costs less than the arithmetic. A sigma below a twentieth of a pixel is treated as
 * no blur at all rather than as a degenerate one-tap kernel. */
export function gaussianKernel(sigma) {
  if (!(sigma > 0.05)) return [1];
  const r = Math.max(1, Math.ceil(sigma * 3));
  const out = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    out.push(w);
    sum += w;
  }
  return out.map((w) => w / sum);
}

/* `img` is { width, height, channels, data } as decodePng returns. Result is a Float64Array of
 * width*height*3 in LINEAR light (0..1), blurred by `sigma` CSS px. Edges clamp, so a difference at
 * the frame border is not softened by imaginary black outside it. */
export function blurLinear(img, sigma) {
  const { width: w, height: h, channels: ch, data } = img;
  const lin = new Float64Array(w * h * 3);
  for (let i = 0, p = 0; i < w * h; i++, p += ch) {
    lin[i * 3] = srgbToLinear(data[p]);
    lin[i * 3 + 1] = srgbToLinear(data[p + 1]);
    lin[i * 3 + 2] = srgbToLinear(data[p + 2]);
  }
  const k = gaussianKernel(sigma);
  if (k.length === 1) return lin;
  const r = (k.length - 1) / 2;
  const tmp = new Float64Array(w * h * 3);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const sx = Math.min(w - 1, Math.max(0, x + i));
        const s = (y * w + sx) * 3, wt = k[i + r];
        a += lin[s] * wt; b += lin[s + 1] * wt; c += lin[s + 2] * wt;
      }
      const d = (y * w + x) * 3;
      tmp[d] = a; tmp[d + 1] = b; tmp[d + 2] = c;
    }
  }
  // vertical
  const out = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const sy = Math.min(h - 1, Math.max(0, y + i));
        const s = (sy * w + x) * 3, wt = k[i + r];
        a += tmp[s] * wt; b += tmp[s + 1] * wt; c += tmp[s + 2] * wt;
      }
      const d = (y * w + x) * 3;
      out[d] = a; out[d + 1] = b; out[d + 2] = c;
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * The test
 * ------------------------------------------------------------------------------------------- */

/* ΔE00 statistics between two linear-light buffers of the same size. */
function deStats(la, lb, n) {
  let max = 0, sum = 0, differing = 0, overHalf = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    if (la[p] === lb[p] && la[p + 1] === lb[p + 1] && la[p + 2] === lb[p + 2]) continue;
    const de = deltaE2000(
      linearRgbToLab(la[p], la[p + 1], la[p + 2]),
      linearRgbToLab(lb[p], lb[p + 1], lb[p + 2]),
    );
    if (de <= 0) continue;
    differing++;
    sum += de;
    if (de > max) max = de;
    if (de > PERCEIVED_MAX_DE / 2) overHalf++;
  }
  return {
    differing,
    pct: +((differing / n) * 100).toFixed(4),
    maxDE: +max.toFixed(3),
    meanDE: +(sum / n).toFixed(4),          // over the WHOLE frame, not over differing pixels
    overHalfPct: +((overHalf / n) * 100).toFixed(4),
  };
}

/* PERCEPTUAL-PARITY. `a` and `b` are decoded PNGs of the SAME size (decodePng from ./pngDiff.mjs).
 * Returns every number the bar is made of plus a boolean, and NEVER a bare boolean — a run that
 * only prints pass/fail is exactly as unarguable as the bar it replaced. */
export function perceptualParity(a, b, opts = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const geometry = {
    viewDistanceMm: opts.viewDistanceMm ?? DEFAULT_VIEW_DISTANCE_MM,
    cssPxMm: opts.cssPxMm ?? DEFAULT_CSS_PX_MM,
  };
  const perCssPx = arcminPerCssPx(geometry);
  /* An arcminute scale converted to CSS pixels. Gaussian sigma is taken as HALF the scale, so the
   * kernel's full width at half maximum is about one scale unit — the usual convention for "a
   * filter at this scale", and the one that keeps DETAIL genuinely near-acuity rather than blurring
   * across it. */
  const sigmaFor = (arcmin) => arcmin / perCssPx / 2;
  const sigmaDetail = sigmaFor(DETAIL_ARCMIN);
  const sigmaPerceived = sigmaFor(PERCEIVED_ARCMIN);

  const n = a.width * a.height;
  const detail = deStats(blurLinear(a, sigmaDetail), blurLinear(b, sigmaDetail), n);
  const perceived = deStats(blurLinear(a, sigmaPerceived), blurLinear(b, sigmaPerceived), n);

  const failures = [];
  if (detail.maxDE > DETAIL_MAX_DE) failures.push(`detail: worst ΔE00 ${detail.maxDE} (bar ${DETAIL_MAX_DE})`);
  if (perceived.maxDE > PERCEIVED_MAX_DE) failures.push(`perceived: worst ΔE00 ${perceived.maxDE} (bar ${PERCEIVED_MAX_DE})`);
  if (perceived.meanDE > PERCEIVED_MEAN_DE) failures.push(`perceived: frame-mean ΔE00 ${perceived.meanDE} (bar ${PERCEIVED_MEAN_DE})`);

  return {
    pass: failures.length === 0,
    failures,
    identical: detail.differing === 0 && perceived.differing === 0,
    geometry: { ...geometry, arcminPerCssPx: +perCssPx.toFixed(3), sigmaDetail: +sigmaDetail.toFixed(3), sigmaPerceived: +sigmaPerceived.toFixed(3) },
    detail,
    perceived,
    bars: { DETAIL_MAX_DE, PERCEIVED_MAX_DE, PERCEIVED_MEAN_DE },
  };
}

/* One line a human reads in a harness log. Coverage is shown but is NOT part of the verdict. */
export function parityLine(r) {
  return `detail ΔE00 max ${r.detail.maxDE}  ·  perceived ΔE00 max ${r.perceived.maxDE} mean ${r.perceived.meanDE}  ·  touched ${r.detail.pct}% of the frame  →  ${r.pass ? "PASS" : "FAIL"}`;
}
