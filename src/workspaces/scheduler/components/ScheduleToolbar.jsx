/* B388 — the Schedule action toolbar, LIFTED into the shared AppHeader.
 *
 * The Schedule workspace embeds the standalone Gantt app (public/sequence/index.html) in an
 * iframe. That app now HIDES its own in-embed toolbar (`.in-iframe .app-header`) and instead
 * reports its toolbar state up over the postMessage bridge (`planar:toolbar-state`); these
 * controls render that state in the shell's unified Row-2 header and post commands
 * (`planar:*`) back down. The iframe stays the SINGLE SOURCE OF TRUTH — the controls here
 * only DISPLAY reported state and post intent. They never fabricate a value: a count or a
 * zoom % is shown only once the iframe has reported it (toolbar.ready), and the unread badge
 * comes straight from the reported count (silence-is-a-crash, never a hardcoded number).
 *
 * Styling uses the shell's chrome theme tokens so the controls theme WITH the header
 * (light/dark), not the embedded app's own palette. Icons reuse the embedded app's glyphs
 * for visual continuity. Split across `toolbarCenter` (view + review) and `toolbarContent`
 * (actions) — the two slots AppHeader exposes (B387).
 */
import { useState, useRef } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import PriorityToolbar from "../../../shared/ui/PriorityToolbar.jsx";

const ACCENT = "var(--accent-schedule-text)";

// Shared chrome-toolbar button base. `active` = a toggle whose panel is open / a primed state.
function btn(active) {
  return {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    height: 26, padding: "0 9px", borderRadius: 7, cursor: "pointer", flex: "none",
    fontFamily: "inherit", fontSize: 12, fontWeight: 600, lineHeight: 1,
    border: `1px solid ${active ? ACCENT : "var(--chrome-divider)"}`,
    background: active ? "var(--hover-ghost)" : "var(--chrome-bg)",
    color: active ? ACCENT : "var(--chrome-text)",
    transition: "color .12s, border-color .12s, background .12s",
  };
}

const Glyph = ({ children, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "none" }}>
    {children}
  </svg>
);

// An icon-only command button (toggles a panel down in the iframe, or fires an action).
function IconCmd({ title, cmd, post, active = false, children }) {
  return (
    <button onClick={() => post({ type: cmd })} title={title} aria-label={title} aria-pressed={active} style={btn(active)}>
      <Glyph size={13}>{children}</Glyph>
    </button>
  );
}

