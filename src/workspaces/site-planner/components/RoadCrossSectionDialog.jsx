/* Road cross-section designer (NEW-1) — "design road": a row per band (type + width, add / remove /
 * reorder) with a LIVE TO-SCALE PLAN-VIEW PREVIEW that redraws as you type, dimension strings on each
 * band, a running total, and the derived section/ROW/pavement numbers. Presets are named + saved at
 * the ACCOUNT level (lib/userPrefs.js, the same store "Save for all projects" already uses) so a
 * section designed once is reusable on any road in any project, signed in or not (a signed-out mirror
 * lives in localStorage the same way Standards' account layer already does).
 *
 * Two ways in, both reaching this same dialog (never a popover that gates drawing — a deliberate
 * dialog opened from Properties or from the road tool's own preset menu is fine; a panel blocking the
 * canvas before anything is drawn is not, per the owner's own instruction on the cloud-tool cleanup):
 *   • Properties → "Edit cross-section..." on a selected road — `mode="edit"`, bound to that road,
 *     `lengthFt` supplied so the pavement-area preview is real, not per-100'.
 *   • The Road tool's width flyout → "Design cross-section..." — `mode="new"`, sets the ACTIVE section
 *     for the next road drawn; length is unknown yet, so the area preview reads "per 100 ft".
 *
 * Lazily loaded (a modal a session opens rarely) — same pattern as SetLocationDialog.jsx. Module
 * scope throughout (MODULE-SCOPE-COMPONENTS): XSectionPreview is a sibling function component, never
 * defined inside the dialog's render body. */
import { useEffect, useRef, useState } from "react";
import {
  BAND_TYPES, bandTypeOf, normalizeBands, makeXSection, curbToCurbWidth, pavedWidth, rowWidth,
  pavementArea, bandLayout, bandStripeMarks, BAND_FILL_TOKEN, BAND_FILL_OPACITY, BUILT_IN_XSECTION_PRESETS,
  MIN_BAND_WIDTH_FT, parseWidthDraft,
} from "../lib/roadCrossSection.js";

