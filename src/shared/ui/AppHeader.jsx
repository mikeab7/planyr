/* AppHeader — shared two-row chrome for all workspaces.
 *
 * Row 1 (35px): logo + wordmark | divider | nav links
 *               || project name (center) ||
 *               cloud-sync badge | settings | auth control
 *
 * Row 2 (44px): module tabs (Site · Schedule · Review)
 *               | optional center slot (toolbarCenter, B387) |
 *               || toolbar slot (workspace-specific tools) ||
 * Row 2 is intentionally TALLER than Row 1 (B357): the tools row is where the work
 * happens, so it carries the visual weight; the nav row stays thin. Don't equalise them
 * — near-identical heights are what made "which row matters?" ambiguous.
 *
 * Props
 *   module        — active workspace id ('site-planner' | 'scheduler' | 'doc-review')
 *   onSwitch      — (id) => void  — switch to another module
 *   onDashboard   — () => void    — "Dashboard" / "Projects" nav links
 *   centerContent — ReactNode     — project name + chevron dropdown (workspace provides)
 *   saveState     — normalized save/sync state — drives the shared CloudSyncBadge (NEW-1)
 *   onRetrySave   — () => void     — optional; the badge's error popover offers "Retry now"
 *   saveDetail    — string         — optional; overrides the badge popover's default explanation
 *   saveSlot      — ReactNode      — optional extra Row-1 content (legacy slot; the save badge
 *                                    is now the shared CloudSyncBadge driven by saveState)
 *   authControl   — ReactNode     — user avatar or sign-in button (Shell provides)
 *   toolbarContent — ReactNode    — module-specific toolbar buttons (workspace provides)
 *   toolbarCenter  — ReactNode    — optional Row-2 center group (B387); present ⇒ Row 2 is a
 *                                    3-zone tabs|center|toolbar layout (center optically centered
 *                                    like Row 1). Absent (Site/Review) ⇒ unchanged 2-zone layout.
 *
 * Fullscreen (NEW-1): F asks the browser for REAL fullscreen — the Fullscreen API on
 * document.documentElement — and hides the header on top of it, so the workspace fills the
 * screen edge to edge with no tab strip, no address bar and no OS taskbar. The document ROOT
 * is deliberately the target: fullscreening a subtree would hide every position:fixed overlay
 * that lives outside it, the exit button included. Where the request is refused or the API is
 * absent (iOS Safari has no fullscreen for non-video elements) it falls back to the previous
 * behaviour — hiding the header alone — rather than doing nothing. The header is driven FROM
 * the document's real fullscreen state via `fullscreenchange`, so Esc, F11 or the browser's own
 * exit affordance can never leave the two disagreeing. Esc (or the exit button) restores it.
 * When hidden the workspace's flex: 1 content fills 100 % of viewport height.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ProjectBreadcrumb from "./ProjectBreadcrumb.jsx";
import CloudSyncBadge from "./CloudSyncBadge.jsx";
import AnchoredMenu from "./AnchoredMenu.jsx";
import { createMultiTabPresence } from "../presence/multiTab.js";
import BrandMark from "../brand/BrandMark.jsx";
import { prefetchModule } from "../../app/modulePrefetch.js";
import { MODULE_ACCENT } from "./moduleAccent.js";
import { useTheme } from "../theme/ThemeProvider.jsx";
import ThemePicker from "../theme/ThemePicker.jsx";

// Chrome colors are theme tokens (var(--chrome-*)) so the header themes WITH the app
// (B318): light theme = light chrome, dark theme = dark chrome.
const CHROME = "var(--chrome-bg-elev)";
const LINE   = "var(--chrome-divider)";

/* NEW-1 — the fullscreen top-edge reveal, tuned so it can't be triggered by accident.
 * ARM on the pointer genuinely REACHING the top edge, not merely being in the upper region — the
 * top row of the screen is a place you only get to deliberately (it is also where the OS parks the
 * pointer on an overshoot, which is why the intent delay exists). HOLD the reveal for a moment
 * after the pointer leaves so a hand travelling to a tab or the switcher never races it. */
const FS_EDGE_PX = 3;        // how close to the very top edge the pointer must come to arm
const FS_ARM_MS = 220;       // intent delay: a fast cursor crossing the top must not flash it open
const FS_HIDE_MS = 400;      // grace before it slides away once the pointer has genuinely left
const FS_HOLD_PX = 60;       // band below the header that still counts as "on it" (covers the exit button)
// Inactive module tabs: full-opacity, muted-but-legible (meets WCAG AA on the chrome).
// NOT a low-opacity/disabled treatment — inactive must read as clearly clickable. (B167)
const TAB_IDLE = "var(--chrome-tab-inactive)";
// Per-module accent: the FILL (the 2px underline) is fixed in both themes; the active
// tab TEXT uses the -text token, which swaps by theme (sits on chrome). (B318)
const ACCENT_FILL = { "site-planner": "var(--accent-site)", "scheduler": "var(--accent-schedule)", "doc-review": "var(--accent-review)", "library": "var(--accent-library)", "notes": "var(--accent-notes)" };
const ACCENT_TEXT = { "site-planner": "var(--accent-site-text)", "scheduler": "var(--accent-schedule-text)", "doc-review": "var(--accent-review-text)", "library": "var(--accent-library-text)", "notes": "var(--accent-notes-text)" };

