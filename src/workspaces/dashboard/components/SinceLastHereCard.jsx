/* SinceLastHereCard — "Since you were last here": one merged feed of everything that happened
 * across the account, so the owner stops reconstructing it from four separate cards
 * (B1366384, NEW-1). See lib/sinceLastHereFeed.js's header for what this is derived from and
 * why (no event log exists anywhere in this app).
 *
 * The sub-line is deliberately MONOSPACE — the one place on this dashboard that breaks from
 * `NUM_FONT`/tabular-nums (typography.js's rule for NUMBERS as product data). This isn't a number
 * column; it's a compact record line ("14 buildings · 412,000 SF", a quoted opening sentence), and
 * a fixed-width face is what makes a feed of very different substances read as one consistent
 * ledger rather than seven different sentence shapes. `ParcelDataPanel.jsx` already carries the
 * same local `MONO_FONT` constant for the same reason (genuinely record-like content) — this
 * mirrors it rather than reaching for a shared token that doesn't exist.
 */
import { RADIUS } from "../../../shared/ui/radius.js";
import { shortAge, dayKey, dayDividerLabel } from "../lib/dashboardDates.js";
import { KIND_META, compAddedSubline } from "../lib/sinceLastHereFeed.js";

const MONO_FONT = "ui-monospace, monospace";
const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };
const TILE_SIZE = 26;

function KindTile({ kind, glyph, accent }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none", width: TILE_SIZE, height: TILE_SIZE, borderRadius: RADIUS.md,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `var(--accent-${accent})`, color: `var(--on-accent-${accent})`,
        fontSize: 13, fontWeight: 700, lineHeight: 1,
      }}
      data-kind={kind}
    >
      {glyph}
    </span>
  );
}

function Sentence({ parts }) {
  return (
    <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
      {parts.map((p, i) => (p.bold ? <b key={i} style={{ fontWeight: 700 }}>{p.text}</b> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

function openTarget(row, handlers) {
  const o = row.open || {};
  if (o.kind === "project" && o.groupId) return () => handlers.onOpenProject?.({ groupId: o.groupId });
  if (o.kind === "task") return () => handlers.onOpenTask?.({ linkedSiteId: o.linkedSiteId, taskId: o.taskId });
  if (o.kind === "schedule") return () => handlers.onOpenSchedule?.({ linkedSiteId: o.linkedSiteId });
  if (o.kind === "comp") return () => handlers.onOpenComp?.(o.comp);
  if (o.kind === "note") return () => handlers.onOpenNote?.({ pageId: o.pageId, projectId: o.projectId, orgScope: o.orgScope });
  return null;
}

// A "comp-added" row's rate line is recomputed HERE, at render time, against the CURRENT
// `compsRatePeriod` — never trusted from the row's build-time `subline` — so flipping the Comps
// card's "per year / per month" toggle updates this feed in the same click, rather than leaving it
// on whatever period was current when the dashboard first loaded (sinceLastHereFeed.js's header,
// FEED-3). Every other kind's `subline` is fixed at build time and read as-is.
function feedRowSubline(row, compsRatePeriod) {
  if (row.kind === "comp-added" && row.open?.comp) return compAddedSubline(row.open.comp, compsRatePeriod);
  return row.subline;
}

function FeedRow({ row, now, handlers, compsRatePeriod }) {
  const meta = row.meta;
  const onOpen = openTarget(row, handlers);
  const subline = feedRowSubline(row, compsRatePeriod);
  return (
    <div
      onClick={onOpen || undefined}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", cursor: onOpen ? "pointer" : "default", borderRadius: RADIUS.sm }}
    >
      <KindTile kind={row.kind} glyph={meta.glyph} accent={meta.accent} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <Sentence parts={row.parts} />
        <div title={subline} style={{ marginTop: 2, fontFamily: MONO_FONT, fontSize: 10.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {subline}
        </div>
      </div>
      {/* A snapshot-diffed schedule row knows only the interval its change fell in, never the
          instant (sinceLastHereFeed.js's header). Its age is prefixed "~" and titled with the real
          bounds, so the card never asserts a precision the data does not have — one character and
          a hover, no added copy (PANEL-BREVITY). */}
      <span
        title={row.tsApprox ? `Sometime between ${new Date(row.tsEarliest).toLocaleString()} and ${new Date(row.tsLatest).toLocaleString()}` : undefined}
        style={{ flex: "none", fontSize: 10.5, color: "var(--text-secondary)", paddingTop: 2 }}
      >{row.tsApprox ? "~" : ""}{shortAge(row.ts, now)}</span>
    </div>
  );
}

/** Group rows into (dayKey, rows) buckets, in the rows' own (already-descending) order. A single
 * distinct day returns one group with no label — the card renders it as a flat list, per the
 * brief's "once the feed crosses a day boundary". */
function groupByDay(rows, now) {
  const order = [];
  const byKey = new Map();
  for (const r of rows) {
    const k = dayKey(r.ts);
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
    byKey.get(k).push(r);
  }
  return order.map((k) => ({ key: k, label: dayDividerLabel(byKey.get(k)[0].ts, now), rows: byKey.get(k) }));
}

export function SinceLastHereCard({ feed, now = Date.now(), compsRatePeriod, onOpenProject, onOpenTask, onOpenSchedule, onOpenComp, onOpenNote }) {
  if (!feed || !feed.rows || !feed.rows.length) {
    return <div style={EMPTY}>Nothing happened since your last visit.</div>;
  }
  const rows = feed.rows.map((r) => ({ ...r, meta: KIND_META[r.kind] }));
  const groups = groupByDay(rows, now);
  const showDividers = groups.length > 1;
  const handlers = { onOpenProject, onOpenTask, onOpenSchedule, onOpenComp, onOpenNote };

  return (
    <div>
      {groups.map((g) => (
        <div key={g.key}>
          {showDividers && (
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)", padding: "8px 0 2px" }}>
              {g.label}
            </div>
          )}
          {g.rows.map((row) => <FeedRow key={row.id} row={row} now={now} handlers={handlers} compsRatePeriod={compsRatePeriod} />)}
        </div>
      ))}
      {feed.overflowCount > 0 && (
        <div style={{ fontSize: 10.5, color: "var(--text-secondary)", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border-default)" }}>
          +{feed.overflowCount} more since your last visit
        </div>
      )}
    </div>
  );
}