// Grid / Split / Gantt segmented toggle — posts the chosen view; the iframe re-reports it.
function ViewToggle({ view, onSet }) {
  return (
    <div role="group" aria-label="View" style={{ display: "flex", background: "var(--chrome-bg)", border: "1px solid var(--chrome-divider)", borderRadius: 7, padding: 2, gap: 2 }}>
      {[["grid", "Grid"], ["split", "Split"], ["gantt", "Gantt"]].map(([v, label]) => {
        const on = view === v;
        return (
          <button key={v} onClick={() => onSet(v)} aria-pressed={on}
            style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: on ? 700 : 500,
              padding: "4px 11px", borderRadius: 5, background: on ? "var(--surface-raised)" : "transparent",
              color: on ? ACCENT : "var(--chrome-tab-inactive)", boxShadow: on ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
              transition: "color .12s, background .12s" }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MenuItem({ label, hint, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left",
      padding: "8px 9px", borderRadius: 7, border: "none", cursor: "pointer", background: "transparent", fontFamily: "inherit" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover-ghost)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{hint}</span>
    </button>
  );
}

// Export — a parent-side dropdown (the in-iframe one was anchored to its button); each item
// posts the chosen export; the iframe runs it (a centered modal for PDF, a download for HTML).
function ExportMenu({ post }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        title="Export — PDF exhibit or web snapshot" aria-label="Export" style={btn(open)}>
        <Glyph size={13}><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></Glyph>
        <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchor} placement="below-right" width={214} gap={8}
        panelStyle={{ padding: 6, borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)", fontFamily: "system-ui, sans-serif" }}>
        <MenuItem label="PDF / Print Exhibit" hint="Formatted pages — share or file" onClick={() => { post({ type: "planar:export", mode: "pdf" }); setOpen(false); }} />
        <MenuItem label="Web Snapshot" hint="Quick plain task tables · .html" onClick={() => { post({ type: "planar:export", mode: "html" }); setOpen(false); }} />
      </AnchoredMenu>
    </>
  );
}

/* B566 — the floppy-disk SaveButton that used to live here was REMOVED. Save status now rides
 * in the shared, app-wide cloud badge (CloudSyncBadge) in AppHeader's Row-1 top-right zone, the
 * same place + component the Site Planner uses — so the indicator means the same thing across
 * every workspace. Scheduler.jsx maps the embedded app's reported saveStatus (saved/saving/error,
 * still emitted in planar:toolbar-state below) onto that badge via scheduleSaveState(); error-retry
 * is the badge's "Retry now" → planar:save. The "link a local backup file" affordance the floppy
 * also carried moved to the embedded app's Settings panel (reachable via the lifted ⚙), so nothing
 * was lost. The embedded app stays the single source of truth for the actual cloud writes. */

/* Center slot — the Grid/Split/Gantt view toggle, and ONLY that.
 * Always returns an element (never null) so AppHeader keeps its stable 3-zone Row-2 layout;
 * renders empty until the iframe reports state, or when not in Projects mode.
 *
 * NEW-1 — the "Schedules" switcher button that used to open here (ScheduleSwitcher, B1396192) was
 * REMOVED: the Row-1 breadcrumb's second level (ScheduleCrumb, B1435888) now does that job in the
 * place the user already looks to see where they are — two controls for one job was the defect.
 * The old switcher could jump straight to another project's schedule in one step; the breadcrumb
 * takes two (pick the project, then the schedule) — an accepted trade-off, not something to solve
 * here. See NEW-1's own item for the full removal record.
 *
 * ⛔ B1547280 (AMENDMENT to B1511712) — THE REVIEW-INBOX BUTTON MOVED OUT OF THIS ZONE, INTO
 * `ScheduleActions` BELOW. It used to render here, beside the ViewToggle, as one combined flex
 * row — which meant AppHeader's Row-2 centering measured and positioned the COMBINED width of
 * BOTH controls as "the chip," not the Grid/Split/Gantt toggle alone. Owner-measured on his own
 * machine (215% browser zoom, ~1191 CSS px viewport): his own hand-measured "chip" was 157px wide
 * (exactly the ViewToggle's own rendered width) and sat 51px off the row's center; the CODE's
 * measured "chip" was actually 222px (ViewToggle + gap + the review button), which does not fit
 * the row's bound at that width — so centering correctly refused to engage for the 222px bundle,
 * while the owner was asking (and measuring) whether the 157px control alone was centered. Two
 * different things were being called "the chip." Root cause, not a tuning knob: `minGap`
 * (`CENTER_SLOT_GAP`, 12px) was never the problem — the CONTENT being measured was too wide by
 * construction. Moving the review button out of this zone makes "the chip" and "what gets
 * centered" the same element, with no change needed to AppHeader.jsx's centering math at all. */
export function ScheduleCenter({ toolbar, post }) {
  if (!toolbar.ready || toolbar.section !== "projects" || toolbar.reviewOpen) return <></>;
  return <ViewToggle view={toolbar.view} onSet={(v) => post({ type: "planar:view-set", view: v })} />;
}

/* Right slot — zoom, export, then the panel toggles (history, contacts, automation, format, settings).
 * Mirrors the embedded app's gating: zoom only in split/gantt, format only in Projects; the rest show in
 * both Projects and Dashboard. Renders nothing until ready.
 *
 * ⛔ NEW-2 (2026-10-05) — NOW A `PriorityToolbar` (shared/ui/PriorityToolbar.jsx). The owner's Schedule
 * header wrapped this whole cluster onto its own second row at a laptop window. As the room narrows it now
 * collapses instead: "Automation" drops to the bolt, then the lowest-priority items move into a "More" menu
 * (original order, full labels, the inbox count kept). It never wraps, never clips. PRIORITY (higher =
 * kept longest) — reorder here and nowhere else:
 *     Settings 90 · Review inbox 80 · Automation 75 · Version history 70 · Contacts 65 · Export 60 ·
 *     Format 40 · Zoom 20
 * The reserved-but-invisible idiom (NEW-1, B1218496 — a control that MOUNTS late shifts every sibling) is
 * kept as `ghost`: the item holds its place while unavailable, absent from the menu, and is the first thing
 * to give up its room. */
export function ScheduleActions({ toolbar, post }) {
  if (!toolbar.ready) return null;
  const projects = toolbar.section === "projects";
  const showIf = (available) => (toolbar.settled ? available : true);
  const items = [];
  if (showIf(projects)) {
    items.push({
      id: "inbox", label: "Review suggested updates", priority: 80, ghost: !projects, badge: toolbar.reviewCount, active: toolbar.reviewOpen,
      onSelect: () => post({ type: "planar:review-toggle" }),
      // ⛔ B1547280 — the review-inbox button lives HERE (not in ScheduleCenter) so the Row-2 centring measures
      // the Grid/Split/Gantt chip alone. The badge span is always mounted (visibility, never conditional) so a
      // count arriving late never shifts a sibling.
      render: () => (
        <button onClick={() => post({ type: "planar:review-toggle" })} aria-pressed={toolbar.reviewOpen}
          title="Review suggested updates from forwarded emails" aria-label="Review suggested updates from forwarded emails"
          style={{ ...btn(toolbar.reviewOpen || toolbar.reviewCount > 0), marginRight: 1 }}>
          <Glyph size={15}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Glyph>
          <span aria-hidden={!(toolbar.reviewCount > 0)} style={{
            fontSize: 11, fontWeight: 700, color: "var(--on-accent)", background: ACCENT, borderRadius: 20,
            padding: "1px 7px", minWidth: 18, textAlign: "center", lineHeight: 1.5,
            visibility: toolbar.reviewCount > 0 ? "visible" : "hidden",
          }}>{toolbar.reviewCount > 0 ? toolbar.reviewCount : 0}</span>
        </button>
      ),
    });
  }
  if (showIf(toolbar.zoomable)) {
    items.push({
      id: "zoom", label: "Zoom", priority: 20, ghost: !toolbar.zoomable, collapsible: true,
      menuRows: [
        { id: "zoom-out", label: `Zoom out (${toolbar.zoomPct}%)`, onSelect: () => post({ type: "planar:zoom", dir: "out" }) },
        { id: "zoom-in", label: "Zoom in", onSelect: () => post({ type: "planar:zoom", dir: "in" }) },
      ],
      render: () => (
        <div style={{ display: "flex", alignItems: "center", gap: 1, paddingRight: 7, marginRight: 1, borderRight: "1px solid var(--chrome-divider)" }}>
          <button title="Zoom out" aria-label="Zoom out" tabIndex={toolbar.zoomable ? 0 : -1} onClick={() => post({ type: "planar:zoom", dir: "out" })} style={{ ...btn(false), padding: "0 8px", fontSize: 15 }}>−</button>
          <span style={{ fontSize: 11, color: "var(--chrome-text)", width: 36, textAlign: "center", userSelect: "none" }}>{toolbar.zoomPct}%</span>
          <button title="Zoom in" aria-label="Zoom in" tabIndex={toolbar.zoomable ? 0 : -1} onClick={() => post({ type: "planar:zoom", dir: "in" })} style={{ ...btn(false), padding: "0 8px", fontSize: 15 }}>+</button>
        </div>
      ),
    });
  }
  items.push({
    id: "export", label: "Export", priority: 60,
    menuRows: [
      { id: "export-pdf", label: "Export · PDF / Print Exhibit", onSelect: () => post({ type: "planar:export", mode: "pdf" }) },
      { id: "export-html", label: "Export · Web Snapshot (.html)", onSelect: () => post({ type: "planar:export", mode: "html" }) },
    ],
    render: () => <ExportMenu post={post} />,
  });
  items.push({
    id: "history", label: "Version history", priority: 70, sepBefore: true, active: toolbar.activePanel === "history",
    onSelect: () => post({ type: "planar:history" }),
    render: () => (
      <>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: "var(--chrome-divider)", flex: "none", margin: "0 4px 0 2px" }} />
        <IconCmd title="Version history — browse & restore snapshots" cmd="planar:history" post={post} active={toolbar.activePanel === "history"}>
          <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /><polyline points="12 7 12 12 15 14" />
        </IconCmd>
      </>
    ),
  });
  items.push({
    id: "contacts", label: "Contacts", priority: 65, active: toolbar.activePanel === "contacts",
    onSelect: () => post({ type: "planar:contacts" }),
    render: () => (
      <IconCmd title="Contacts" cmd="planar:contacts" post={post} active={toolbar.activePanel === "contacts"}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </IconCmd>
    ),
  });
  items.push({
    id: "automation", label: "Automation rules", priority: 75, active: toolbar.activePanel === "automation",
    onSelect: () => post({ type: "planar:automation" }),
    render: ({ iconOnly }) => (
      <button onClick={() => post({ type: "planar:automation" })} title="Automation rules" aria-label={iconOnly ? "Automation rules" : undefined} aria-pressed={toolbar.activePanel === "automation"} style={btn(toolbar.activePanel === "automation")}>
        <Glyph size={13}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Glyph>
        {iconOnly ? null : "Automation"}
      </button>
    ),
  });
  if (showIf(projects)) {
    items.push({
      id: "format", label: "Format — row height & bar labels", priority: 40, ghost: !projects, active: toolbar.activePanel === "format",
      onSelect: () => post({ type: "planar:format" }),
      render: () => (
        <IconCmd title="Format — row height & bar labels" cmd="planar:format" post={post} active={toolbar.activePanel === "format"}>
          <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
        </IconCmd>
      ),
    });
  }
  items.push({
    id: "settings", label: "Settings", priority: 90, active: toolbar.activePanel === "settings",
    onSelect: () => post({ type: "planar:settings" }),
    render: () => (
      <IconCmd title="Settings" cmd="planar:settings" post={post} active={toolbar.activePanel === "settings"}>
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" />
      </IconCmd>
    ),
  });
  return <PriorityToolbar name="schedule-actions" items={items} moreLabel="More schedule actions" settled={!!toolbar.settled} />;
}
