/* B862 (chat NEW-3) — the shared required-vs-provided bar (a bullet chart) for the Yield →
 * Stormwater readout. ONE pure geometry + one primitive builder, consumed by BOTH renderers
 * so the screen and the PDF export can never drift (PDF-PARITY):
 *   - the on-screen React <BulletBar> (SitePlanner.jsx) maps the primitives to inline SVG
 *     with theme-token fills, and
 *   - the print sheet (printSheet.js) maps the SAME primitives to an SVG string with the
 *     forced-white-paper hex palette.
 *
 * Two shapes:
 *   • BULLET  — a "provided" bar drawn against a "required" tick (a point rule) or a shaded
 *               SPAN (a screening band). The surplus/shortfall shows as overhang/gap and the
 *               delta is labelled at the bar's end. Used for detention (required = band → span)
 *               and mitigation (required = point → tick).
 *   • STACKED — solid segments summing to a total, with an optional labelled marker line, for
 *               the per-pond three-band split (dead / mitigation-candidate / usable, flood-WSE
 *               line labelled).
 *
 * UNKNOWN renders a HATCHED full-width bar (never a zero-length bar — a zero bar reads as
 * "covered"). Zero-required renders the provided bar with an explicit microcopy instead of two
 * orphaned numbers. Pure — no DOM, no theme, no React; colours are resolved by each renderer. */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const _f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CF_PER_ACFT = 43560;

/* Bullet layout: where the provided bar ends, where the required tick / span sits, and the
 * signed delta — all as fractions of a shared scale (max of provided & required + headroom),
 * so the two renderers only need pixel width. `status` is the domain verdict the CALLER passes
 * (covered/short/over/needs-input/unknown); it only colours the fill, never the geometry. */
export function bulletBarLayout({ provided = 0, required = null, bandLo = null, bandHi = null, unknown = false, headroom = 1.15, reference = null } = {}) {
  if (unknown) return { mode: "bullet", unknown: true, provFrac: 1, reqFrac: null, spanFrac: null, scaleMax: null, noneRequired: false, delta: null, refFrac: null };
  const p = fin(provided) ? Math.max(0, provided) : 0;
  const hasBand = fin(bandLo) && fin(bandHi);
  const lo = hasBand ? Math.min(bandLo, bandHi) : null;
  const hi = hasBand ? Math.max(bandLo, bandHi) : null;
  const rPoint = !hasBand && fin(required) ? Math.max(0, required) : null;
  const refHi = hasBand ? hi : (rPoint ?? 0);
  const noneRequired = !hasBand && (rPoint == null || rPoint === 0);
  // NEW-1 — a de-emphasized GROSS reference tick (the total excavated volume before the
  // usable/dead split). It only shows when it exceeds the plotted provided (usable) value,
  // and it participates in the scale so a "usable 0, gross large" pond still renders the
  // tick to the right of a zero-length provided bar (never a full-length provided bar).
  const ref = fin(reference) && reference > p + 1e-9 ? Math.max(0, reference) : null;
  const scaleMax = Math.max(p, refHi, ref ?? 0, 1e-9) * headroom;
  // Delta: vs the point requirement, or vs the band's conservative (high) end. Nothing to
  // offset (zero/null required) → no delta (a "+3.00" against a 0 requirement is noise).
  const delta = noneRequired ? null : hasBand ? p - hi : rPoint != null ? p - rPoint : null;
  return {
    mode: "bullet",
    unknown: false,
    provided: p,
    required: rPoint,
    bandLo: lo,
    bandHi: hi,
    provFrac: clamp01(p / scaleMax),
    reqFrac: rPoint != null ? clamp01(rPoint / scaleMax) : null,
    spanFrac: hasBand ? [clamp01(lo / scaleMax), clamp01(hi / scaleMax)] : null,
    scaleMax,
    noneRequired,
    delta,
    refFrac: ref != null ? clamp01(ref / scaleMax) : null,
    reference: ref,
  };
}

/* Stacked layout: fractions of the total for each segment, plus the marker's fraction. */
export function stackedBarLayout({ segments = [], markerValue = null, total = null } = {}) {
  const segs = segments.map((s) => ({ key: s.key, value: fin(s.value) ? Math.max(0, s.value) : 0, tone: s.tone || null, label: s.label || s.key }));
  const sum = total != null && fin(total) ? total : segs.reduce((a, s) => a + s.value, 0);
  const scale = Math.max(sum, 1e-9);
  let acc = 0;
  const placed = segs.map((s) => {
    const x0 = acc / scale;
    acc += s.value;
    return { ...s, x0: clamp01(x0), x1: clamp01(acc / scale), frac: clamp01(s.value / scale) };
  });
  return {
    mode: "stacked",
    segments: placed,
    total: sum,
    markerFrac: markerValue != null && fin(markerValue) && sum > 0 ? clamp01(markerValue / scale) : null,
    markerValue: markerValue != null && fin(markerValue) ? markerValue : null,
  };
}

