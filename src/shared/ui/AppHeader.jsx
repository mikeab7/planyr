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
 * ⛔ FULLSCREEN (B1156 · B1173 ×2) — THE HEADER STAYS. BOTH ROWS. ALWAYS.
 * `F` asks the browser for REAL fullscreen (the Fullscreen API on document.documentElement), and
 * what that reclaims is the BROWSER's chrome: the tab strip, the address bar, the OS taskbar. It
 * does not reclaim ours. B1156 additionally hid this header, and B1173 — filed because that left
 * fullscreen a dead end with no way to change plan or workspace — answered with a top-edge hover
 * reveal. The owner's second report says that answer is not good enough, verbatim: "to switch
 * between projects, I have to exit full screen, which is kind of annoying. That's not how it's
 * supposed to work. I should still have the two headers at the top when I go into full screen."
 * Switching plans is a PRIMARY action during a review, and a hover-to-reveal costs a deliberate
 * gesture every time. So the header now renders BYTE-IDENTICALLY in and out of fullscreen: in
 * flow, both rows, no slide, no reveal timers, no floating exit button. If screen area has to come
 * from somewhere it is never from the navigation.
 * The document ROOT is deliberately the fullscreen target: fullscreening a subtree would hide
 * every position:fixed overlay that lives outside it. The header's own state is driven FROM the
 * document via `fullscreenchange`, so Esc, F11 or the browser's own exit affordance can never
 * leave the two disagreeing.
 * ⛔ AND THERE IS NO CHROME-HIDE FALLBACK ANY MORE (LOUD-FAILURE). It existed so a refused request
 * still did SOMETHING visible; with the header staying put it would now do nothing at all, which
 * is a silent no-op wearing a feature's clothes. A refusal (a permissions policy, an iframe with
 * no allow="fullscreen", iOS Safari, which has no fullscreen for a non-video element) says so in
 * a short notice instead.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RADIUS } from "./radius.js";
import ProjectBreadcrumb from "./ProjectBreadcrumb.jsx";
import CloudSyncBadge from "./CloudSyncBadge.jsx";
import AnchoredMenu from "./AnchoredMenu.jsx";
import { createMultiTabPresence } from "../presence/multiTab.js";
import BrandMark from "../brand/BrandMark.jsx";
import { prefetchModule } from "../../app/modulePrefetch.js";
import { MODULE_ACCENT } from "./moduleAccent.js";
import { useTheme } from "../theme/ThemeProvider.jsx";
import InterfaceSettings from "./InterfaceSettings.jsx";
import { centerSlotPlan, CENTER_SLOT_GAP } from "./headerCenterFit.js";

// Chrome colors are theme tokens (var(--chrome-*)) so the header themes WITH the app
// (B318): light theme = light chrome, dark theme = dark chrome.
const CHROME = "var(--chrome-bg-elev)";
const LINE   = "var(--chrome-divider)";

// B1173(×2) — how long the "your browser wouldn't allow full screen" notice stays up. Long enough
// to read, short enough that it never becomes furniture.
const FS_NOTICE_MS = 5000;
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
  padding: 6, borderRadius: RADIUS.lg, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};

/* Settings gear (row-1 right zone) → popover hosting the display-theme picker. Rendered
 * only when signed OUT (B389): signed-in users get the theme control in account → Settings,
 * so the gear isn't duplicated; signed out, this keeps the switch one click away. (B342/B389)
 *
 * ⛔ NO STORAGE READOUT HERE, and it is a budget decision rather than a product one (NEW-3/B1429).
 * This file lands in the shared ENTRY chunk, so anything mounted here is downloaded by EVERY
 * route. Even a lazy stub for the storage panel measured +0.5 KB on all four routes and pushed
 * `bundle.notesRouteJsBytes` 0.2 KB past its ceiling in CI — a breach the repo pays back with an
 * optimization rather than a raised baseline. The storage readout therefore lives in ONE place,
 * account → Settings (`AuthPanel`), which is where a signed-in owner looks for it. A signed-out
 * user reaches it by signing in; the amber banner's "Free up space & retry" (B1428) works
 * regardless of route or session, so nothing is unreachable — only less convenient. */
