/* ScheduleCrumb — the Row-1 breadcrumb's SECOND level for the Schedule tab.
 *
 * B1435888 ("Schedule access: project and schedule become two separate breadcrumb levels") —
 * owner-picked mockup "Option A". Before this, the breadcrumb was ONE control mixing every
 * project in the account with a small block of schedules at the bottom of the same dropdown —
 * projects and schedules in one flat list. This crumb is the fix: a SECOND, independent
 * breadcrumb segment, handed to the shared `ProjectBreadcrumb` as its `planSlot` (the exact
 * mechanism the Site Planner already uses for its own Project / Plan pair — see that
 * component's own header and `SitePlanner.jsx`'s `plannerPlanCrumb`). The header now reads
 * Dashboard / <Project> ▾ / <Schedule> ▾ — two independent switchers, never collapsed into one
 * even when the schedule happens to share the project's name (schedule id 1 is named "Goose
 * Creek" inside project "Goose Creek", and both levels render regardless).
 *
 * The dropdown itself is the EXISTING `ScheduleOwnerList` (B1396192/B1404352), grouped by the
 * already-shipped `partitionSchedules` ownership model (`scheduleOwnership.js`) — this file adds
 * no grouping logic of its own. It renders with `showOther={false}`: the breadcrumb is scoped to
 * THIS project's own schedules + the Organization, never every other project's schedules too.
 * (NEW-1 — the header's OWN "Schedules" toolbar panel, ScheduleSwitcher in ScheduleToolbar.jsx,
 * which used to keep the full three-group list including "Other projects", was REMOVED: this
 * crumb is now the only header entry point, and the full list — including other projects' own
 * schedules — is reachable by picking a different project crumb first.) The create row reads
 * "New schedule in <Project>" via `createLabel`, rather than the panel's generic "New schedule".
 *
 * Deliberately NOT rendered for the empty-state case as a separate code path — Scheduler.jsx
 * passes this exact same list whether the project owns zero, one, or many schedules of its own;
 * `ScheduleOwnerList`'s own per-group empty text ("No schedules here yet.") covers zero.
 */
import { useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { CRUMB_MIN_W } from "../../../shared/ui/ProjectBreadcrumb.jsx";
import ScheduleOwnerList from "./ScheduleOwnerList.jsx";

export default function ScheduleCrumb({
  schedules = [], activeId = null, siteId = null, siteName = null,
  // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — false until the schedule list has really arrived. Until then
  // the crumb offers nothing (no "No schedules here yet.", no New schedule): an unloaded list is not
  // an empty one. See navState.js scheduleListState.
  listLoaded = true,
  onSelect, onCreate, onRename, onDelete, onDuplicate,
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  // The schedule genuinely active in the embed right now — never a stand-in name, and never the
  // "Project / Schedule" merged label B1404352 used before this item: the project already has its
  // own crumb immediately to the left, so this one shows the bare schedule name only.
  const current = activeId != null ? (schedules.find((s) => s && s.id === activeId) || null) : null;
  const label = !listLoaded ? "Loading schedules…" : current ? (current.name || "Untitled schedule") : "Select a schedule";

  return (
    <div ref={anchorRef} style={{ position: "relative", flex: "0 1 auto", minWidth: 0 }}>
      {/* Same crumb geometry as ProjectBreadcrumb's own crumbBtn / SitePlanner's plan chip, so the
          two breadcrumb levels share one hit-target size and read as one connected control. */}
      <button
        data-testid="schedule-crumb"
        onClick={() => { if (listLoaded) setOpen((o) => !o); }}
        disabled={!listLoaded}
        title={listLoaded ? "Switch schedule" : "Your schedules haven’t loaded yet"}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 5, flex: "0 1 auto",
          height: 30, padding: "0 12px", borderRadius: RADIUS.md, border: "none",
          background: "transparent", cursor: "pointer", fontFamily: "inherit",
          fontSize: FONT_SIZE.control, fontWeight: 500, color: "var(--chrome-text)",
          maxWidth: 200, minWidth: CRUMB_MIN_W, whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span aria-hidden style={{ opacity: 0.6, fontSize: FONT_SIZE.label, flex: "none" }}>▾</span>
      </button>
      {/* No `panelStyle` override — AnchoredMenu's own default (`menuPanelStyle`, controls.jsx) is
          the shared token-driven surface every plain dropdown in this app already falls back to. */}
      <AnchoredMenu open={open && listLoaded} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" gap={8} width={284}>
        <ScheduleOwnerList
          schedules={schedules}
          activeId={activeId}
          siteId={siteId}
          siteName={siteName}
          onSelect={(id) => { setOpen(false); onSelect?.(id); }}
          onCreate={onCreate ? () => { setOpen(false); onCreate(); } : undefined}
          onRename={onRename}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          showOther={false}
          createLabel={siteName ? `New schedule in ${siteName}` : "New schedule"}
        />
      </AnchoredMenu>
    </div>
  );
}