// The Light/Dark/System picker now lives in the account → Settings panel (B389, AuthPanel)
// for signed-in users. The row-1 gear below is kept ONLY when signed out, so a logged-out
// visitor can still switch (preserves B342's "reachable signed-out" without duplicating the
// control when signed in). The picker UI itself is the shared <ThemePicker/>. (B317/B342/B389)
const settingsPanel = {
  padding: 6, borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};

/* Settings gear (row-1 right zone) → popover hosting the display-theme picker and the on-device
 * storage readout. Rendered only when signed OUT (B389): signed-in users get both controls in
 * account → Settings, so the gear isn't duplicated; signed out, this keeps them one click away.
 * (B342/B389; storage added NEW-3/B1429 — a signed-out user shares the same ~5 MB ceiling and
 * has no cloud copy to fall back on, so they need the number more, not less.)
 * The panel is LAZY so its census + byte formatting never ride the entry chunk. */
const StoragePanel = lazy(() => import("../storage/StoragePanel.jsx"));
function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings: display theme and device storage"
        style={{
          display: "grid", placeItems: "center", width: 30, height: 26, borderRadius: 7,
          border: `1px solid ${LINE}`, background: "var(--chrome-bg)", color: "var(--chrome-text)",
          cursor: "pointer", flex: "none",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchor}
        placement="below-right" width={264} gap={8} panelStyle={settingsPanel}>
        <ThemePicker />
        <div style={{ height: 1, background: LINE, margin: "12px 0 10px" }} />
        <Suspense fallback={<div style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>Checking storage…</div>}>
          {open && <StoragePanel />}
        </Suspense>
      </AnchoredMenu>
    </>
  );
}

// Re-exported from the pure accent module (single source of truth) so existing
// `import { MODULE_ACCENT } from "./AppHeader.jsx"` consumers keep working.
export { MODULE_ACCENT };

// Module tab definitions — label + inline SVG icon path group
const MODULES = [
  {
    id: "site-planner",
    label: "Site",
    // simplified ti-map-2 outline (16×16 viewBox)
    icon: (
      <>
        <path d="M3 6.5l5-2.5 5 2.5-1 8-4-2.5-4 2.5z" />
        <line x1="8" y1="4" x2="8" y2="12.5" />
        <line x1="3" y1="6.5" x2="3" y2="14.5" />
      </>
    ),
  },
  {
    id: "scheduler",
    label: "Schedule",
    // simplified ti-calendar outline
    icon: (
      <>
        <rect x="2.5" y="4.5" width="11" height="9.5" rx="1.5" />
        <line x1="2.5" y1="7.5" x2="13.5" y2="7.5" />
        <line x1="6" y1="2.5" x2="6" y2="5.5" />
        <line x1="10" y1="2.5" x2="10" y2="5.5" />
      </>
    ),
  },
  {
    id: "doc-review",
    label: "Review",
    // simplified ti-pencil outline
    icon: (
      <>
        <path d="M3.5 12.5l7-7 3 3-7 7H3.5v-3z" />
        <line x1="9.5" y1="6.5" x2="11.5" y2="8.5" />
      </>
    ),
  },
  {
    id: "library",
    label: "Library",
    // simplified ti-folders / stacked-files outline (16×16 viewBox)
    icon: (
      <>
        <path d="M2.5 5.5l2-1.5h3l1 1.5h4.5v7.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1z" />
        <line x1="2.5" y1="8" x2="13.5" y2="8" />
      </>
    ),
  },
  {
    id: "notes",
    label: "Notes",
    // simplified ti-notebook outline (16×16 viewBox) — a bound book with ruled lines
    icon: (
      <>
        <path d="M4.5 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8z" />
        <line x1="4.5" y1="2.5" x2="4.5" y2="13.5" />
        <line x1="2.5" y1="5" x2="4.5" y2="5" />
        <line x1="2.5" y1="11" x2="4.5" y2="11" />
        <line x1="7" y1="6" x2="11" y2="6" />
        <line x1="7" y1="9" x2="11" y2="9" />
      </>
    ),
  },
];

