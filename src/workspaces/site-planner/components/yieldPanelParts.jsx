/* The Yield and Drainage panels' shared module-scope pieces (palette, chips, disclosure, bars, change-summary card, row helpers), moved
 * verbatim out of YieldDrainagePanels.jsx (audit batch L3). @planner-extract */
import { useState, useRef, useEffect, Suspense } from "react";
import ActionLink from "./ActionLink.jsx";
import { bulletBarMarks, stackedBarMarks } from "../lib/yieldBar.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { buildChangeSummaryRows } from "../lib/pondChangeSummary.js";
import SourceTag from "./SourceTag.jsx";
import { PondSection, ROWB6 } from "../lib/plannerShared.js";

export const YIELD_PAL = {
  building: "#C45A32", buildingAccent: "#C0532E", // terracotta — footprint coverage
  paving: "#B6AB9B",                               // warm taupe — paving / parking
  green: "#4FA587",                                // sage — open / green
  detention: "#6E94AB", detZeroFill: "#DCE5EB", detZeroBorder: "#C2D2DC", // dusty blue
  // B686: surfaces/borders/text now theme with the app (parchment in light, slate in dark)
  // via the shared --planner-* + text tokens. The chart hues above stay fixed (one semantic
  // colour = one meaning across arcs/legend/dots). warn/danger text ride the theme tokens
  // again now that the card itself flips — they're AA on the parchment in light AND on the
  // dark card in dark.
  panelBg: "var(--planner-raised)", border: "var(--planner-border)", cardBg: "var(--planner-panel)",
  text: "var(--text-primary)", rowLabel: "var(--text-secondary)", muted: "var(--text-tertiary)", faint: "var(--text-tertiary)",
  hairline: "var(--planner-border)", track: "var(--planner-border)", iconTile: "var(--planner-raised)",
  warnText: "var(--warn-text)", dangerText: "var(--danger-text)",
};

// B860 (chat NEW-1) — flash a value when it changes, so a silent number swap can't slip
// past (a 5 ac-ft detention move is exactly what a user must NOT miss). Skips the first
// mount (no flash on panel open); restarts the CSS animation on every `token` change by
// removing + re-adding the class after a forced reflow. Module scope (MODULE-SCOPE-COMPONENTS).
export function FlashValue({ token, children, style }) {
  const ref = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("planyr-flash");
    void el.offsetWidth; // force reflow so the animation replays even for the same class
    el.classList.add("planyr-flash");
  }, [token]);
  return <span ref={ref} style={{ display: "inline-block", borderRadius: 4, ...style }}>{children}</span>;
}

// B862 (chat NEW-3) — the verdict status chip: a SOLID semantic fill (house rule) with
// theme-correct text. Every semantic *-text token is DARK in light / BRIGHT in dark, and
// --on-accent is white in light / near-black in dark — i.e. --on-accent is exactly the AA
// text colour on any of these fills, in both themes. Hierarchy by weight/size/letter-
// spacing, never by fading (theming rule). Module scope (MODULE-SCOPE-COMPONENTS).
export const CHIP_FILL = { danger: "var(--danger-text)", good: "var(--success-text)", warn: "var(--warn-text)", info: "var(--info-text)" };
export function StatusChip({ label, tone }) {
  const fill = CHIP_FILL[tone] || CHIP_FILL.info;
  return (
    <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--on-accent)", background: fill, borderRadius: 4, padding: "2px 5px", whiteSpace: "nowrap", flex: "none" }}>{label}</span>
  );
}

// v3 A1 — the inline "Assumptions & method (N)" disclosure inside a drainage verdict group.
// A real, self-contained <button> that carries aria-expanded and flips its chevron, so a
// screen reader announces the open/closed state and the header reliably toggles by mouse
// AND keyboard (a native <button> activates on Enter and Space for free — no custom key
// handler, which would double-fire against the synthetic click). Opening renders the
// relocated method rows as its own children. The live post-ship audit found the prior
// inline header didn't reliably open; rebuilding it as this dedicated control fixes that
// and makes the state programmatically inspectable. Module scope (MODULE-SCOPE-COMPONENTS).
export function InlineDisclosure({ open, onToggle, label, count, children, Y }) {
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        data-testid="assumptions-method-toggle"
        style={{ background: "transparent", border: "none", padding: "2px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 10, color: Y.rowLabel, fontWeight: 700, letterSpacing: "0.04em" }}
      >
        {open ? "▾" : "▸"} {label} ({count})
      </button>
      {open && <div data-testid="assumptions-method-body" style={{ marginTop: 1 }}>{children}</div>}
    </div>
  );
}

// v3 B6 — the COSTS group body is two flat rows (Earthwork · Road); each carries a
// "Set unit prices →" link that reveals the existing line-item + unit-price inputs in place,
// instead of two always-present "… cost (screening)" accordions. Module scope
// (MODULE-SCOPE-COMPONENTS). `summary` is an optional right-aligned muted note (e.g. a total).
export function CostDisclosure({ label, summary, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--planner-border)", padding: "2px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0" }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {summary ? <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{summary}</span> : null}
          <ActionLink onClick={() => setOpen((o) => !o)}>{open ? "Hide unit prices" : "Set unit prices →"}</ActionLink>
        </span>
      </div>
      {open && <div style={{ paddingBottom: 8 }}>{children}</div>}
    </div>
  );
}

