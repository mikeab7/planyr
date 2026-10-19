/* RecordSection — the sectioned "spec sheet" the Site page's single-record view is built from
 * (NEW-1, owner-approved layout V1, 2026-10-19). Shared by the comp's fields (CompsPanel's
 * CompDetail) and its Documents block (SitePlansSection) so the two read as ONE panel.
 *
 * The hierarchy is made of structure, never of text size: one body size (FONT_SIZE.display) and
 * one line height everywhere, a section header that is the ONLY smaller text (uppercase, bold,
 * letter-spaced) over a dark rule, and a faint hairline between rows. No gray fills, no opacity.
 * Module scope (MODULE-SCOPE-COMPONENTS). */
import { FONT_SIZE } from "./designTokens.js";

export const RECORD_BODY = { fontSize: FONT_SIZE.display, lineHeight: "20px" };
export const RECORD_LABEL_W = 132;

/** The section's header: the word left, an optional action right, both sitting on the dark rule. */
export function RecordSectionHeader({ title, right, testId }) {
  return (
    <div data-testid={testId} style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
      marginTop: 14, paddingBottom: 6, borderBottom: "1px solid var(--text-primary)",
    }}>
      <span style={{ fontSize: FONT_SIZE.control, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-primary)" }}>{title}</span>
      {right || null}
    </div>
  );
}

/** One label / value row of a section: muted label in a fixed column, dark value beside it. */
export function RecordRow({ label, last, children }) {
  return (
    <div data-record-row style={{
      display: "grid", gridTemplateColumns: `${RECORD_LABEL_W}px minmax(0, 1fr)`, columnGap: 12, alignItems: "baseline",
      padding: "6px 0", borderBottom: last ? "none" : "1px solid var(--border-hairline)", ...RECORD_BODY,
    }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)", overflowWrap: "anywhere", minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** A section: header + its rows. A section with no rows is not rendered at all. */
export function RecordSection({ id, title, rows, renderValue }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section data-record-section={id}>
      <RecordSectionHeader title={title} />
      {rows.map((r, i) => (
        <RecordRow key={r.key} label={r.label} last={i === rows.length - 1}>{renderValue ? renderValue(r) : r.value}</RecordRow>
      ))}
    </section>
  );
}

/** A text-weight link (brand green), used for "Add", "Zoom to" and a Source row. */
export function RecordLink({ onClick, children, title, testId, disabled }) {
  return (
    <button type="button" onClick={onClick} title={title} data-testid={testId} disabled={disabled} style={{
      border: "none", background: "none", padding: 0, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
      fontSize: "inherit", lineHeight: "inherit", fontWeight: 600, color: disabled ? "var(--text-secondary)" : "var(--accent-site-text)", textAlign: "left",
    }}>{children}</button>
  );
}
