/* DashboardCards — the six default Dashboard card renderers (B1213313, NEW-2). Each is a pure
 * presentational component: all the counting/grouping/sorting happens in lib/dashboardPipeline.js
 * / scheduleHealth.js before this ever renders, so these stay simple and token-only.
 */
import { RADIUS } from "../../../shared/ui/radius.js";
import { STATUS_TOKENS } from "../../../shared/ui/statusTokens.js";

const STATUS_LABEL = { pursuit: "Pursuit", active: "Active", onhold: "On hold", complete: "Complete", dead: "Dead" };
const STATUS_VAR = { pursuit: "var(--status-pursuit)", active: "var(--status-active)", onhold: "var(--status-onhold)", complete: "var(--status-complete)", dead: "var(--status-dead)" };

function relativeDays(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function StatusDot({ status, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: RADIUS.pill, background: STATUS_VAR[status] || "var(--text-secondary)", flex: "none", display: "inline-block" }} />;
}

// FONT_SIZE.display (14) is the largest role this app's type scale defines (designTokens.js) —
// there is no dedicated "hero number" size, so the headline stat leans on weight, not size.
const HEADLINE = { fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 };
const MUTED = { fontSize: 12, color: "var(--text-secondary)" };
const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };

function ClickableRow({ onClick, children }) {
  const interactive = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
        cursor: interactive ? "pointer" : "default",
        borderRadius: RADIUS.sm,
      }}
    >
      {children}
    </div>
  );
}

/* ── Loading skeleton (NEW-1) ──────────────────────────────────────────────────────────────────
 * Every card's real content is a different height depending on how many rows its data resolves
 * to (0 rows vs several) — rendering the SHORT "no data yet" message while a fetch is still in
 * flight, then swapping it for several real rows once the fetch resolves, grows the card and
 * shoves every card below it down the page. If a control in a lower card was already showing its
 * FINAL content and a user pressed it before that later growth landed, the press and the
 * click(that follows land on two different rows — the press's own target slid out from under it.
 * So the whole grid renders this identical, stable-height placeholder for every card until every
 * card's data source has resolved, and only then swaps every card to its real content in one
 * synchronized paint — nothing can grow later out from under an already-rendered row. */
const SKELETON_BAR = { height: 10, borderRadius: RADIUS.sm, background: "var(--border-default)", opacity: 0.6 };
export function CardSkeleton({ rows = 3 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ ...SKELETON_BAR, width: i === rows - 1 ? "55%" : "100%" }} />
      ))}
    </div>
  );
}

/* ── Jump back in ─────────────────────────────────────────────────────────────────────────── */
export function JumpBackInCard({ project, doc, onOpenProject, onOpenDoc }) {
  if (!project && !doc) return <div style={EMPTY}>Nothing to jump back into yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {project && (
        <ClickableRow onClick={() => onOpenProject?.(project)}>
          <StatusDot status={project.role === "tracked" ? null : project.status} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
            <div style={MUTED}>Last project · {relativeDays(project.updatedAt)}</div>
          </div>
        </ClickableRow>
      )}
      {doc && (
        <ClickableRow onClick={() => onOpenDoc?.(doc)}>
          <span aria-hidden="true" style={{ color: "var(--accent-review)", fontSize: 13, flex: "none" }}>▤</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
            <div style={MUTED}>Last document{doc.project ? ` · ${doc.project}` : ""} · {relativeDays(doc.updatedAt)}</div>
          </div>
        </ClickableRow>
      )}
    </div>
  );
}

/* ── Pipeline ──────────────────────────────────────────────────────────────────────────────── */
export function PipelineCard({ counts }) {
  const stages = ["pursuit", "active", "onhold", "complete", "dead"];
  const open = counts.pursuit + counts.active + counts.onhold;
  const total = stages.reduce((s, k) => s + counts[k], 0);
  if (!total && !counts.tracked) return <div style={EMPTY}>No projects yet.</div>;
  return (
    <div>
      <div style={HEADLINE}>{open}</div>
      <div style={{ ...MUTED, marginBottom: 10 }}>open pipeline</div>
      {total > 0 && (
        <div style={{ display: "flex", height: 7, borderRadius: RADIUS.pill, overflow: "hidden", marginBottom: 8 }}>
          {stages.map((k) => counts[k] > 0 && (
            <span key={k} style={{ flex: counts[k], background: STATUS_VAR[k] }} title={`${STATUS_LABEL[k]}: ${counts[k]}`} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {stages.filter((k) => counts[k] > 0).map((k) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-secondary)" }}>
            <StatusDot status={k} /> {STATUS_LABEL[k]} {counts[k]}
          </span>
        ))}
        {counts.tracked > 0 && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>· Tracked (market) {counts.tracked}</span>}
      </div>
    </div>
  );
}

/* ── Going quiet ──────────────────────────────────────────────────────────────────────────── */
export function GoingQuietCard({ rows, onOpenProject }) {
  if (!rows.length) return <div style={EMPTY}>Nothing's gone quiet — every open project has been touched recently.</div>;
  return (
    <div>
      {rows.map((p) => (
        <ClickableRow key={p.groupId} onClick={() => onOpenProject?.(p)}>
          <StatusDot status={p.status} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <span style={{ ...MUTED, flex: "none" }}>idle {p.idleDays}d</span>
        </ClickableRow>
      ))}
    </div>
  );
}

/* ── Comps ─────────────────────────────────────────────────────────────────────────────────── */
export function CompsSummaryCard({ counts }) {
  if (!counts || !counts.total) return <div style={EMPTY}>No comps recorded yet.</div>;
  return (
    <div>
      <div style={HEADLINE}>{counts.total}</div>
      <div style={{ ...MUTED, marginBottom: 8 }}>comps recorded</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12, color: "var(--text-secondary)" }}>
        {counts.land > 0 && <span>Land {counts.land}</span>}
        {counts.building_sale > 0 && <span>Building sale {counts.building_sale}</span>}
        {counts.lease > 0 && <span>Lease {counts.lease}</span>}
      </div>
    </div>
  );
}

/* ── Schedule health ──────────────────────────────────────────────────────────────────────── */
export function ScheduleHealthCard({ rows, onOpenSchedule }) {
  if (!rows.length) return <div style={EMPTY}>No schedules yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((p) => {
        const segs = [
          { n: p.complete, color: "var(--status-complete)" },
          { n: p.overdue, color: "var(--danger-text)" },
          { n: p.atRisk, color: "var(--warn-text)" },
          { n: p.onTrack, color: "var(--status-active)" },
        ].filter((s) => s.n > 0);
        const clickable = !!p.linkedSiteId;
        return (
          <div key={p.id ?? p.name}>
            <ClickableRow onClick={clickable ? () => onOpenSchedule?.(p) : undefined}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              <span style={MUTED}>{p.overdue > 0 ? `${p.overdue} overdue` : "on track"}</span>
            </ClickableRow>
            <div style={{ display: "flex", height: 6, borderRadius: RADIUS.pill, overflow: "hidden" }}>
              {segs.map((s, i) => <span key={i} style={{ flex: s.n, background: s.color }} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