// One module tab. Inactive tabs are full-opacity and legible (never dimmed/disabled);
// the module accent reveals on hover, and the active tab keeps the accent + a 2px
// underline indicator. Icons are crisp SVG at a fixed 13px (no bitmap scaling). (B167)
function ModuleTab({ m, isActive, onClick }) {
  const [hover, setHover] = useState(false);
  const fill = ACCENT_FILL[m.id] || "var(--accent)";
  const textCol = ACCENT_TEXT[m.id] || "var(--accent)";
  return (
    <button
      onClick={onClick}
      data-testid={`module-tab-${m.id}`}
      // Hover = nav intent: warm the target workspace's chunk (and Schedule's
      // iframe doc) so the click loads from cache. Idempotent + best-effort. (B223)
      // Since NEW-9 removed the boot-time idle warm, these gestures are the ONLY
      // thing that warms a workspace — so cover the touch path too: a tap fires
      // pointerdown with no preceding mouseenter, and pointerdown lands before the
      // click commits, which is enough of a head start to hide the chunk fetch.
      onMouseEnter={() => { setHover(true); if (!isActive) prefetchModule(m.id); }}
      onPointerDown={() => { if (!isActive) prefetchModule(m.id); }}
      onMouseLeave={() => setHover(false)}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        height: "100%", padding: "0 13px",
        border: "none",
        borderBottom: `2px solid ${isActive ? fill : "transparent"}`,
        background: "transparent",
        color: isActive || hover ? textCol : TAB_IDLE,
        fontFamily: "inherit", fontSize: 12.5,
        fontWeight: isActive ? 600 : 500,
        cursor: "pointer", whiteSpace: "nowrap",
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      <svg
        width="13" height="13" viewBox="0 0 16 16"
        fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
        style={{ flex: "none", display: "block", shapeRendering: "geometricPrecision" }}
      >
        {m.icon}
      </svg>
      {m.label}
    </button>
  );
}