/* ⛔ IS THERE A DOCUMENT ON SCREEN THAT SOMEBODY COULD BE WRITING IN? (B291538.) The same
 * `getClientRects()` probe the header uses for its own keep-alive gate, and for the same
 * reason: workspaces are kept mounted-but-hidden, so a Notes editor left behind on another
 * tab is in the DOM with no boxes at all. A surface with boxes is painted; a surface with
 * none is not there. Anything editable — the note body, a Review markup field — makes the
 * bare `f` fullscreen shortcut stand down, because in that place a letter is a letter. */
function writeableDocumentOnScreen() {
  if (typeof document === "undefined") return false;
  for (const el of document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')) {
    if (el.getClientRects().length) return true;
  }
  return false;
}

/* NEW-3/B291538 — fullscreen's VISIBLE home. Before this it had no control at all: the only
 * ways in were a bare `f` and folklore, which is what made the shortcut worth defending even
 * as it swallowed the owner's typing. A button costs one 30×26 slot in the row-1 right zone
 * and makes the mode discoverable, which is the half of the fix that is not a bug fix.
 * B1173(×2): it is also now the ONLY exit control, and it can be, because the header it sits in
 * no longer goes anywhere — the floating "✕ Exit fullscreen" button existed solely to give a
 * hidden header a way back. */
