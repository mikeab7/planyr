import RowInfo from "./RowInfo.jsx";

/* Chip (FINAL UI SPEC — Yield panel + Pond inspector) — a compact one-line status chip
 * (≤6 words) that condenses a formerly-inline sentence: a tone-colored pill carries the
 * short label, and a ⓘ opens a real popover (RowInfo — the same "Basis" popover SourceTag
 * uses) holding the FULL original text, so nothing is lost — the detail just moves one
 * hover/click away and stays keyboard-reachable.
 *
 * tone "amber" = a watch-out (the warn token + a ⚠ glyph, so color is never the only
 * signal); tone "neutral" = an informational tag (secondary text). `popover` is a string or
 * an array of { text, tone } RowInfo sections. Theme tokens only. Module scope. */
export default function Chip({ tone = "neutral", text, popover, label, style }) {
  const amber = tone === "amber";
  const color = amber ? "var(--warn-text)" : "var(--text-secondary)";
  const sections = Array.isArray(popover) ? popover : popover ? [{ text: popover }] : [];
  return (
    <span
      style={{
        // PR-I (I4) — a chip must WRAP within the panel, never run off the right edge. Long
        // guard sentences (e.g. "Rim above site grade: runoff needs inlets through the berm")
        // were clipped off-screen because the pill was whiteSpace:nowrap. Cap it at the
        // container width and let the text wrap; short chips still sit on one line.
        display: "inline-flex", alignItems: "flex-start", gap: 4,
        padding: "2px 8px", borderRadius: 12,
        border: `1px solid ${color}`, background: "transparent",
        fontSize: 10.5, fontWeight: 700, lineHeight: 1.45, color,
        whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "100%", minWidth: 0, ...style,
      }}
    >
      {amber ? <span aria-hidden="true" style={{ fontSize: 10, flex: "none", marginTop: 1 }}>⚠</span> : null}
      <span style={{ minWidth: 0 }}>{text}</span>
      {sections.length ? <RowInfo label={label || text} sections={sections} /> : null}
    </span>
  );
}
