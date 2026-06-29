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
        title="Export — PDF exhibit or web snapshot" style={btn(open)}>
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

/* B565 — the floppy-disk SaveButton that used to live here was REMOVED. Save status now rides
 * in the shared, app-wide cloud badge (CloudSyncBadge) in AppHeader's Row-1 top-right zone, the
 * same place + component the Site Planner uses — so the indicator means the same thing across
 * every workspace. Scheduler.jsx maps the embedded app's reported saveStatus (saved/saving/error,
 * still emitted in planar:toolbar-state below) onto that badge via scheduleSaveState(); error-retry
 * is the badge's "Retry now" → planar:save. The "link a local backup file" affordance the floppy
 * also carried moved to the embedded app's Settings panel (reachable via the lifted ⚙), so nothing
 * was lost. The embedded app stays the single source of truth for the actual cloud writes. */

/* Center slot — the Grid/Split/Gantt view toggle + the review inbox (with its unread badge).
 * Always returns an element (never null) so AppHeader keeps its stable 3-zone Row-2 layout;
 * renders empty until the iframe reports state, or when not in Projects mode. */
export function ScheduleCenter({ toolbar, post }) {
  if (!toolbar.ready || toolbar.section !== "projects") return <></>;
  return (
    <>
      {!toolbar.reviewOpen && <ViewToggle view={toolbar.view} onSet={(v) => post({ type: "planar:view-set", view: v })} />}
      <button onClick={() => post({ type: "planar:review-toggle" })} aria-pressed={toolbar.reviewOpen}
        title="Review suggested updates from forwarded emails"
        style={btn(toolbar.reviewOpen || toolbar.reviewCount > 0)}>
        <Glyph size={15}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Glyph>
        {toolbar.reviewCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--on-accent)", background: ACCENT, borderRadius: 20, padding: "1px 7px", minWidth: 18, textAlign: "center", lineHeight: 1.5 }}>{toolbar.reviewCount}</span>
        )}
      </button>
    </>
  );
}

/* Right slot — zoom, export, save, then the panel toggles (history, contacts, automation,
 * format, settings). Mirrors the embedded app's gating: zoom only in split/gantt, format only
 * in Projects; the rest show in both Projects and Dashboard. Renders nothing until ready. */
export function ScheduleActions({ toolbar, post }) {
  if (!toolbar.ready) return null;
  const projects = toolbar.section === "projects";
  return (
    <>
      {toolbar.zoomable && (
        <div style={{ display: "flex", alignItems: "center", gap: 1, paddingRight: 7, marginRight: 1, borderRight: "1px solid var(--chrome-divider)" }}>
          <button title="Zoom out" aria-label="Zoom out" onClick={() => post({ type: "planar:zoom", dir: "out" })} style={{ ...btn(false), padding: "0 8px", fontSize: 15 }}>−</button>
          <span style={{ fontSize: 11, color: "var(--chrome-text)", width: 36, textAlign: "center", userSelect: "none" }}>{toolbar.zoomPct}%</span>
          <button title="Zoom in" aria-label="Zoom in" onClick={() => post({ type: "planar:zoom", dir: "in" })} style={{ ...btn(false), padding: "0 8px", fontSize: 15 }}>+</button>
        </div>
      )}
      <ExportMenu post={post} />
      <span style={{ width: 1, height: 20, background: "var(--chrome-divider)", flex: "none", margin: "0 2px" }} />
      <IconCmd title="Version history — browse & restore snapshots" cmd="planar:history" post={post} active={toolbar.activePanel === "history"}>
        <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /><polyline points="12 7 12 12 15 14" />
      </IconCmd>
      <IconCmd title="Contacts" cmd="planar:contacts" post={post} active={toolbar.activePanel === "contacts"}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </IconCmd>
      <button onClick={() => post({ type: "planar:automation" })} title="Automation rules" aria-pressed={toolbar.activePanel === "automation"} style={btn(toolbar.activePanel === "automation")}>
        <Glyph size={13}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Glyph>
        Automation
      </button>
      {projects && (
        <IconCmd title="Format — row height & bar labels" cmd="planar:format" post={post} active={toolbar.activePanel === "format"}>
          <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
        </IconCmd>
      )}
      <IconCmd title="Settings" cmd="planar:settings" post={post} active={toolbar.activePanel === "settings"}>
        <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" />
      </IconCmd>
    </>
  );
}