// B313 — track whether the same project is open in another same-browser tab (BroadcastChannel),
// so the header can warn that editing in two tabs can conflict. Degrades to "no peers" where
// BroadcastChannel is unavailable. Cross-device conflicts are caught server-side by B314.
function useMultiTab(projectId) {
  const [state, setState] = useState({ otherCount: 0, sameProjectTabs: 0, conflictRisk: false });
  const ref = useRef(null);
  useEffect(() => {
    const p = createMultiTabPresence({ project: projectId });
    ref.current = p;
    p.onChange(setState);
    p.start();
    const bye = () => p.stop();
    window.addEventListener("pagehide", bye); // 'bye' so other tabs clear promptly on close
    return () => { window.removeEventListener("pagehide", bye); p.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (ref.current) ref.current.setProject(projectId); }, [projectId]); // keep presence in sync as the project changes
  return state;
}

// Phone-width gate (B113 amendment, V11). Mirrors the planner's own `narrow` breakpoint
// (max-width 760px) so the shared header and the planner body flip to mobile together.
// On a phone the two-row header overran 390px and CLIPPED its controls (the project/plan
// switcher, the save badge, and the whole Row-2 toolbar — only "…cels" + "File ▾" survived):
// the flex zones compressed to slivers under `overflow:hidden`, hiding reachable controls.
// Below the breakpoint we let each row SCROLL SIDEWAYS instead (the owner's explicit ask:
// "scroll sideways, not wrap onto two lines"), so nothing is lost — you swipe to reach it.
function useNarrow() {
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia("(max-width: 760px)").matches; } catch (_) { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(max-width: 760px)"); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  return narrow;
}

/* ── NEW-1 — the Fullscreen API, wrapped so the component never touches a vendor prefix ────────
 * Every one of these is a pure DOM accessor with no React in it, so they live at module scope
 * and are trivially readable from a headless check. `fsElement()` is the single source of truth
 * for "is the browser ACTUALLY in fullscreen" — the header state is derived from it, never the
 * other way round. WebKit keeps its prefixed spelling on older iPad/Safari builds, and the
 * prefixed API predates promises, hence the Promise.resolve() wrapping. */
export function fsElement() {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
export function fsSupported() {
  if (typeof document === "undefined") return false;
  const el = document.documentElement;
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}
/* Ask for fullscreen on the document ROOT. Resolves when the browser granted it; REJECTS when it
 * refused (no user activation, a permissions policy, an iframe without allow="fullscreen") or
 * when the API is absent — the caller falls back to hiding the header alone. */
export function requestFs() {
  const el = typeof document !== "undefined" ? document.documentElement : null;
  const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!req) return Promise.reject(new Error("fullscreen-unsupported"));
  try { return Promise.resolve(req.call(el)); } catch (err) { return Promise.reject(err); }
}
export function exitFs() {
  if (typeof document === "undefined" || !fsElement()) return Promise.resolve();
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (!ex) return Promise.resolve();
  try { return Promise.resolve(ex.call(document)).catch(() => {}); } catch (_) { return Promise.resolve(); }
}

export default function AppHeader({
  module = "site-planner",
  onSwitch,
  onDashboard,
  centerContent,
  saveSlot,
  // B674 — the caller supports concurrent editing (per-element sync + multi-writer, OR its own
  // safe multi-tab convergence), so the B313 "only one tab can edit" warning is FALSE for it and
  // must not show. Default false: every other workspace (doc-review) keeps the warning until it,
  // too, is safe for two tabs. B850 (2026-07-15, AUDIT-FIRST) — the Scheduler was found to already
  // BE safe (see Scheduler.jsx's comment: version-guarded saves + a 20s/on-focus live-refresh poll
  // that blocks-never-overwrites a stale write and prompts a one-click reload), so it now passes
  // this instead of getting its own banner copy — the embedded app's own precise, in-context
  // "a newer version was saved" notice already covers the one case that matters.
  multiEditOk = false,
  authControl,
  toolbarContent,
  // Optional Row-2 center group (B387). When provided, Row 2 renders a 3-zone layout
  // (tabs | center | toolbar) with the center group optically centered like Row 1.
  // Generic + additive: callers that omit it (Site, Review) keep the 2-zone layout
  // unchanged. Its first consumer is the Schedule toolbar lift (B388).
  toolbarCenter,
  // Project breadcrumb / switcher (B191–B193). When onSelectProject is provided the
  // breadcrumb renders right of the logo; workspaces that don't wire it (none, now)
  // simply omit it and the left zone stays logo-only.
  currentProject = null,
  onSelectProject,
  onNewProject,
  // Optional trailing breadcrumb crumb rendered right after the project crumb (e.g. the
  // Site Planner's plan switcher). Keeps the project name in ONE place — the breadcrumb —
  // while a workspace-specific sub-selector (the plan) sits beside it: Map / Project / Plan.
  planSlot,
  saveState,
  // Cloud-sync badge (NEW-1): the workspace hands the badge an optional retry action and a
  // custom popover message (e.g. "reload to merge" for a conflict). Both are optional — the
  // badge falls back to a sensible per-state explanation when they're omitted.
  onRetrySave,
  saveDetail,
  // Optional: a workspace-supplied project list (B203 — Schedule feeds in its embedded
  // scheduler's own projects) and a home-crumb label override (B204 — Site → "Map").
  projects,
  homeLabel,
  // Cross-project mode (Work Item A) — the breadcrumb reads "All projects" when on.
  cross = false,
  // Rename / delete project actions (B439/B440). When omitted the breadcrumb uses the
  // uncontrolled Site-store path. When provided (Schedule bridge) the breadcrumb
  // posts the command to the embedded app instead.
  onRenameProject,
  onDeleteProject,
  // Whether a real account is signed in. The same-project-in-another-tab warning
  // (B313) only applies to signed-in accounts: a logged-out, device-only session
  // starts fresh and should never see the cross-tab conflict banner — it protects
  // saved cloud work, not anonymous local browsing (which was falsely nagging on
  // mobile). Defaults off so any unwired caller stays silent.
  accountActive = false,
}) {
  // `fullscreen` means "the header is collapsed and the workspace owns the whole viewport". It is
  // true in BOTH modes: real browser fullscreen (the normal case) and the chrome-hide fallback.
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false); fullscreenRef.current = fullscreen; // live value for the once-bound key handler
  // NEW-1 — true only while the BROWSER is really in fullscreen. It decides who owns the exit:
  // the Fullscreen API (and the fullscreenchange that follows) vs. plain React state.
  const nativeFsRef = useRef(false);
  const headerRef = useRef(null); // visibility probe for the keep-alive gate below
  /* NEW-1 (2026-07-30) — the KEEP-ALIVE probe, and why it is `getClientRects()` and not
     `offsetParent`. Workspaces are kept mounted-but-hidden (`display:none`), so every workspace's
     header hears the same window/document events; only the one actually on screen may act. That
     gate used to read `offsetParent === null`, which needed a `!fullscreen` exception bolted on
     because a position:fixed element ALWAYS reports a null offsetParent — and the header is now
     position:fixed for the whole time it is fullscreen, not just while collapsed. `getClientRects()`
     tells the two cases apart directly: a `display:none` ancestor generates no boxes at all (empty
     list), while a fixed header merely translated off the top edge still has its box. One rule,
     no fullscreen exception — which is the hazard #869's own harness caught (two workspaces both
     answering one `fullscreenchange` and each drawing its own exit button). */
  const headerOnScreen = () => !!(headerRef.current && headerRef.current.getClientRects().length);
  /* NEW-1 — TOP-EDGE REVEAL. `f` is a real mode people stay in, so fullscreen can no longer be a
     dead end: the WHOLE header (breadcrumb, project + plan switcher, module tabs, toolbar) slides
     down when the pointer reaches the very top edge, and slides away again when it leaves. The
     canvas stays edge-to-edge while working because the header is out of flow the entire time. */
  const [fsReveal, setFsReveal] = useState(false);
  const fsRevealRef = useRef(false); fsRevealRef.current = fsReveal;
  const { resolved } = useTheme();
  const multiTab = useMultiTab(accountActive && currentProject && !multiEditOk ? currentProject.id : null); // B313 — same-project-in-another-tab warning (signed-in only; suppressed when the workspace multi-writes, B674)
  // NEW-1 (2026-07-15) — the banner is dismissible (a small ×), unlike before. `dismissed` resets
  // on the RISING edge of conflictRisk (false→true) so a closed banner reappears for a genuinely
  // NEW another-tab episode (e.g. you closed the other tab, then opened a fresh one later) instead
  // of staying silenced forever after the first dismiss.
  const [multiTabDismissed, setMultiTabDismissed] = useState(false);
  const prevConflictRiskRef = useRef(false);
  useEffect(() => {
    if (multiTab.conflictRisk && !prevConflictRiskRef.current) setMultiTabDismissed(false);
    prevConflictRiskRef.current = multiTab.conflictRisk;
  }, [multiTab.conflictRisk]);
  const narrow = useNarrow(); // V11 — phone-width header: scroll each row sideways instead of clipping its controls
  // On a phone, let a header row scroll horizontally and keep its zones at natural width
  // (no flex-shrink → no clipped slivers). On desktop these are no-ops, so the layout is
  // byte-identical above the breakpoint.
  const rowScroll = narrow ? { overflowX: "auto", overflowY: "hidden" } : null;
  const zoneFixed = narrow ? { flex: "0 0 auto" } : null; // don't let a zone compress its content away

  /* NEW-1 — leave fullscreen. Native mode hands the job to the browser and lets the resulting
     `fullscreenchange` restore the header; fallback mode (the request was refused, or there is
     no API) never entered browser fullscreen, so it just puts the chrome back. */
  const leaveFullscreen = () => {
    if (nativeFsRef.current) { exitFs(); return; }
    setFullscreen(false);
  };
  /* NEW-1 — enter/leave. The keypress IS the user activation the Fullscreen API requires, so the
     request is made straight out of the key handler, not deferred. `requestFs()` returns a promise
     that CAN reject (refused, or unsupported — iOS Safari has no fullscreen for a non-video
     element): on rejection we still hide the header, which is exactly the behaviour this shortcut
     had before, rather than the keypress appearing to do nothing. */
  const toggleFullscreen = () => {
    if (fullscreenRef.current) { leaveFullscreen(); return; }
    requestFs().catch(() => { nativeFsRef.current = false; setFullscreen(true); });
    // On success the header is hidden by the fullscreenchange handler below, not from here —
    // one owner for the state, so entering can't race the event that reports it.
  };
  const toggleRef = useRef(toggleFullscreen); toggleRef.current = toggleFullscreen;

  /* NEW-1 — the header follows the DOCUMENT, never a guess. Whatever ends fullscreen — Esc, the
     browser's own exit affordance, another script — arrives here, so the chrome comes back with
     it and the two can never desync. The `nativeFsRef` guard means a fullscreenchange we did not
     cause (a <video> elsewhere on the page exiting) can't yank the header out of fallback mode. */
  useEffect(() => {
    const onChange = () => {
      if (fsElement()) {
        // The SAME keep-alive gate the shortcut uses, and for the same reason: with workspaces
        // kept mounted-but-hidden, EVERY workspace's header hears this document-level event. Left
        // ungated, all of them collapse and each renders its own floating exit button — caught by
        // ui-audit/verify-new1-fullscreen.mjs, which found two stacked. Only the header that is
        // actually on screen may take it. (NEW-1 2026-07-30: the probe is `headerOnScreen()` —
        // rect-based — because the header is position:fixed for the whole fullscreen session now,
        // and `offsetParent` is null for any fixed element. See the probe's own note.)
        if (!headerOnScreen()) return;
        nativeFsRef.current = true; setFullscreen(true);
      } else if (nativeFsRef.current) { nativeFsRef.current = false; setFullscreen(false); }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  useEffect(() => {
    const handle = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;
      // Keep-alive gate: with workspaces kept mounted-but-hidden, EVERY workspace's header has this
      // window listener. A hidden header (a `display:none` ancestor ⇒ no client rects) must ignore
      // the shortcut, or one keypress toggles fullscreen in all of them. NEW-1 (2026-07-30) — this
      // used to carry a `!fullscreenRef.current` exception, because the collapsed header rendered
      // only a position:fixed button and `offsetParent` is null for fixed elements. The header is
      // now fixed for the whole fullscreen session, so the exception would have swallowed `f` (no
      // way back out) — `headerOnScreen()` needs no exception and is checked unconditionally.
      if (!headerOnScreen()) return;
      if (e.key === "f" || e.key === "F") toggleRef.current();
      // NEW-1 — do NOT fight Esc. In real fullscreen the browser consumes it and exits on its own;
      // `fullscreenchange` then restores the header. Acting here as well would be a second toggle
      // over the top of that. Esc only does the work in the chrome-hide fallback, where nothing
      // else is going to.
      if (e.key === "Escape" && !nativeFsRef.current) setFullscreen(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  /* NEW-1 — drive the top-edge reveal. Bound ONLY while this header is the fullscreen one, and
     every evaluation re-checks `headerOnScreen()`, so a hidden workspace's header can never reveal
     itself (the same hazard the shortcut and the fullscreenchange handler are gated for).

     Two guarantees the owner asked for by name:
       · it arms on the pointer REACHING the top edge (within FS_EDGE_PX), never on being merely
         "up there", and only after FS_ARM_MS of intent — so a cursor flicking across the top on its
         way somewhere else never flashes the chrome open;
       · it does NOT hide while you are reaching for what it revealed. Three things hold it open:
         the pointer being on the header (or in the band just under it, where the exit button
         lives), a dropdown opened FROM the header still being on screen (`data-menu-owner`, since
         AnchoredMenu portals its panel to <body> and so leaves the header's subtree), and keyboard
         focus living inside it. The hold conditions are re-checked when the hide timer FIRES, not
         only when it is set, so opening a menu during the grace period cancels the hide. */
  useEffect(() => {
    if (!fullscreen) { setFsReveal(false); return undefined; }
    let timer = 0;
    const clearT = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    const holdOpen = () => {
      const el = headerRef.current;
      if (!el) return false;
      if (document.querySelector('[data-menu-owner="app-header"]')) return true;
      return el.contains(document.activeElement);
    };
    const onMove = (e) => {
      if (!headerOnScreen()) return;
      if (fsRevealRef.current) {
        const r = headerRef.current.getBoundingClientRect();
        if (e.clientY <= r.bottom + FS_HOLD_PX || holdOpen()) { clearT(); return; }
        if (!timer) timer = setTimeout(() => { timer = 0; if (!holdOpen()) setFsReveal(false); }, FS_HIDE_MS);
        return;
      }
      if (e.clientY > FS_EDGE_PX) { clearT(); return; }
      if (!timer) timer = setTimeout(() => { timer = 0; if (headerOnScreen()) setFsReveal(true); }, FS_ARM_MS);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); clearT(); };
  }, [fullscreen]);

  /* NEW-1 — HAND THE FULLSCREEN MODE OVER when the workspace changes. Making the module tabs
     reachable from inside fullscreen creates a case that could not arise before, because you could
     not switch workspaces at all: every workspace owns its own AppHeader, and the incoming one was
     `display:none` when `f` was pressed, so the keep-alive gate correctly kept it out of the
     `fullscreenchange` — leaving it convinced it was NOT fullscreen while the document still was.
     That would strand you in browser fullscreen behind an ordinary in-flow header, with no exit
     button and `f` DEAD (requesting fullscreen on an already-fullscreen document resolves without
     firing another `fullscreenchange`, so nothing would answer the key). The outgoing header has
     the mirror problem: left claiming fullscreen it renders a second, invisible exit button — the
     exact "two stacked" defect the #869 harness exists to catch.

     A ResizeObserver is the signal, because becoming visible changes no prop and fires no event:
     toggling a `display:none` ancestor takes the header from no box at all to a real one. */
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (!headerOnScreen()) {
        if (fullscreenRef.current) { nativeFsRef.current = false; setFullscreen(false); } // relinquish on the way out
        return;
      }
      const real = !!fsElement();
      // Adopt the DOCUMENT's truth on the way in. The `nativeFsRef` half of the condition protects
      // the chrome-hide fallback (where `fsElement()` is legitimately null while fullscreen is on)
      // from being cancelled by its own arrival.
      if (real !== fullscreenRef.current && (real || nativeFsRef.current)) { nativeFsRef.current = real; setFullscreen(real); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The breadcrumb uses `accent` as foreground TEXT ("current" / "New project"), so it
  // must be the AA-passing -text token, never the fill (fill-as-text = 3.4:1, B341/B318).
  const accent = ACCENT_TEXT[module] || "var(--accent)";

  /* NEW-1 — the exit affordance. It is a CHILD of the <header>, absolutely positioned just below
     it, so it rides the same slide transform and needs no measurement of the header's height:
     while the header sits at translateY(-100%) the button lands at exactly the top-right corner it
     has always occupied, and when the header slides in the button rides down to sit under it —
     never overlapping the chrome, never a second thing to keep in sync. `pointerEvents: "auto"`
     overrides the header's own `none` so it stays clickable the whole time the chrome is hidden. */
  const exitFullscreenBtn = fullscreen ? (
    <button
      onClick={leaveFullscreen}
      data-testid="exit-fullscreen"
      title="Exit fullscreen (Esc)"
      style={{
        position: "absolute", top: "100%", right: 12, marginTop: 10, zIndex: 1,
        pointerEvents: "auto",
        padding: "5px 12px", borderRadius: 8,
        background: "rgba(20,17,14,0.72)", color: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(255,255,255,0.18)",
        cursor: "pointer", fontFamily: "system-ui, sans-serif",
        fontSize: 11.5, fontWeight: 600,
      }}
    >
      ✕ Exit fullscreen
    </button>
  ) : null;

  // Module tabs — shared by both Row-2 layouts (with and without the B387 center slot)
  // so the per-tab wiring is defined once.
  const moduleTabButtons = MODULES.map((m) => (
    <ModuleTab key={m.id} m={m} isActive={m.id === module} onClick={() => onSwitch && onSwitch(m.id)} />
  ));

  return (
    <>
    <header
      ref={headerRef}
      /* NEW-1 — the scope marker AnchoredMenu stamps onto its portalled panels, so the reveal can
         tell "my own dropdown is open" from "nothing is open" (a portal leaves this subtree). */
      data-menu-scope="app-header"
      style={{
        flex: "none",
        background: CHROME,
        borderBottom: `1px solid ${LINE}`,
        /* NEW-1 — in fullscreen the header leaves the flow entirely and becomes a slide-in panel
           pinned to the top edge, so the workspace canvas keeps the WHOLE viewport while you work
           and the chrome costs nothing until you ask for it. `translateY(-100%)` is relative to the
           header's own height, so nothing needs measuring and the two rows can change height freely.
           `pointerEvents: none` while hidden is the belt to the transform's braces: even mid-
           transition the header can never swallow a click meant for the canvas underneath. Out of
           fullscreen this is byte-identical to what it always was. */
        ...(fullscreen
          ? {
              position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998,
              transform: fsReveal ? "translateY(0)" : "translateY(-100%)",
              transition: "transform 170ms cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: fsReveal ? "auto" : "none",
              boxShadow: fsReveal ? "0 6px 20px rgba(0,0,0,0.28)" : "none",
              willChange: "transform",
            }
          : { position: "relative", zIndex: 60 }),
      }}
      data-fs-reveal={fullscreen ? (fsReveal ? "shown" : "hidden") : undefined}
    >
      {exitFullscreenBtn}
      {/* ── Row 1 — 35px (−20% from 44 per B169; contents stay vertically centered) ── */}
      <div className={narrow ? "no-hscrollbar" : undefined} style={{ height: 35, display: "flex", alignItems: "center", ...rowScroll }}>

        {/* Left zone. Desktop: clip overflow so a long breadcrumb (project + plan) can never
            paint OVER the centered badge — the "text overlaps and looks like shit" bug the owner
            reported. The breadcrumb's project crumb already ellipsis-truncates; this guarantees
            nothing spills past the zone edge if it's still wider than its share. (Dropdowns
            portal to <body>, so overflow:hidden here never clips a menu.) Narrow keeps the
            zoneFixed no-shrink so the whole row scrolls sideways instead — unchanged. */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, paddingLeft: 12, minWidth: 0, ...(narrow ? zoneFixed : { overflow: "hidden" }) }}>
          {/* Logo — the Planyr brand mark + wordmark (BrandMark, theme-aware).
              Also a secondary route to the Dashboard (the labeled crumb is primary, B192). */}
          <button
            onClick={onDashboard || undefined}
            title={onDashboard ? "Dashboard: all projects" : undefined}
            style={{
              display: "flex", alignItems: "center", flex: "none",
              background: "transparent", border: "none",
              cursor: onDashboard ? "pointer" : "default",
              padding: "2px 4px", borderRadius: 6,
            }}
          >
            {/* Phone: just the mark (no wordmark) — reclaims width so the breadcrumb + switcher fit. */}
            <BrandMark size={20} tile={false} wordmark={!narrow} surface={resolved === "dark" ? "dark" : "light"} />
          </button>

          {/* Project breadcrumb / switcher (B191–B193) — immediately right of the wordmark */}
          {onSelectProject && (
            <>
              <span style={{ width: 1, height: 18, background: LINE, flex: "none", margin: "0 4px" }} />
              <ProjectBreadcrumb
                currentProject={currentProject}
                accent={accent}
                onDashboard={onDashboard}
                onSelectProject={onSelectProject}
                onNewProject={onNewProject}
                onRenameProject={onRenameProject}
                onDeleteProject={onDeleteProject}
                saveState={saveState}
                projects={projects}
                homeLabel={homeLabel}
                cross={cross}
                planSlot={planSlot}
              />
            </>
          )}
        </div>

        {/* Center zone — the jurisdiction badge. On desktop it's capped at 40% AND allowed to
            SHRINK (flex 0 1 auto + minWidth 0 + overflow hidden), so when the row gets tight the
            badge truncates via its own ellipsis instead of holding a fixed width and shoving the
            breadcrumb into an overlap (the old flexShrink:0 was the root cause). On a phone the cap
            squeezes the site/plan switcher, so it keeps its natural width and rides the row's
            sideways scroll (no shrink/clip) as before. */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px",
            ...(narrow
              ? { flexShrink: 0, maxWidth: "none" }
              : { flex: "0 1 auto", minWidth: 0, overflow: "hidden", maxWidth: "40%" }),
          }}
        >
          {centerContent}
        </div>

        {/* Right zone — cloud-sync badge · settings · auth. On narrow use `1 0 auto`: still
            GROWS to pin the auth pill rightward when the row has slack, but never SHRINKS its
            controls into clipped slivers when it overflows (then the row scrolls instead). */}
        <div
          style={{
            flex: narrow ? "1 0 auto" : 1, display: "flex", alignItems: "center",
            justifyContent: "flex-end", gap: 6, paddingRight: 12,
          }}
        >
          {/* The compact, app-wide save indicator (NEW-1): one shared component, driven by
              the real saveState every workspace already computes — never an optimistic
              "always green", and it renders a LOUD error state instead of silently vanishing. */}
          <CloudSyncBadge state={saveState} onRetry={onRetrySave} detail={saveDetail} />
          {saveSlot}
          {/* Theme gear — signed-out only; signed-in users switch theme in account → Settings (B389) */}
          {!accountActive && <SettingsMenu />}
          {authControl}
        </div>
      </div>

      {/* ── Row 2 — 44px (taller than Row 1: the tools row earns the weight, B357) ──
           With a center slot (B387) Row 2 is a 3-zone layout: tabs (flex:1) | center group
           (shrink-to-content) | toolbar (flex:1, end), so the center group is optically
           centered the same way Row 1 centers the project name. The row may wrap on a
           too-narrow viewport (the center/toolbar flow to a second line) instead of
           overlapping — never absolute positioning. With NO center slot (Site/Review) the
           original 2-zone tabs|toolbar layout renders unchanged. */}
      {toolbarCenter ? (
        // On narrow, scroll sideways (nowrap) instead of wrapping to a 2nd line — the owner's
        // explicit ask. Above the breakpoint the original wrap layout is untouched.
        <div className={narrow ? "no-hscrollbar" : undefined} style={{ minHeight: 44, display: "flex", alignItems: "center", flexWrap: narrow ? "nowrap" : "wrap", rowGap: 2, borderTop: `1px solid ${LINE}`, ...rowScroll }}>
          {/* Left zone — module tabs (flex:1, basis 0 — mirrors Row 1 so the center is
              TRULY centered regardless of how wide the tabs vs the toolbar are) */}
          <div style={{ display: "flex", alignItems: "stretch", alignSelf: "stretch", paddingLeft: 4, flex: narrow ? "0 0 auto" : 1, minWidth: 0 }}>
            {moduleTabButtons}
          </div>
          {/* Center zone — workspace-supplied center group (shrink-to-content). Narrow: don't
              shrink (ride the row scroll); desktop keeps its original shrinkable `0 1 auto`. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: narrow ? "0 0 auto" : "0 1 auto", minWidth: 0, gap: 4, padding: "0 8px" }}>
            {toolbarCenter}
          </div>
          {/* Right zone — toolbar slot (flex:1 end, mirrors Row 1's right zone). Narrow: keep
              natural width + show overflow so the row scrolls rather than clipping the tools. */}
          <div style={{ flex: narrow ? "1 0 auto" : 1, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, minWidth: narrow ? "auto" : 0, gap: 4, overflow: narrow ? "visible" : "hidden" }}>
            {toolbarContent}
          </div>
        </div>
      ) : (
        <div className={narrow ? "no-hscrollbar" : undefined} style={{ height: 44, display: "flex", alignItems: "center", borderTop: `1px solid ${LINE}`, ...rowScroll }}>

          {/* Module tabs */}
          <div style={{ display: "flex", alignItems: "stretch", height: "100%", paddingLeft: 4, flex: "none" }}>
            {moduleTabButtons}
          </div>

          {/* Toolbar slot. On a phone the workspace toolbar (undo/redo/snap/select/File…) is
              wider than the screen; desktop clips it with overflow:hidden + flex-shrink, which
              hid every control left of "File ▾". On narrow we instead let the row scroll: the
              slot keeps natural width (flex 1 0 auto — grows to pin right with slack, never
              shrinks) and shows its overflow so swiping reveals the hidden tools. */}
          <div
            style={{
              flex: narrow ? "1 0 auto" : 1, display: "flex", alignItems: "center",
              justifyContent: "flex-end", paddingRight: 6,
              minWidth: narrow ? "auto" : 0, gap: 4,
              overflow: narrow ? "visible" : "hidden",
            }}
          >
            {toolbarContent}
          </div>
        </div>
      )}
    </header>
    {/* B313 — non-blocking warning when the SAME project is open in another same-browser tab AND
        this workspace actually enforces a read-only lock elsewhere (Doc Review; Site Planner
        pre-multiwriter). Clears automatically when that tab closes/navigates (its 'bye' / TTL
        prunes it). NEW-1 (2026-07-15, owner: "i dont need this large pop up") — shrunk from a
        bold full-width strip to a small dismissible pill, theme-tokened (was hardcoded hex — a
        KEY DECISIONS violation). B850 further found the Scheduler doesn't enforce a lock at all
        (it's genuinely safe for two tabs — see multiEditOk above), so it now suppresses this
        banner entirely via multiEditOk rather than getting its own copy variant here. */}
    {accountActive && multiTab.conflictRisk && !multiTabDismissed && (
      <div role="status" style={{ position: "fixed", top: 84, left: "50%", transform: "translateX(-50%)", zIndex: 5999, maxWidth: "min(440px, calc(100vw - 16px))", display: "flex", alignItems: "flex-start", gap: 7, background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--warn-text)", borderRadius: 8, padding: "5px 6px 5px 10px", fontSize: 11.5, fontFamily: "system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,0.22)" }}>
        <span aria-hidden="true" style={{ color: "var(--warn-text)", fontWeight: 700, lineHeight: 1.5 }}>⧉</span>
        <span style={{ lineHeight: 1.4, paddingTop: 1 }}>
          Also open in <b>another tab</b> — that tab is the active editor; this one is read-only until you switch there or close it.
        </span>
        <button type="button" onClick={() => setMultiTabDismissed(true)} aria-label="Dismiss"
          style={{ flex: "none", border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "1px 3px", marginLeft: 1 }}>
          ×
        </button>
      </div>
    )}
    </>
  );
}