/* Primitive marks in PIXEL coordinates for a given width/height — the ONE render list both
 * the DOM and the print-string renderer walk. Each mark carries a `role` (never a colour);
 * the renderer resolves role → fill/stroke from its own palette. `barH` is the bar band's
 * height; the total svg height should leave room for a label row below when `showDelta`. */
export function bulletBarMarks(layout, { w = 200, barH = 12, unit = "ac-ft", showDelta = true } = {}) {
  const marks = [];
  const y = 0;
  // Track (the full-width baseline the provided bar sits on).
  marks.push({ t: "rect", role: "track", x: 0, y, w, h: barH, rx: 3 });
  if (layout.unknown) {
    marks.push({ t: "rect", role: "hatch", x: 0, y, w, h: barH, rx: 3 });
    // B867 reopen — the bar carries only "unknown"; the SECTION rows name the specific missing
    // input + link to its field (a generic "enter the missing input" on the bar is non-compliant).
    if (showDelta) marks.push({ t: "text", role: "muted", x: w, y: barH + 10, s: "unknown", anchor: "end" });
    return { marks, w, h: barH + (showDelta ? 13 : 0) };
  }
  const px = (f) => Math.round(f * w);
  // Provided fill.
  const pw = Math.max(layout.provFrac > 0 ? 2 : 0, px(layout.provFrac));
  if (pw > 0) marks.push({ t: "rect", role: "provided", x: 0, y, w: pw, h: barH, rx: 3 });
  // Required: a shaded span (band) or a tick (point).
  if (layout.spanFrac) {
    const [a, b] = layout.spanFrac;
    marks.push({ t: "rect", role: "required-span", x: px(a), y: y - 2, w: Math.max(2, px(b) - px(a)), h: barH + 4 });
    marks.push({ t: "tick", role: "required-edge", x: px(b), y0: y - 3, y1: y + barH + 3 });
  } else if (layout.reqFrac != null && !layout.noneRequired) {
    marks.push({ t: "tick", role: "required", x: px(layout.reqFrac), y0: y - 3, y1: y + barH + 3 });
  }
  // NEW-1 — the de-emphasized GROSS reference tick (a faint hollow marker), so a
  // usable-vs-gross gap stays legible without letting gross drive the verdict. Its meaning
  // rides the bar's aria/title (no label row text — that would collide with the delta).
  if (layout.refFrac != null) {
    marks.push({ t: "tick", role: "reference", x: px(layout.refFrac), y0: y - 1, y1: y + barH + 1 });
  }
  // Delta / microcopy label row.
  if (showDelta) {
    if (layout.noneRequired) {
      marks.push({ t: "text", role: "muted", x: 0, y: barH + 10, s: "required 0 — nothing to offset here", anchor: "start" });
    } else if (layout.delta != null) {
      const sign = layout.delta >= 0 ? "+" : "−";
      const mag = Math.abs(Math.round(layout.delta * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      marks.push({ t: "text", role: layout.delta >= 0 ? "good" : "danger", x: w, y: barH + 10, s: `${sign}${mag} ${unit}`, anchor: "end", mono: true });
    }
  }
  return { marks, w, h: barH + (showDelta ? 13 : 0) };
}

/* B862 — the ONE derivation of the Detention + Mitigation required-vs-provided bar specs
 * from the drainage readout object `d`. BOTH the on-screen readout (SitePlanner.jsx) and the
 * PDF export (printSheet.js) consume this, so the bar geometry, status and delta can never
 * drift (PDF-PARITY). Returns { det, mit } — each { label, layout, status, verdict } or null.
 * Pure — no React, no DOM. */
export function stormwaterBarSpecs(d) {
  const out = { det: null, mit: null };
  if (!d) return out;
  const req = d.req;
  const usableAcFt = d.providedUsableCf == null ? null : d.providedUsableCf / CF_PER_ACFT;
  const providedAcFt = d.providedCf != null ? d.providedCf / CF_PER_ACFT : 0;
  // NEW-1 — ONE source of truth: the verdict, bar, and delta ALL read USABLE
  // (providedUsableCf → usableAcFt); GROSS never drives the fill or the delta — it rides
  // only as the de-emphasized `reference` tick. A null usable is honestly "unknown" (never a
  // silent gross fallback). Point AND band both compute a covered/short verdict off usable.
  if (req && req.kind === "point" && req.requiredAcFt > 0 && usableAcFt == null) {
    out.det = { label: "Detention", layout: bulletBarLayout({ unknown: true }), status: "unknown", verdict: "usable unknown" };
  } else if (req && req.kind === "point" && req.requiredAcFt > 0) {
    const dv = usableAcFt - req.requiredAcFt;
    out.det = { label: "Detention", layout: bulletBarLayout({ provided: usableAcFt, required: req.requiredAcFt, reference: providedAcFt }), status: dv >= 0 ? "covered" : "short", verdict: `${dv >= 0 ? "+" : "−"}${_f2(Math.abs(dv))} ac-ft` };
  } else if (req && req.kind === "point") {
    out.det = { label: "Detention", layout: bulletBarLayout({ provided: usableAcFt ?? providedAcFt, required: 0 }), status: null, verdict: "none required" };
  } else if (req && req.kind === "band" && usableAcFt == null) {
    out.det = { label: "Detention", layout: bulletBarLayout({ unknown: true }), status: "unknown", verdict: "usable unknown" };
  } else if (req && req.kind === "band") {
    const prov = usableAcFt; // never gross — gross rides the reference tick only
    const status = prov >= req.bandAcFt[1] ? "covered" : prov < req.bandAcFt[0] ? "short" : "needs-input";
    out.det = { label: "Detention", layout: bulletBarLayout({ provided: prov, bandLo: req.bandAcFt[0], bandHi: req.bandAcFt[1], reference: providedAcFt }), status, verdict: `${_f2(req.bandAcFt[0])}–${_f2(req.bandAcFt[1])} ac-ft` };
  } else if (req && req.kind === "unknown") {
    out.det = { label: "Detention", layout: bulletBarLayout({ unknown: true }), status: "unknown", verdict: "required unknown" };
  }
  const mit = d.mitigation;
  if (mit && mit.intersectAcres > 0) {
    if (mit.volumeCf != null) {
      const provCf = d.mitProvided ? d.mitProvided.creditedCf : 0;
      if (provCf == null) {
        out.mit = { label: "Mitigation", layout: bulletBarLayout({ unknown: true }), status: "unknown", verdict: "provided unknown" };
      } else {
        const provAcFt = provCf / CF_PER_ACFT;
        const bal = provAcFt - mit.volumeAcFt;
        // NEW-2 — the "OVER-DUG" state is retired: an over-provided cut simply reads COVERED
        // (a zero-requirement surplus must never out-shout a real shortfall). Only a genuine
        // shortfall is loud; a surplus is quiet good.
        out.mit = {
          label: "Mitigation",
          layout: bulletBarLayout({ provided: provAcFt, required: mit.volumeAcFt }),
          status: bal < 0 ? "short" : "covered",
          verdict: bal < 0 ? `−${_f2(Math.abs(bal))} ac-ft` : "covered",
        };
      }
    } else {
      out.mit = { label: "Mitigation", layout: bulletBarLayout({ unknown: true }), status: "unknown", verdict: "volume unknown" };
    }
  }
  return out;
}

/* Stacked-bar primitives — solid segments + a labelled marker line. */
export function stackedBarMarks(layout, { w = 200, barH = 12, showMarker = true } = {}) {
  const marks = [{ t: "rect", role: "track", x: 0, y: 0, w, h: barH, rx: 3 }];
  const px = (f) => Math.round(f * w);
  for (const s of layout.segments) {
    const x = px(s.x0), x1 = px(s.x1);
    if (x1 - x > 0) marks.push({ t: "rect", role: "seg", segKey: s.key, tone: s.tone, x, y: 0, w: x1 - x, h: barH });
  }
  if (showMarker && layout.markerFrac != null) {
    marks.push({ t: "tick", role: "marker", x: px(layout.markerFrac), y0: -3, y1: barH + 3 });
    marks.push({ t: "text", role: "muted", x: Math.min(w, px(layout.markerFrac) + 3), y: barH + 10, s: "flood WSE", anchor: "start" });
  }
  return { marks, w, h: barH + 13 };
}

// ---- PDF renderer (the SAME marks → an SVG string) -------------------------
// The print sheet draws on forced-white paper, so `var(--…)` tokens don't resolve there —
// the bar uses the light-theme semantic hexes (which are exactly the on-white values). Both
// renderers (this + the DOM <BulletBar>) walk the identical mark list, so they can't drift.
const PRINT_BAR_COLORS = {
  track: "#E7E9EE",
  covered: "#15803D", short: "#B3361B", over: "#8A5410", neutral: "#6E94AB",
  tick: "#4B5263", span: "#4B5263", muted: "#8a8473", good: "#15803D", danger: "#B3361B",
  seg: { usable: "#15803D", mit: "#6E94AB", mitigation: "#6E94AB", dead: "#C2D2DC" },
};
const providedHex = (status, C) => (status === "covered" ? C.covered : status === "short" ? C.short : status === "over" || status === "needs-input" ? C.over : C.neutral);
const _esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const _r2 = (n) => Number(Number(n).toFixed(2));

/* Render a bar layout as an SVG string fragment anchored at (x,y). Returns { svg, h }.
 * `mono` (name kept for the existing call site — B895 repointed the DEFAULT and every
 * caller to the same Inter/tabular-nums numeric font the screen uses, never monospace)
 * is the delta label's font-family; `colors` overrides the print palette. Pure — used
 * by printSheet.js so the export bar matches the screen bar (PDF-PARITY). */
export function bulletBarSvg(layout, { x = 0, y = 0, w = 200, barH = 12, status = null, unit = "ac-ft", mono = "Inter, system-ui, sans-serif", colors = PRINT_BAR_COLORS } = {}) {
  const C = colors;
  const built = layout && layout.mode === "stacked" ? stackedBarMarks(layout, { w, barH }) : bulletBarMarks(layout, { w, barH, unit });
  let s = "";
  for (const m of built.marks) {
    const mx = x + m.x, my = y + (m.y ?? 0);
    if (m.t === "rect") {
      if (m.role === "track") s += `<rect x="${_r2(mx)}" y="${_r2(my)}" width="${_r2(m.w)}" height="${_r2(m.h)}" rx="${m.rx || 0}" fill="${C.track}"/>`;
      else if (m.role === "hatch") { for (let hx = -m.h; hx < m.w; hx += 5) s += `<line x1="${_r2(mx + hx)}" y1="${_r2(my + m.h)}" x2="${_r2(mx + hx + m.h)}" y2="${_r2(my)}" stroke="${C.muted}" stroke-width="1" opacity="0.5"/>`; }
      else if (m.role === "required-span") s += `<rect x="${_r2(mx)}" y="${_r2(my)}" width="${_r2(m.w)}" height="${_r2(m.h)}" fill="${C.span}" opacity="0.16"/>`;
      else if (m.role === "seg") s += `<rect x="${_r2(mx)}" y="${_r2(my)}" width="${_r2(m.w)}" height="${_r2(m.h)}" fill="${(C.seg || {})[m.segKey] || C.neutral}"/>`;
      else if (m.role === "provided") s += `<rect x="${_r2(mx)}" y="${_r2(my)}" width="${_r2(m.w)}" height="${_r2(m.h)}" rx="${m.rx || 0}" fill="${providedHex(status, C)}"/>`;
    } else if (m.t === "tick") {
      // NEW-1 — the gross reference tick is faint (thin, dashed, muted) so it reads as a
      // reference, never the requirement/provided edge.
      if (m.role === "reference") s += `<line x1="${_r2(mx)}" y1="${_r2(y + m.y0)}" x2="${_r2(mx)}" y2="${_r2(y + m.y1)}" stroke="${C.muted}" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/>`;
      else s += `<line x1="${_r2(mx)}" y1="${_r2(y + m.y0)}" x2="${_r2(mx)}" y2="${_r2(y + m.y1)}" stroke="${C.tick}" stroke-width="${m.role === "required-edge" ? 1.25 : 2}"/>`;
    } else if (m.t === "text") {
      const fill = m.role === "good" ? C.good : m.role === "danger" ? C.danger : C.muted;
      s += `<text x="${_r2(mx)}" y="${_r2(y + m.y)}" text-anchor="${m.anchor}" font-size="10" fill="${fill}"${m.mono ? ` font-family="${mono}" font-weight="700"` : ""} font-variant-numeric="tabular-nums slashed-zero">${_esc(m.s)}</text>`;
    }
  }
  return { svg: s, h: built.h };
}