// v3 B7 — the ONE provenance legend (PLAN / CODE / EST / YOU / SURVEY), shared by the Yield
// footer and the bottom of the pond panel so both read from one definition. Module scope.
export function ProvenanceLegend({ style }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 9.5, color: "var(--text-tertiary)", lineHeight: 1.6, ...style }}>
      {[["PLAN", "measured from your drawing"], ["CODE", "adopted criteria"], ["EST", "estimated"], ["YOU", "your input"], ["SURVEY", "from terrain data"]].map(([tag, def]) => (
        <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.05em", color: "var(--text-tertiary)", border: "1px solid var(--planner-border)", borderRadius: 4, padding: "1px 4px" }}>{tag}</span>
          <span>{def}</span>
        </span>
      ))}
    </div>
  );
}

// B862 — the shared required-vs-provided bullet bar (screen renderer). It walks the SAME
// primitive list (yieldBar.js bulletBarMarks / stackedBarMarks) that the PDF export walks,
// so the on-screen bar and the printed bar can never drift (PDF-PARITY). Inline SVG; fills go
// through `style` so the theme tokens actually resolve (a `fill=` attribute would not).
export function barFill(role, status, Y) {
  if (role === "provided") {
    return status === "covered" ? "var(--success-text)"
      : status === "short" ? "var(--danger-text)"
      : status === "over" || status === "needs-input" ? "var(--warn-text)"
      : Y.detention;
  }
  return Y.rowLabel;
}
export const segFill = (key, Y) => (key === "usable" ? "var(--success-text)" : key === "mit" || key === "mitigation" ? Y.detention : Y.detZeroBorder);
export function barAria(layout, status, unit) {
  if (!layout || layout.unknown) return "Required vs provided: unknown — an input is missing";
  if (layout.mode === "stacked") return `Storage split across ${layout.segments.length} bands, total ${(Math.round(layout.total * 100) / 100)} ${unit}`;
  if (layout.noneRequired) return `Provided ${Math.round(layout.provided * 100) / 100} ${unit}; nothing required`;
  const req = layout.bandHi != null ? `band ${layout.bandLo}–${layout.bandHi}` : layout.required;
  return `Provided ${Math.round(layout.provided * 100) / 100} vs required ${req} ${unit} — ${status || ""}`;
}
// v3 A2/A3 — the requirement band bar was REMOVED. The provided/required pair now renders
// exactly once per panel, in the verdict strip (G1); the DETENTION/MITIGATION DETAIL groups
// no longer restate it. (Was RequirementBand + BAND_BADGE; the pair math lives in
// yieldVerdicts.js and the strip.)
export function BulletBar({ layout, width = 210, status = null, unit = "ac-ft", Y }) {
  if (!layout) return null;
  const built = layout.mode === "stacked" ? stackedBarMarks(layout, { w: width }) : bulletBarMarks(layout, { w: width, unit });
  const { marks, w, h } = built;
  const pad = 4;
  return (
    <svg width={w} height={h + pad} viewBox={`0 ${-pad} ${w} ${h + pad}`} style={{ display: "block", overflow: "visible" }} role="img" aria-label={barAria(layout, status, unit)}>
      <defs>
        <pattern id="planyrBarHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" style={{ fill: Y.track }} />
          <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: Y.muted, strokeWidth: 2, opacity: 0.55 }} />
        </pattern>
      </defs>
      {marks.map((m, i) => {
        if (m.t === "rect") {
          if (m.role === "hatch") return <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} rx={m.rx || 0} fill="url(#planyrBarHatch)" />;
          if (m.role === "required-span") return <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} style={{ fill: Y.rowLabel, opacity: 0.16 }} />;
          if (m.role === "seg") return <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} style={{ fill: segFill(m.segKey, Y) }} />;
          return <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} rx={m.rx || 0} style={{ fill: barFill(m.role, status, Y) }} />;
        }
        if (m.t === "tick") return m.role === "reference"
          ? <line key={i} x1={m.x} y1={m.y0} x2={m.x} y2={m.y1} style={{ stroke: Y.muted, strokeWidth: 1, strokeDasharray: "2 2", opacity: 0.7 }} />
          : <line key={i} x1={m.x} y1={m.y0} x2={m.x} y2={m.y1} style={{ stroke: Y.rowLabel, strokeWidth: m.role === "required-edge" ? 1.25 : 2 }} />;
        if (m.t === "text") return <text key={i} x={m.x} y={m.y} textAnchor={m.anchor} style={{ fill: m.role === "good" ? "var(--success-text)" : m.role === "danger" ? "var(--danger-text)" : Y.muted, fontSize: 10, fontWeight: m.role === "good" || m.role === "danger" ? 750 : 400, fontFamily: m.mono ? NUM_FONT : "inherit", fontVariantNumeric: TABULAR_NUMS }}>{m.s}</text>;
        return null;
      })}
    </svg>
  );
}


