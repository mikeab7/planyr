/* PursuitsCard — the Dashboard's "Pursuits" card (B1161793, NEW-2, Direction C's second real
 * content card — replacing the placeholder "Pursuits by activity" card, per the owner's
 * approved design). A table of open pursuits sorted by soonest upcoming contractual date.
 *
 * Columns, left to right, per the owner's amendment: Pursuit (name, county underneath) / Yield /
 * Next (the nearest contractual date's label, then its date + countdown on a second line) /
 * Quiet for. Acres was explicitly dropped ("Yield is what he compares two deals on; acreage is a
 * detail you look up once you are inside the deal") and the separate "In" column was folded into
 * Next's second line, per the same correction.
 */
import { formatShortDate } from "../lib/dashboardDates.js";
import { nextLineTone, isQuietEmphasized } from "../lib/pursuitsList.js";

const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };
const TONE_COLOR = { danger: "var(--danger-text)", accent: "var(--accent)", muted: "var(--text-secondary)" };
const dayWord = (n) => (n === 1 ? "day" : "days");

const thStyle = (align) => ({
  textAlign: align, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--text-secondary)", padding: "0 8px 6px 0", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap",
});
const tdStyle = (align) => ({
  textAlign: align, padding: "7px 8px 7px 0", borderBottom: "1px solid var(--border-default)", verticalAlign: "top",
});

function formatSf(sqft) {
  if (!sqft) return "—";
  return `${Math.round(sqft).toLocaleString()} SF`;
}

function NextCell({ next }) {
  if (!next) {
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>Nothing scheduled</div>
        <div style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>no date set</div>
      </div>
    );
  }
  const tone = nextLineTone(next.days);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{next.label}</div>
      <div style={{ fontSize: 10.5, fontWeight: tone === "muted" ? 500 : 700, color: TONE_COLOR[tone] }}>
        {formatShortDate(next.date)} - {next.days} {dayWord(next.days)}
      </div>
    </div>
  );
}

function QuietCell({ days }) {
  if (days == null) return <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>—</span>;
  const emphasized = isQuietEmphasized(days);
  return (
    <span style={{ fontSize: emphasized ? 13 : 12, fontWeight: emphasized ? 700 : 500, color: emphasized ? "var(--text-primary)" : "var(--text-secondary)" }}>
      {days} {dayWord(days)}
    </span>
  );
}

export function PursuitsCard({ rows, yieldBySite, onOpenProject }) {
  if (!rows || !rows.length) return <div style={EMPTY}>No open pursuits right now.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Pursuit</th>
            <th style={thStyle("right")}>Yield</th>
            <th style={thStyle("left")}>Next</th>
            <th style={thStyle("right")}>Quiet for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.groupId}
              onClick={() => onOpenProject?.(r)}
              role={onOpenProject ? "button" : undefined}
              tabIndex={onOpenProject ? 0 : undefined}
              onKeyDown={onOpenProject ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenProject(r); } } : undefined}
              style={{ cursor: onOpenProject ? "pointer" : "default" }}
            >
              <td style={tdStyle("left")}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{r.name}</div>
                {r.county && <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>{r.county}</div>}
              </td>
              <td style={{ ...tdStyle("right"), fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{formatSf(yieldBySite?.[r.siteId])}</td>
              <td style={tdStyle("left")}><NextCell next={r.next} /></td>
              <td style={{ ...tdStyle("right"), whiteSpace: "nowrap" }}><QuietCell days={r.quietDays} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