const f1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "—");
const f0 = (n) => (Number.isFinite(n) ? Math.round(n).toString() : "—");
const uid = () => `xsec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const PREVIEW_LEN = 90; // the "along the road" swatch length in px — no dimension, just texture
const PREVIEW_H = 180; // FIXED px height, matched 1:1 by the SVG's viewBox — see XSectionPreview
const PREVIEW_LADDER_W = 110; // room reserved right of the swatch for the tick ladder + the horizontal total-width label
const MAX_PX_PER_FT = 6.5; // legibility ceiling — a narrow section's bands don't get absurdly tall

/* NEW-1 follow-up — the width field that used to be a raw, always-controlled `<input type="number">`
 * bound straight to committed band state, so every keystroke was a commit: typing "2" on the way to
 * "25" instantly set that band's width to 2, and the WHOLE dialog (preview + every derived total)
 * recomputed off that transient value. This mirrors SitePlanner.jsx's NumInput contract — a local
 * DRAFT the user types into, committed to the model only on blur or Enter — so a prefix of a valid
 * number (or any of the other legitimate mid-typing states parseWidthDraft names) never touches
 * `bands`, and the preview/totals therefore keep showing the LAST COMMITTED geometry the whole time
 * someone is mid-edit. No error styling is shown at all here — an unparseable draft at commit time
 * just silently reverts to the last committed value, and a below-minimum one is silently clamped up
 * to MIN_BAND_WIDTH_FT — never a red border, never a blocked keystroke, per the owner's own rule. */
function BandWidthInput({ value, onCommit }) {
  const [draft, setDraft] = useState(() => String(value));
  const committedRef = useRef(value);
  useEffect(() => {
    if (value !== committedRef.current) { committedRef.current = value; setDraft(String(value)); }
  }, [value]);
  const commit = () => {
    const n = parseWidthDraft(draft);
    const next = n == null ? committedRef.current : Math.max(MIN_BAND_WIDTH_FT, n);
    committedRef.current = next;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input type="text" inputMode="decimal" value={draft} aria-label="Band width, feet"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          const el = e.currentTarget;
          requestAnimationFrame(() => { try { el.select(); } catch (_) {} });
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(String(committedRef.current));
        }
      }}
      style={{ width: 60, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }} />
  );
}

const STRIPE_STYLE = {
  "yellow-solid": { stroke: "#e6b800", dash: undefined, w: 1.6 },
  "yellow-double": { stroke: "#e6b800", dash: undefined, w: 1.6, double: true },
  "white-dash": { stroke: "#f2f2f2", dash: "10 8", w: 1.4 },
  "white-solid": { stroke: "#f2f2f2", dash: undefined, w: 1.4 },
};

/* The live plan-view schematic: the road runs left-right (the swatch length carries no dimension —
 * it's just enough asphalt texture to read as a road), bands stack top-to-bottom (across the road,
 * which is how a cross-section is actually measured). Pure presentation over bandLayout/
 * bandStripeMarks.
 *
 * NEW-1 follow-up (owner report) — the box used to compute its OWN viewBox height from content
 * (`h = rowW * scale`) while separately clamping the CSS display height into [60, 280], so a narrow
 * section's tiny viewBox got stretched by the browser to fill a much taller box — every fixed-unit
 * font size stretched right along with it, which is what turned a 2 ft section's "2′" label into an
 * enormous numeral floating in an empty rectangle.
 *
 * Fixed at the root, and deliberately NOT with an `aspectRatio` CSS trick tried first: that kept
 * `width: 100%`, and this dialog's body is wide enough that "100%" alone reproduced the same class of
 * blow-up (a live measurement here found font glyphs rendering 3-4x their authored size — the same
 * failure, just driven by the CONTAINER's width instead of by rowW). So the SVG is rendered at its
 * OWN fixed pixel size — `width={CONTENT_W} height={PREVIEW_H}`, exactly matching the viewBox — and
 * ONLY shrinks (never grows) on a viewport narrower than that, via `maxWidth: "100%"` +
 * `height: "auto"`. 1 viewBox unit is therefore 1 real CSS px whenever there is room for it, which is
 * every case this dialog (`min(720px, 100%)` wide) is ever opened in — so the browser has no reason
 * to rescale anything, ever, regardless of rowW OR of the dialog's own width. The per-foot `scale` is
 * capped at MAX_PX_PER_FT and otherwise sized to exactly fill PREVIEW_H, so content height is always
 * <= PREVIEW_H by construction — a narrow section just renders a shorter, vertically-centered band
 * stack rather than an oversized one. */
function XSectionPreview({ xsection }) {
  const { edges, rowW } = bandLayout(xsection);
  if (!edges.length || !(rowW > 0)) return null;
  const scale = Math.min(MAX_PX_PER_FT, PREVIEW_H / rowW); // px per foot — content height never exceeds PREVIEW_H
  const contentH = rowW * scale;
  const padTop = Math.max(0, (PREVIEW_H - contentH) / 2); // center a narrow section's band stack vertically
  const W = PREVIEW_LEN;
  const CONTENT_W = W + PREVIEW_LADDER_W;
  const yOf = (offsetFt) => padTop + (rowW / 2 - offsetFt) * scale; // offset 0 (centerline) → mid-height
  const marks = bandStripeMarks(xsection);
  return (
    <svg viewBox={`0 0 ${CONTENT_W} ${PREVIEW_H}`} width={CONTENT_W} height={PREVIEW_H} style={{ display: "block", maxWidth: "100%", height: "auto", background: "var(--surface-base)", borderRadius: 8 }} role="img" aria-label="Cross-section preview, plan view">
      {edges.map((e) => {
        const y0 = yOf(e.from), y1 = yOf(e.to);
        const bandH = Math.max(0.5, y1 - y0);
        const tok = BAND_FILL_TOKEN[e.band.type];
        const legible = bandH >= 12;
        return (
          <g key={e.index}>
            <rect x={0} y={y0} width={W} height={bandH} fill={tok || "var(--planner-raised)"} fillOpacity={tok ? BAND_FILL_OPACITY[e.band.type] : 0.5} stroke="var(--planner-border)" strokeWidth={0.5} />
            {legible && (
              <text x={W / 2} y={y0 + bandH / 2} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: bandH > 22 ? 10.5 : 9, fill: "var(--text-secondary)", fontWeight: 600 }}>
                {bandH > 26 ? `${bandTypeOf(e.band.type).label} · ${f1(e.band.w)}′` : `${f1(e.band.w)}′`}
              </text>
            )}
          </g>
        );
      })}
      {/* lane markings at within-curb seams */}
      {marks.map((m, i) => {
        const y = yOf(m.atOffset);
        const st = STRIPE_STYLE[m.style];
        if (!st) return null;
        if (st.double) {
          return (
            <g key={i}>
              <line x1={0} y1={y - 1.1} x2={W} y2={y - 1.1} stroke={st.stroke} strokeWidth={st.w} />
              <line x1={0} y1={y + 1.1} x2={W} y2={y + 1.1} stroke={st.stroke} strokeWidth={st.w} />
            </g>
          );
        }
        return <line key={i} x1={0} y1={y} x2={W} y2={y} stroke={st.stroke} strokeWidth={st.w} strokeDasharray={st.dash} />;
      })}
      {/* dimension ladder on the right: a tick at every band boundary. NEW-1 follow-up — the running
       * total used to be a text label ROTATED 90° right beside this ladder, which needed the box's
       * HEIGHT to hold the whole string's length; at any modest box height that clipped it to a
       * fragment ("tot") and its glyphs overlapped the ladder. It's now a plain horizontal label
       * clear of the ladder, so it only ever needs the WIDTH this component already reserves
       * (PREVIEW_LADDER_W) — never clipped or colliding, at any section width. */}
      <g stroke="var(--text-tertiary)" strokeWidth={0.75} fill="none">
        <line x1={W + 14} y1={padTop} x2={W + 14} y2={padTop + contentH} />
        {edges.map((e) => <line key={`t${e.index}`} x1={W + 10} y1={yOf(e.to)} x2={W + 18} y2={yOf(e.to)} />)}
        <line x1={W + 10} y1={padTop} x2={W + 18} y2={padTop} />
      </g>
      <text x={W + 24} y={PREVIEW_H / 2} textAnchor="start" dominantBaseline="middle" style={{ fontSize: 10, fill: "var(--text-tertiary)", fontWeight: 600 }}>{f1(rowW)}′ total</text>
    </svg>
  );
}

const rowStyle = { display: "flex", alignItems: "center", gap: 6, padding: "4px 0" };
const smallBtn = { width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--planner-border)", background: "var(--surface-raised)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 };

export default function RoadCrossSectionDialog({ mode = "edit", initialXSection, lengthFt, presets, onSavePreset, onApply, onCancel }) {
  const [bands, setBands] = useState(() => normalizeBands(initialXSection && initialXSection.bands));
  const [presetName, setPresetName] = useState("");
  const x = makeXSection(bands);
  const c2c = curbToCurbWidth(x), row = rowWidth(x);
  const areaLenFt = mode === "edit" && lengthFt > 0 ? lengthFt : 100;
  const area = pavementArea(x, areaLenFt);
  const allPresets = [...BUILT_IN_XSECTION_PRESETS, ...(Array.isArray(presets) ? presets : [])];

  const setBand = (i, patch) => setBands((a) => a.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBand = () => setBands((a) => [...a, { type: "travel", w: bandTypeOf("travel").defaultFt }]);
  const removeBand = (i) => setBands((a) => a.filter((_, j) => j !== i));
  const move = (i, dir) => setBands((a) => {
    const j = i + dir;
    if (j < 0 || j >= a.length) return a;
    const next = a.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const loadPreset = (p) => setBands(normalizeBands(p.bands));
  const saveAsPreset = () => {
    const name = presetName.trim();
    if (!name || !onSavePreset) return;
    const userPresets = Array.isArray(presets) ? presets : [];
    onSavePreset([...userPresets, { id: uid(), name, bands: normalizeBands(bands) }]);
    setPresetName("");
  };
  const deletePreset = (id) => { if (onSavePreset) onSavePreset((presets || []).filter((p) => p.id !== id)); };

  const canApply = bands.length > 0 && c2c > 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Design road cross-section" data-testid="road-xsection-dialog"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(20,18,15,0.42)", display: "grid", placeItems: "center", padding: 16 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div onPointerDown={(e) => e.stopPropagation()}
        style={{ width: "min(720px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "var(--surface-raised)", border: "1px solid var(--planner-border)", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.32)", padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Design road cross-section</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.5 }}>
          An ordered list of bands across the road — travel lanes, a median, turn lane, shoulders, parking, sidewalks. Widths are measured across the centerline.
        </div>

        <div style={{ marginTop: 12 }}>
          <XSectionPreview xsection={x} />
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
          <span>Section width (curb to curb) <b style={{ color: "var(--text-primary)" }}>{f1(c2c)}′</b></span>
          <span>Total ROW width <b style={{ color: "var(--text-primary)" }}>{f1(row)}′</b></span>
          {/* NEW-1 follow-up (owner review, item 4) — "(per 100′)" sat BEFORE the number, where it
           * reads as a passing qualifier easily skimmed past; a reader could mistake the number for
           * the road's real total pavement area. Moved after the number, spelled out as a rate
           * ("...per 100 ft of road"), so it reads unambiguously as a unit on the figure itself. */}
          <span>Pavement area <b style={{ color: "var(--text-primary)" }}>{f0(area.sf)} SF · {f1(area.sy)} SY</b>{mode === "edit" && lengthFt > 0 ? "" : " per 100 ft of road"}</span>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, color: "var(--text-tertiary)", marginBottom: 4 }}>Bands</div>
          {bands.map((b, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <button type="button" style={smallBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">▲</button>
                <button type="button" style={smallBtn} disabled={i === bands.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down">▼</button>
              </span>
              <select value={b.type} onChange={(e) => setBand(i, { type: e.target.value })}
                style={{ flex: "1 1 auto", minWidth: 0, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }}>
                {BAND_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <BandWidthInput value={b.w} onCommit={(w) => setBand(i, { w })} />
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ft</span>
              </span>
              <button type="button" style={{ ...smallBtn, width: 26, height: 26, color: "var(--danger)" }} onClick={() => removeBand(i)} aria-label="Remove band" title="Remove band">✕</button>
            </div>
          ))}
          <button type="button" onClick={addBand}
            style={{ marginTop: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "1px dashed var(--planner-border)", background: "transparent", color: "var(--accent)", cursor: "pointer" }}>
            ＋ Add band
          </button>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--planner-border)", paddingTop: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, color: "var(--text-tertiary)", marginBottom: 6 }}>Presets</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allPresets.map((p) => (
              <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <button type="button" onClick={() => loadPreset(p)}
                  style={{ padding: "5px 10px", fontSize: 12, borderRadius: 999, border: "1px solid var(--planner-border)", background: "var(--surface-base)", color: "var(--text-primary)", cursor: "pointer" }}>
                  {p.name}
                </button>
                {!p.builtin && <button type="button" onClick={() => deletePreset(p.id)} aria-label={`Delete preset ${p.name}`} title="Delete preset"
                  style={{ ...smallBtn, width: 20, height: 20, fontSize: 10, color: "var(--text-tertiary)" }}>✕</button>}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this section to reuse it on any road, any project"
              style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }} />
            <button type="button" disabled={!presetName.trim()} onClick={saveAsPreset}
              style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "1px solid var(--planner-border)", background: "var(--surface-base)", color: presetName.trim() ? "var(--text-primary)" : "var(--text-tertiary)", cursor: presetName.trim() ? "pointer" : "default" }}>
              Save as preset
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "1px solid var(--planner-border)", background: "var(--surface-raised)", color: "var(--text-primary)", cursor: "pointer" }}>Cancel</button>
          <button type="button" data-testid="road-xsection-apply" disabled={!canApply} onClick={() => canApply && onApply(x)}
            style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "1px solid var(--accent)", background: canApply ? "var(--accent)" : "var(--surface-raised)", color: canApply ? "var(--on-accent)" : "var(--text-tertiary)", cursor: canApply ? "pointer" : "default" }}>
            {mode === "edit" ? "Apply to this road" : "Use this section"}
          </button>
        </div>
      </div>
    </div>
  );
}