function FullscreenButton({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      data-testid="toggle-fullscreen"
      aria-pressed={active}
      aria-label={active ? "Leave full screen" : "Full screen"}
      /* ⛔ NOT the words "Exit fullscreen" — that is the floating exit button's title, and
         e2e/module-keepalive.spec.js locates it by `getByTitle(/Exit fullscreen/i)`. Two matches
         is a strict-mode failure, so this control says it a different way on purpose. */
      title={active ? "Leave full screen (Ctrl/⌘+Shift+F)" : "Full screen (Ctrl/⌘+Shift+F)"}
      style={{
        display: "grid", placeItems: "center", width: 30, height: 26, borderRadius: RADIUS.sm,
        border: `1px solid ${LINE}`, background: "var(--chrome-bg)", color: "var(--chrome-text)",
        cursor: "pointer", flex: "none",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
        {active
          ? <><path d="M9 3v6H3" /><path d="M15 3v6h6" /><path d="M9 21v-6H3" /><path d="M15 21v-6h6" /></>
          : <><path d="M3 9V3h6" /><path d="M21 9V3h-6" /><path d="M3 15v6h6" /><path d="M21 15v6h-6" /></>}
      </svg>
    </button>
  );
}

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
        title="Settings: display theme, smooth zoom"
        style={{
          display: "grid", placeItems: "center", width: 30, height: 26, borderRadius: RADIUS.sm,
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
        placement="below-right" width={230} gap={8} panelStyle={settingsPanel}>
        {/* NEW-1 — the same Interface section the signed-in Settings panel renders (theme +
            smooth zoom), from the ONE component, so the two homes cannot disagree. */}
        <InterfaceSettings />
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
  /* B1173(×2) — `fullscreen` now means exactly one thing: THE BROWSER IS IN FULLSCREEN AND THIS
     HEADER IS THE ONE ON SCREEN. It no longer means "the chrome is collapsed", because the chrome
     is never collapsed. Its only effects are the toggle button's pressed state and label, and the
     `data-fullscreen` marker a headless check reads to prove exactly one header claimed the mode. */
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false); fullscreenRef.current = fullscreen; // live value for the once-bound key handler
  // Set when WE adopted the document's fullscreen, so a `fullscreenchange` we did not cause (a
  // <video> elsewhere on the page exiting) cannot yank this header's state around.
  const nativeFsRef = useRef(false);
  // B1173(×2) — the refusal notice (see the file header: no silent no-op).
  const [fsNotice, setFsNotice] = useState("");
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

  /* ── NEW-1 — THE ROW-1 CENTRE SLOT IS CENTRED ON THE HEADER, NOT ON THE LEFTOVER SPACE ─────────
     Owner, 2026-08-09: "now the jurisdiction is not centered." The chip was perfectly centred inside
     its slot; the SLOT was off-centre, because `flex: 1 1 0%` makes it the space that remains between
     the breadcrumb and the account controls — so the chip's position was a function of how long the
     project and plan names are, and drifted from site to site and on every rename. (Long-standing, not
     a regression from the label-text change, which only made it visible.)

     The slot is therefore taken OUT OF FLOW — pinned at the row's midpoint — so the side groups keep
     their natural widths and NAVIGATION WINS (B371361) is untouched. Its width is then BOUNDED by
     measurement (`headerCenterFit`) so it can never reach either side group: out of flow, nothing else
     would stop it, and an overlapping pill is exactly the defect B371361 closed. Inside that bound the
     pill truncates / abbreviates / collapses on its own, as before, and keeps its full string in the
     tooltip and in `data-jurisdiction-full`.

     Measurement is a LAYOUT effect (VIEWPORT-STABLE): the width is folded in before paint, so a panel
     toggle or a window resize never shows one frame of a mis-sized slot. It cannot feed back on itself
     — the slot is out of flow, so its own width changes neither side group's.

     THREE OUTCOMES, never two (`headerCenterFit.centerSlotPlan`, and `data-center-mode` reports which
     is live): `centered` · `tight` — a wide breadcrumb in a narrow window leaves no room for a real
     centre, so the slot goes back in flow and takes what remains, off-centre but READABLE rather than
     a sliver · `unmeasured` — LOUD-FAILURE: nothing could be measured, so the old visible layout runs,
     and it is kept distinct from `tight` so a header that never measures cannot hide behind a
     legitimate-looking verdict. */
  const rowRef = useRef(null);
  const leftZoneRef = useRef(null);
  const rightZoneRef = useRef(null);
  const centerZoneRef = useRef(null);
  const [center, setCenter] = useState({ mode: "unmeasured", max: null });
  useLayoutEffect(() => {
    if (narrow) return undefined; // phone: the row scrolls sideways, everything stays in flow
    const row = rowRef.current, left = leftZoneRef.current, right = rightZoneRef.current;
    if (!row || !left || !right) return undefined;
    const measure = () => {
      /* ⛔ B371362 — THE THRESHOLD COMES FROM THE CONTENT WHEN THE CONTENT KNOWS IT. `CENTER_SLOT_MIN`
       * is a constant standing in for "the least width at which the chip can still say something",
       * and that quantity is a property of what is IN the slot: 120 px fits "Unincorporated" and does
       * not fit the owner's Goose Creek label, whose shortest true form needs 199. Measured on the
       * real header: at 1000 px the bound is 136, `centered` wins because 136 ≥ 120, and the pill is
       * handed a slot it cannot use — while at 980 px `tight` shows the whole label. A slot the
       * content cannot use is not a centred chip, it is an empty space where a chip used to be.
       *
       * The content declares it on `data-center-min-fit`; anything that declares nothing gets the
       * constant and behaves exactly as before. Reading it cannot loop: the value is a function of
       * the content's TEXT, never of the width it is granted. */
      const declared = centerZoneRef.current
        ? Number(centerZoneRef.current.querySelector("[data-center-min-fit]")?.getAttribute("data-center-min-fit"))
        : NaN;
      const next = centerSlotPlan({
        rowW: row.clientWidth,
        leftW: left.getBoundingClientRect().width,
        rightW: right.getBoundingClientRect().width,
        ...(Number.isFinite(declared) && declared > 0 ? { min: declared } : null),
      });
      // Sub-pixel churn would re-render every frame of a drag for no visible change.
      setCenter((prev) => (prev.mode === next.mode && prev.max != null && next.max != null
        && Math.abs(prev.max - next.max) < 0.5 ? prev : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(row); ro.observe(left); ro.observe(right);
    /* The centre too — not for ITS width (which is never an input) but because the content's declared
     * minimum changes when the content does, and a new jurisdiction label must be able to move the
     * verdict. The plan is computed from row/left/right + the declared minimum, none of which is the
     * centre's rendered width, so observing it cannot feed back. */
    if (centerZoneRef.current) ro.observe(centerZoneRef.current);
    return () => ro.disconnect();
  }, [narrow]);
  // `centered` is the only mode that leaves the flow; the other two are the row as it has always been.
  const centered = !narrow && center.mode === "centered";
  const centerMode = narrow ? "narrow" : center.mode;

  /* Enter/leave. The keypress IS the user activation the Fullscreen API requires, so the request
     is made straight out of the key handler, not deferred. `requestFs()` can REJECT (a permissions
     policy, an iframe without allow="fullscreen", or no API at all — iOS Safari has no fullscreen
     for a non-video element). B1173(×2): there is no chrome-hide fallback to fall into any more,
     so a rejection SAYS SO rather than doing nothing visible. */
  const toggleFullscreen = () => {
    if (fullscreenRef.current) { exitFs(); return; }
    requestFs().catch(() => {
      nativeFsRef.current = false;
      setFsNotice("Your browser wouldn't allow full screen here.");
    });
    // On success the state is set by the fullscreenchange handler below, not from here — one
    // owner for the state, so entering can't race the event that reports it.
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
      /* The modifier shortcut is checked BEFORE the typing-surface guard on purpose: it is the
         one route to fullscreen that has to work while the caret is inside a note. */
      if ((e.key === "F" || e.key === "f") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (!headerOnScreen()) return;
        e.preventDefault();
        toggleRef.current();
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;
      // Keep-alive gate: with workspaces kept mounted-but-hidden, EVERY workspace's header has this
      // window listener. A hidden header (a `display:none` ancestor ⇒ no client rects) must ignore
      // the shortcut, or one keypress toggles fullscreen in all of them.
      if (!headerOnScreen()) return;
      /* ⛔ A BARE LETTER IS NEVER A GLOBAL COMMAND WHILE A WRITEABLE DOCUMENT IS ON SCREEN
         (B291538). The owner's report was *"double-click on a blank part of the page, then
         type — the view flips to fullscreen and the typed text goes nowhere"*, and he read it
         as double-click being BOUND to fullscreen. AUDIT-FIRST: it is not, and never was —
         nothing in this repo binds a double-click to fullscreen. What actually happens is
         this line. `f` toggles fullscreen for any press whose target is not itself a typing
         surface, so the instant a gesture leaves focus on <body> — and a press on inert
         chrome does exactly that — the next letter he types is read as a command instead of
         as a letter. Measured with a note open and focus on <body>: one bare `f` entered real
         fullscreen and the keystroke was gone.
         The gate is the presence of the document, not where focus happens to be: if there is
         a live contenteditable surface painted on screen, the user is in a place where
         letters mean letters. Fullscreen keeps two homes that no typing can reach — the
         button in the row-1 right zone, and Ctrl/Cmd+Shift+F — so nothing became
         unreachable. Where there is no document (the Site Planner canvas, the map) the bare
         `f` is untouched, which is why ui-audit/verify-new1-fullscreen.mjs still passes. */
      if ((e.key === "f" || e.key === "F") && !e.altKey && !writeableDocumentOnScreen()) toggleRef.current();
      // ⛔ Do NOT fight Esc. In real fullscreen the browser consumes it and exits on its own, and
      // `fullscreenchange` reports that here. Acting on it as well would be a second toggle over
      // the top of that. B1173(×2) retired the chrome-hide fallback, which was the only branch Esc
      // ever owned, so this handler has nothing left to do with it.
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  // B1173(×2) — the refusal notice clears itself; it is a report, not a state to manage.
  useEffect(() => {
    if (!fsNotice) return undefined;
    const t = setTimeout(() => setFsNotice(""), FS_NOTICE_MS);
    return () => clearTimeout(t);
  }, [fsNotice]);

  /* HAND THE FULLSCREEN MODE OVER when the workspace changes. Every workspace owns its own
     AppHeader, and the incoming one was `display:none` when `f` was pressed, so the keep-alive gate
     correctly kept it out of the `fullscreenchange` — leaving it convinced it was NOT fullscreen
     while the document still was. That would strand you in browser fullscreen with `f` DEAD
     (requesting fullscreen on an already-fullscreen document resolves without firing another
     `fullscreenchange`, so nothing would answer the key) and the toggle button showing the wrong
     label. The outgoing header has the mirror problem: left claiming fullscreen, two headers claim
     the mode at once — which is the "two stacked" defect the #869 harness exists to catch.

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
      // Adopt the DOCUMENT's truth on the way in. With the chrome-hide fallback gone (B1173 ×2)
      // the document IS the whole answer — there is no mode this header can be in that the
      // Fullscreen API does not know about.
      const real = !!fsElement();
      if (real !== fullscreenRef.current) { nativeFsRef.current = real; setFullscreen(real); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The breadcrumb uses `accent` as foreground TEXT ("current" / "New project"), so it
  // must be the AA-passing -text token, never the fill (fill-as-text = 3.4:1, B341/B318).
  const accent = ACCENT_TEXT[module] || "var(--accent)";

  /* ⛔ B1173(×2) — THE FLOATING "✕ Exit fullscreen" BUTTON IS GONE, and its removal is the point
     rather than a tidy-up. It existed for exactly one reason: a hidden header has no exit control,
     so one had to float over the canvas. The header no longer hides, so the button became a second
     control for a job the row-1 toggle already does — and a second thing painted over the drawing,
     which is the opposite of what fullscreen is for. `data-testid="toggle-fullscreen"` with
     `aria-pressed` is now the one exit affordance, and the three harnesses that reached for
     `exit-fullscreen` were re-aimed at it in the same commit. */

  // Module tabs — shared by both Row-2 layouts (with and without the B387 center slot)
  // so the per-tab wiring is defined once.
  const moduleTabButtons = MODULES.map((m) => (
    <ModuleTab key={m.id} m={m} isActive={m.id === module} onClick={() => onSwitch && onSwitch(m.id)} />
  ));

  return (
    <>
    <header
      ref={headerRef}
      /* The scope marker AnchoredMenu stamps onto its portalled panels, so a menu opened FROM the
         header can be recognised as ours after it leaves this subtree. */
      data-menu-scope="app-header"
      /* ⛔ B1173(×2) — ONE STYLE, IN AND OUT OF FULLSCREEN. There is deliberately no `fullscreen`
         branch here any more: both rows stay in flow, at the top, always. The mode is still
         REPORTED (`data-fullscreen`) so a headless check can prove exactly one header claims it —
         it just no longer changes where the chrome is. */
      style={{ flex: "none", background: CHROME, borderBottom: `1px solid ${LINE}`, position: "relative", zIndex: 60 }}
      data-fullscreen={fullscreen ? "on" : undefined}
    >
      {/* ── Row 1 — 35px (−20% from 44 per B169; contents stay vertically centered) ── */}
      <div ref={rowRef} className={narrow ? "no-hscrollbar" : undefined} style={{ height: 35, display: "flex", alignItems: "center", position: "relative", ...rowScroll }}>

        {/* ⛔ NEW-2 — NAVIGATION WINS. Read this before changing any of the three zone flexes.
            The owner could not open the plan switcher on a laptop: "the unincorporated / city of
            Houston / ETJ / Harris County chip is too big and it covers it." Measured at a 1191 px
            viewport — the pill overlapped the plan chip's box by a sliver, and `elementFromPoint`
            along the chip's right edge returned THE PILL'S TEXT SPAN for the last stretch of it,
            the ▾ CARET INCLUDED. NOT a z-index or overlay problem (the pill is position:static,
            z-index:auto): plain flex overflow, a pill that would not shrink running over its
            neighbour.

            The zones used to be `1 | 0 1 auto (max 40%) | 1`, which optically centred the badge by
            giving the two side zones an EQUAL SHARE regardless of what they held — so the left
            zone was handed less than the breadcrumb needed while the pill sat comfortably under
            its cap and never shrank. The rule is now explicit and one-directional:

              LEFT (navigation)  `0 1 auto` — takes the width it needs, capped, and shrinks only
                                 after the centre has already collapsed (its basis is content, the
                                 centre's is 0, so negative free space lands here last).
              CENTRE (the pill)  `1 1 0%`   — takes what is LEFT OVER and centres within it, so its
                                 width never depends on its own content and it truncates,
                                 abbreviates (JurisdictionBadge) or collapses on its own.
              RIGHT (account)    `0 0 auto` — the save badge, fullscreen, gear and auth pill keep
                                 their size; they were never the contended pair.

            The cost, stated: the badge is centred in the space that remains rather than in the
            window. That is what "navigation wins" buys. Narrow (phone) is untouched — the row
            scrolls sideways there and the zoneFixed no-shrink still applies. (Dropdowns portal to
            <body>, so overflow:hidden here never clips a menu.) */}
        <div ref={leftZoneRef} data-header-zone="left" style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 12, minWidth: 0, ...(narrow ? { flex: 1, ...zoneFixed } : { flex: "0 1 auto", maxWidth: "60%", overflow: "hidden" }) }}>
          {/* Logo — the Planyr brand mark + wordmark (BrandMark, theme-aware).
              Also a secondary route to the Dashboard (the labeled crumb is primary, B192). */}
          <button
            onClick={onDashboard || undefined}
            title={onDashboard ? "Dashboard: all projects" : undefined}
            style={{
              display: "flex", alignItems: "center", flex: "none",
              background: "transparent", border: "none",
              cursor: onDashboard ? "pointer" : "default",
              padding: "2px 4px", borderRadius: RADIUS.sm,
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

        {/* Center zone — the jurisdiction badge.
            NEW-1 (`absolute`): pinned at the row's midpoint and out of flow, so the chip is centred
            on the HEADER and its position no longer depends on how long the breadcrumb or the
            account controls are. `centerMax` (measured above) keeps it clear of both side groups —
            without that bound, an out-of-flow slot would run straight back over the plan chip, which
            is the B371361 defect. Inside the bound the pill truncates / abbreviates / collapses on
            its own and keeps the full string in its tooltip.
            NEW-2 (`tight` / `unmeasured`): the space LEFT OVER after navigation (`1 1 0%`) — kept for
            the two cases a true centre cannot serve, because a visible off-centre chip beats a sliver
            and beats a silently collapsed one.
            On a phone (`narrow`) the row scrolls sideways, so the badge keeps its natural width. */}
        <div
          ref={centerZoneRef}
          data-header-center="1"
          data-center-mode={centerMode}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            // The clear space is already IN the measured bound when centred, so padding here would
            // only eat the chip's own room.
            padding: centered ? 0 : "0 8px",
            ...(narrow
              ? { flexShrink: 0, maxWidth: "none" }
              : centered
                ? {
                  position: "absolute", left: "50%", transform: "translateX(-50%)",
                  top: 0, bottom: 0, maxWidth: center.max, minWidth: 0, overflow: "hidden",
                }
                : { flex: "1 1 0%", minWidth: 0, overflow: "hidden" }),
          }}
        >
          {centerContent}
        </div>

        {/* NEW-1 — the slack the centre slot used to absorb. With the centre out of flow, something
            in flow has to hold the right zone against the right edge; a growing right zone would
            report its own measured width as "the whole slack" and destroy the bound above. An empty,
            inert spacer keeps that measurement honest. (In `tight` / `unmeasured` / `narrow` mode the
            centre is back in flow and absorbs the slack itself, so the spacer stands down.) */}
        {centered && <div aria-hidden="true" style={{ flex: "1 1 0%", minWidth: CENTER_SLOT_GAP }} />}

        {/* Right zone — cloud-sync badge · settings · auth. On narrow use `1 0 auto`: still
            GROWS to pin the auth pill rightward when the row has slack, but never SHRINKS its
            controls into clipped slivers when it overflows (then the row scrolls instead). On
            desktop it is now `0 0 auto` (NEW-2): the centre zone grows instead, which still pins
            these controls to the right edge, and these were never the contended pair — shrinking
            them would clip the auth pill to buy room for a label. */}
        <div
          ref={rightZoneRef}
          data-header-zone="right"
          style={{
            flex: narrow ? "1 0 auto" : "0 0 auto", display: "flex", alignItems: "center",
            justifyContent: "flex-end", gap: 6, paddingRight: 12,
          }}
        >
          {/* The compact, app-wide save indicator (NEW-1): one shared component, driven by
              the real saveState every workspace already computes — never an optimistic
              "always green", and it renders a LOUD error state instead of silently vanishing. */}
          <CloudSyncBadge state={saveState} onRetry={onRetrySave} detail={saveDetail} />
          {saveSlot}
          {/* NEW-3/B291538 — fullscreen's visible control. It has to exist here because the
              bare `f` shortcut now stands down wherever a writeable document is on screen. */}
          <FullscreenButton active={fullscreen} onToggle={() => toggleRef.current()} />
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
    {/* B1173(×2) — LOUD-FAILURE for a refused fullscreen request. With no chrome-hide fallback
        left, a rejection would otherwise be a keypress that visibly does nothing. */}
    {fsNotice && (
      <div role="status" data-testid="fullscreen-refused" style={{ position: "fixed", top: 84, left: "50%", transform: "translateX(-50%)", zIndex: 5999, maxWidth: "min(440px, calc(100vw - 16px))", background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--warn-text)", borderRadius: RADIUS.lg, padding: "5px 10px", fontSize: 11.5, fontFamily: "system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,0.22)" }}>
        {fsNotice}
      </div>
    )}
    {accountActive && multiTab.conflictRisk && !multiTabDismissed && (
      <div role="status" style={{ position: "fixed", top: 84, left: "50%", transform: "translateX(-50%)", zIndex: 5999, maxWidth: "min(440px, calc(100vw - 16px))", display: "flex", alignItems: "flex-start", gap: 7, background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--warn-text)", borderRadius: RADIUS.lg, padding: "5px 6px 5px 10px", fontSize: 11.5, fontFamily: "system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,0.22)" }}>
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
