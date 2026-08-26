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
import { useState } from "react";
import {
  BAND_TYPES, bandTypeOf, normalizeBands, makeXSection, curbToCurbWidth, pavedWidth, rowWidth,
  pavementArea, bandLayout, bandStripeMarks, BAND_FILL_TOKEN, BAND_FILL_OPACITY, BUILT_IN_XSECTION_PRESETS,
} from "../lib/roadCrossSection.js";

const f1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "—");
const f0 = (n) => (Number.isFinite(n) ? Math.round(n).toString() : "—");
const uid = () => `xsec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const PREVIEW_W = 520, PREVIEW_LEN = 90; // px — the "along the road" swatch length (no dimension, just texture)

const STRIPE_STYLE = {
  "yellow-solid": { stroke: "#e6b800", dash: undefined, w: 1.6 },
  "yellow-double": { stroke: "#e6b800", dash: undefined, w: 1.6, double: true },
  "white-dash": { stroke: "#f2f2f2", dash: "10 8", w: 1.4 },
  "white-solid": { stroke: "#f2f2f2", dash: undefined, w: 1.4 },
};

/* The live plan-view schematic: the road runs left-right (the swatch length carries no dimension —
 * it's just enough asphalt texture to read as a road), bands stack top-to-bottom (across the road,
 * which is how a cross-section is actually measured). Pure presentation over bandLayout/
 * bandStripeMarks; not to scale for very narrow dialogs, only for the ft→px ratio itself. */
function XSectionPreview({ xsection, width = PREVIEW_W }) {
  const { edges, rowW } = bandLayout(xsection);
  if (!edges.length || !(rowW > 0)) return null;
  const scale = Math.min(6.5, (width - 40) / rowW); // px per foot, capped so a narrow section doesn't look absurdly fat
  const h = rowW * scale;
  const W = PREVIEW_LEN;
  const yOf = (offsetFt) => (rowW / 2 - offsetFt) * scale; // offset 0 (centerline) → mid-height
  const marks = bandStripeMarks(xsection);
  return (
    <svg viewBox={`0 0 ${W + 90} ${h}`} width="100%" height={Math.max(60, Math.min(280, h))} style={{ display: "block", background: "var(--surface-base)", borderRadius: 8 }} role="img" aria-label="Cross-section preview, plan view">
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
      {/* dimension ladder on the right: a tick at every band boundary + the running total */}
      <g stroke="var(--text-tertiary)" strokeWidth={0.75} fill="none">
        <line x1={W + 14} y1={0} x2={W + 14} y2={h} />
        {edges.map((e) => <line key={`t${e.index}`} x1={W + 10} y1={yOf(e.to)} x2={W + 18} y2={yOf(e.to)} />)}
        <line x1={W + 10} y1={0} x2={W + 18} y2={0} />
      </g>
      <text x={W + 24} y={h / 2} transform={`rotate(90 ${W + 24} ${h / 2})`} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-tertiary)", fontWeight: 600 }}>{f1(rowW)}′ total</text>
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
          <span>Pavement area {mode === "edit" && lengthFt > 0 ? "" : "(per 100′)"} <b style={{ color: "var(--text-primary)" }}>{f0(area.sf)} SF · {f1(area.sy)} SY</b></span>
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
                <input type="number" min={1} value={b.w} onChange={(e) => setBand(i, { w: Math.max(0.1, +e.target.value || 0) })}
                  style={{ width: 60, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }} />
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