// B909 round 4 (owner spec, upgrading a transient toast + Undo) — the PERSISTENT
// "what changed" card after ⚡ Design pond runs: every elevation delta in plain before ->
// after terms, a schematic cross-section, and a prominent Undo that reverts the WHOLE
// operation in one click (the app's normal undo stack — designPond() pushes exactly one
// history frame). Stays open until dismissed; the SAME layout renders the infeasibility
// proposal when the elevation-only solve couldn't meet the requirement on this footprint
// (nothing was applied then — no Undo button, since there's nothing to undo). Module
// scope (MODULE-SCOPE-COMPONENTS).
export function DesignChangeSummaryCard({ summary, onDismiss, onUndo }) {
  if (!summary) return null;
  const rows = buildChangeSummaryRows(summary);
  if (!summary.infeasible && !rows.length) return null; // a true no-op (already covered) — nothing to show
  return (
    <div style={{ marginTop: 10, marginBottom: 12, border: `1.5px solid ${summary.infeasible ? "var(--danger-text)" : "var(--planner-border)"}`, borderRadius: 10, background: "var(--planner-raised)", padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: summary.infeasible ? "var(--danger-text)" : "var(--text-primary)" }}>
          {summary.infeasible ? "⚡ Optimize pond: couldn't fully close the gap" : "⚡ Optimize pond: what changed"}
        </div>
        <button type="button" onClick={onDismiss} title="Dismiss" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "var(--text-tertiary)", padding: 0, lineHeight: 1 }}>×</button>
      </div>
      {/* C1 — the proposal shows whether the click applied nothing (infeasible) OR applied the
          rim/berm but a gap remains; in the applied case it reads as the next step to close it. */}
      {summary.proposal && (
        <div style={{ fontSize: 11.5, color: "var(--text-primary)", lineHeight: 1.5, margin: "6px 0 2px" }}>{summary.proposal}</div>
      )}
      {rows.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {summary.infeasible && <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontStyle: "italic" }}>What this footprint could achieve (not applied):</div>}
          {rows.map((r) => (
            <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11 }}>
              <span style={{ color: "var(--text-secondary)" }}>{r.label}</span>
              <span style={{ textAlign: "right", color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>
                {r.from != null ? <>{r.from} → </> : null}<strong>{r.to}</strong>
                {r.note ? <span style={{ marginLeft: 6, fontFamily: "inherit", fontWeight: 400, color: "var(--text-tertiary)" }}>({r.note})</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {summary.sectionFacts && (
        <div style={{ marginTop: 9 }}>
          <Suspense fallback={null}><PondSection facts={summary.sectionFacts} /></Suspense>
        </div>
      )}
      {!summary.infeasible && (
        <button type="button" onClick={onUndo} style={{ marginTop: 8, padding: "6px 12px", border: "1px solid var(--danger-text)", borderRadius: 7, background: "none", color: "var(--danger-text)", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
          ↶ Undo this change
        </button>
      )}
    </div>
  );
}

// NEW-1 (2026-09-05, owner directive — split Yield: Analysis screens, Drainage decides, Yield
// reports what's left over) — promoted to module scope so BOTH `YieldPanel` and the new
// `DrainagePanel` (below) can share one copy: MODULE-SCOPE-COMPONENTS means neither component can
// close over the other's locals, and these three tiny row/label renderers have no state of their
// own — they only ever read the (module-scope, theme-fixed) `YIELD_PAL` palette.
export const groupHead = (color, label) => (
  <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "13px 0 5px" }}>
    <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flex: "none" }} />
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: YIELD_PAL.rowLabel }}>{label}</span>
  </div>
);
// B895 — `tag` is an optional { code, basis } naming the headline value's SourceTag
// (CODE/PLAN/SURVEY/ESTIMATE/YOURS/UNVERIFIED); omitted → no tag (unchanged today).
export const row = (label, value, sub, muted, tag) => (
  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${YIELD_PAL.hairline}`, gap: 8 }}>
    <span style={{ fontSize: 12, color: muted ? YIELD_PAL.muted : YIELD_PAL.rowLabel }}>{label}</span>
    <span style={ROWB6}>
      <span style={{ fontFamily: NUM_FONT, fontSize: 13, color: muted ? YIELD_PAL.muted : YIELD_PAL.text, fontWeight: 650, fontVariantNumeric: TABULAR_NUMS }}>
        {value}{sub ? <span style={{ color: YIELD_PAL.muted, fontWeight: 400, fontSize: 10.5 }}> {sub}</span> : null}
      </span>
      {tag ? <SourceTag code={tag.code} label={label} basis={tag.basis} /> : null}
    </span>
  </div>
);
export const note = (text) => <div style={{ fontSize: 10.5, color: YIELD_PAL.muted, lineHeight: 1.4, margin: "3px 0 0" }}>{text}</div>;

