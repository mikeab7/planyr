import { OWNER_CAP, ownerKey } from "../../../shared/schedule/engine/owners.js";
import { exposeToHarness } from "./harnessGlobals.js";

const { useState, useRef, useCallback } = React;

// B865 — password-manager "leave this input alone" attributes. Spread {...NO_AUTOFILL} as the
// FIRST attribute on every inline cell / free-text editor so 1Password / LastPass / Bitwarden /
// Dashlane don't inject an inline icon + identity-autofill card over the grid cell. This iframe
// has no login/signup form, so nothing here needs autofill. Kept byte-identical to
// src/shared/ui/noAutofill.js (guarded by test/noAutofill.test.js).
export const NO_AUTOFILL = {
  autoComplete: (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) ? "x-planyr" : "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
};
// B2308848 amended — contact fields (a person's name, an email) KEEP browser suggestions: they opt in with the right
// standard token instead of NO_AUTOFILL. Kept in step with src/shared/ui/noAutofill.js (test/noAutofill.test.js).
const CONTACT_TOKENS = { name: "name", email: "email", phone: "tel", company: "organization" };
export const contactField = (kind) => ({ autoComplete: CONTACT_TOKENS[kind], "data-contact-field": "" });

/* NEW-2 — ⛔ A REACT PORTAL BUBBLES TO ITS REACT PARENT, NOT ITS DOM PARENT. A floating menu
 * rendered by a grid cell lives in <body> visually, but its events still travel up the REACT tree
 * and land on that cell's handlers. So a press inside the menu reaches the cell's `onMouseDown` —
 * which is what arms drag-select — and dragging a few pixels before release (what a real hand does)
 * paints a selection band down the grid that the user never asked for.
 *
 * Measured: a plain click leaks nothing; press-move-release on a status swatch selected rows 2-8 of
 * the status column. The press does NOT arrive through the DOM — a DOM-level listener on the cell
 * never fires — which is the evidence that rules out "the click is falling through to what's
 * underneath" and pins it on React's tree.
 *
 * This is the whole fix, in one place, spread onto the ROOT of every menu a grid cell portals out:
 * the pointer events that arm grid selection stop at the menu's edge. It is deliberately only the
 * grid-arming pair — `click` is left alone so each menu's own item handlers keep working, and
 * nothing here touches ordinary drag-select in the grid, which still works normally whenever the
 * press did not start inside a menu. Both of those are asserted, because a fix that killed
 * drag-select would be a worse bug than the leak.
 *
 * Enforced by test/menuPortalIsolation.test.js, which sweeps the file so a NEW cell-level menu
 * cannot be added without it. */
export const MENU_STOPS_GRID = {
  onMouseDown: e => e.stopPropagation(),
  onMouseUp:   e => e.stopPropagation(),
  "data-menu-isolated": "1",
};

/* ⛔ ANCHORED-POPOVER (NEW-1 / B2465520, 2026-10-28) — ONE mechanism keeps every popover that is portaled
 * out of a cell (or a header button) attached to the thing it belongs to.
 *
 * THE DEFECT (owner report, Schedule › Grid): click the traffic-light dot on a row near the bottom,
 * scroll the wheel — the picker stayed where it opened while the rows scrolled away under it. The cause
 * was a pattern repeated across the file: `getBoundingClientRect()` read ONCE in the click handler into a
 * `position:fixed` portal, with nothing to move it afterwards. (ContactPicker alone tracked its cell, with
 * a private rAF loop — correct, but a second copy of the idea, and it did not know about the sticky
 * header, so a cell scrolled UNDER the column header kept its popup drawn over the header.)
 *
 * THE RULE, stated once: while a popover is open it re-reads its anchor's real rect EVERY FRAME (a rAF
 * loop has no event to miss — a capture scroll listener does not always fire for the nested grid
 * scroller inside the iframe, see the ContactPicker NEW-4 note in test/contactCreateConfirm.test.js) and
 * re-places itself; and the instant the anchor is no longer visible — scrolled out of any clipping
 * ancestor, out of the window, or fully hidden behind the sticky header or a pinned column — it calls
 * `onGone()`, which every caller wires to a plain CLOSE (never a commit: a picker that is dismissed
 * because its cell left changes nothing).
 *
 * `anchorHidden` is the pure verdict (unit-tested through the real source in
 * test/anchoredPopover.test.js); `useAnchoredPopover` is the one hook. A NEW popover that positions a
 * `position:fixed` portal from a measured rect uses the hook — test/anchoredPopover.test.js sweeps for a
 * `setPos(` that follows a `getBoundingClientRect()` outside it. */
export const anchorHidden = (r, area, occluders) => {
  if (!(r.width > 0 || r.height > 0)) return true;                           // laid out nowhere (display:none / detached)
  if (r.bottom <= area.top || r.top >= area.bottom || r.right <= area.left || r.left >= area.right) return true;
  return (occluders || []).some(o => r.left >= o.left && r.right <= o.right && r.top >= o.top && r.bottom <= o.bottom);
};
// The visible area of `el` (the window narrowed by every ancestor that clips it) and what can sit ON TOP
// of the area without clipping it: the grid's sticky header row and its pinned columns.
export function anchorSurroundings(el) {
  const area = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const pr = p.getBoundingClientRect();
    area.left = Math.max(area.left, pr.left); area.top = Math.max(area.top, pr.top);
    area.right = Math.min(area.right, pr.right); area.bottom = Math.min(area.bottom, pr.bottom);
  }
  const occluders = [];
  const sb = el.closest("[data-scroll-bounds]");
  if (sb) {
    const sbr = sb.getBoundingClientRect();
    const hdr = sb.querySelector("[data-grid-header]");
    // the sticky header covers whatever scrolls under it — but a header cell's OWN menu belongs to the header
    if (hdr && !hdr.contains(el)) occluders.push({ left: sbr.left, right: sbr.right, top: sbr.top, bottom: hdr.getBoundingClientRect().bottom });
    const ownCell = el.closest("[data-col-key],[data-hdr-col]");
    const own = ownCell ? (ownCell.getAttribute("data-col-key") || ownCell.getAttribute("data-hdr-col")) : null;
    sb.querySelectorAll("[data-hdr-col]").forEach(h => {
      if (h.getAttribute("data-hdr-col") === own || getComputedStyle(h).position !== "sticky") return;
      const hr = h.getBoundingClientRect();
      occluders.push({ left: hr.left, right: hr.right, top: sbr.top, bottom: sbr.bottom });
    });
  }
  return { area, occluders };
}
// `place(rect)` -> the popover's position object; returns that object (null until the first measure) or
// null while closed. `onGone()` closes the popover without committing anything.
export function useAnchoredPopover(open, anchorRef, place, onGone) {
  const [pos, setPos] = React.useState(null);
  const placeRef = React.useRef(place); placeRef.current = place;
  const goneRef = React.useRef(onGone); goneRef.current = onGone;
  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    let raf = null, dead = false;
    const measure = () => {
      const el = anchorRef.current;
      if (!el || !el.isConnected) { goneRef.current(); return false; }
      const r = el.getBoundingClientRect();
      const s = anchorSurroundings(el);
      if (anchorHidden(r, s.area, s.occluders)) { goneRef.current(); return false; }
      const next = placeRef.current(r);
      setPos(p => (p && Object.keys(next).every(k => p[k] === next[k]) ? p : next));
      return true;
    };
    if (!measure()) return undefined;                  // placed before the first paint — no flash at the old spot
    const tick = () => { if (dead) return; if (measure()) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { dead = true; if (raf) cancelAnimationFrame(raf); };
  }, [open]);
  return open ? pos : null;
}
const BASE_HEALTH = {
  gray:   { label: "Not Started",  dot: "#ffffff", border: "1.5px solid #d1d5db", bar: "#f8fafc",  ganttBar: "#94a3b8", ganttStyle: "solid"   },
  yellow: { label: "In Progress",  dot: "#c47b00", border: "none",                bar: "#fff7d9",  ganttBar: "#c47b00", ganttStyle: "solid"   },
  red:    { label: "Needs Attn.",  dot: "#dc2626", border: "none",                bar: "#ffeaea",  ganttBar: "#dc2626", ganttStyle: "solid"   },
  green:  { label: "Complete",     dot: "#16a34a", border: "none",                bar: "#d6fae2",  ganttBar: "#16a34a", ganttStyle: "solid"   },
  paused: { label: "Paused",       dot: "#9ca3af", border: "none",                bar: "#f3f4f6",  ganttBar: "#9ca3af", ganttStyle: "stripe"  },
};
export const BASE_HK   = ["gray","yellow","red","green","paused"];
const BASE_HDARK = {gray:"#6b7280",yellow:"#92400e",red:"#991b1b",green:"#166534",paused:"#4b5563"};
export let HEALTH = {...BASE_HEALTH};
export let HK     = [...BASE_HK];
export let HDARK  = {...BASE_HDARK};
export const rebuildHEALTH = (custom = [], labelOverrides = {}) => {
  HEALTH = {...BASE_HEALTH};
  HK     = [...BASE_HK];
  HDARK  = {...BASE_HDARK};
  // Defensive: this runs in an effect on every settings change, so corrupt settings
  // (a non-array customHealth, a null custom entry, or non-object overrides) must be
  // skipped — a throw here is uncaught in the effect and breaks the app.
  // Apply label overrides to built-ins
  if (labelOverrides && typeof labelOverrides === "object") {
    Object.entries(labelOverrides).forEach(([k, label]) => {
      if (HEALTH[k]) HEALTH[k] = {...HEALTH[k], label};
    });
  }
  (Array.isArray(custom) ? custom : []).forEach(ch => {
    if (!ch || typeof ch !== "object" || ch.k == null) return;   // skip a null/garbage custom status
    HEALTH[ch.k] = {label:ch.label, dot:ch.dot, border:"none", bar:ch.bar, ganttBar:ch.dot, ganttStyle:"solid"};
    HDARK[ch.k]  = ch.dark || ch.dot;
    if (!HK.includes(ch.k)) HK.push(ch.k);
  });
};

// Parse MS-Project style string: "2", "2FS", "2SS+3", "3FF-1d", "1,2SS"
// ── Toast utility ─────────────────────────────────────────
// Imperative — no React state needed, works from anywhere in the app.
// showToast(msg, opts) renders a brief dismissing notification.
export const showToast = (() => {
  let _activeToast = null;
  return (msg, { type = "error", duration = 3000 } = {}) => {
    // Remove any existing toast immediately
    if (_activeToast) { _activeToast.remove(); _activeToast = null; }

    const el = document.createElement("div");
    el.setAttribute("data-testid", "schedule-toast");   // B1539584 — stable hook for the fit regression check
    const isError = type === "error";
    const isWarn = type === "warn";   // NEW-1 (B2189604) — amber "view only" notice: not red, still says the edit was not saved
    Object.assign(el.style, {
      position:      "fixed",
      bottom:        "28px",
      left:          "50%",
      transform:     "translateX(-50%) translateY(12px)",
      opacity:       "0",
      display:       "flex",
      alignItems:    "flex-start",
      gap:           "8px",
      background:    isError ? "#fef2f2" : isWarn ? "#fffbeb" : "#f0fdf4",
      border:        `1px solid ${isError ? "#fecaca" : isWarn ? "#fde68a" : "#bbf7d0"}`,
      color:         isError ? "#991b1b" : isWarn ? "#92400e" : "#166534",
      borderRadius:  "8px",
      padding:       "9px 16px 9px 12px",
      fontSize:      "12px",
      fontFamily:    "'Inter', system-ui, sans-serif",
      fontWeight:    "500",
      boxShadow:     "0 4px 16px rgba(0,0,0,0.10)",
      zIndex:        "99999",
      pointerEvents: "none",
      transition:    "opacity 0.18s ease, transform 0.18s ease",
      userSelect:    "none",
      // B1539584 — width fits the content up to this cap (and never past the viewport on a
      // phone), then WRAPS onto more lines rather than letting text spill past the pill's own
      // background; see the note below on the removed nowrap white-space setting.
      width:         "max-content",
      maxWidth:      "min(420px, calc(100vw - 32px))",
      lineHeight:    "1.4",
    });

    const icon = document.createElement("span");
    icon.textContent = (isError || isWarn) ? "⚠" : "✓";
    Object.assign(icon.style, {
      fontSize: "13px",
      flexShrink: "0",
      lineHeight: "1.4",
    });

    // B1539584 — was `white-space: nowrap`, which (combined with the flex item default
    // `min-width: auto`) let this span render at its full unbroken width even past the
    // toast's own `max-width`, so long messages painted straight through the pill and onto
    // the page behind it. `minWidth: 0` lets the flex item actually shrink to the container's
    // cap; normal white-space then wraps the overflow onto additional lines instead.
    const text = document.createElement("span");
    text.textContent = msg;
    text.setAttribute("data-testid", "schedule-toast-text");
    Object.assign(text.style, {
      minWidth:      "0",
      whiteSpace:    "normal",
      overflowWrap:  "break-word",
    });

    el.appendChild(icon);
    el.appendChild(text);
    document.body.appendChild(el);
    _activeToast = el;

    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0)";
    }));

    // Animate out and remove
    const timer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(() => { el.remove(); if (_activeToast === el) _activeToast = null; }, 200);
    }, duration);

    return () => { clearTimeout(timer); el.remove(); if (_activeToast === el) _activeToast = null; };
  };
})();

// ── Contacts ──────────────────────────────────────────────
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
const AVATAR_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
export function avatarColor(name) {
  if (!name) return '#94a3b8';
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Shared canvas for measuring typed-text width so the inline ghost prediction
// lines up exactly with the input's text regardless of font/padding.
const _cpCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
const _cpCtx = _cpCanvas ? _cpCanvas.getContext('2d') : null;
function _cpMeasure(text, font) { if (!_cpCtx) return 0; _cpCtx.font = font; return _cpCtx.measureText(text).width; }

/* ContactPicker — the Owner cell editor. NEW-1: owner is an ORDERED LIST of contacts, shown as
 * removable, reorderable chips; the FIRST chip is the accountable one (no separate "primary"
 * control — reordering IS how you correct it). `owners` is always an array (the caller normalizes
 * legacy data via ownerListOf before it ever reaches here).
 *
 * ⛔ B1341728 — THIS IS A WRITE-THROUGH (tokens-class) EDITOR: `onOwnersChange(namesArray,
 * newContacts)` fires the MOMENT a chip is added, removed or reordered, and `onClose()` merely
 * closes the editor. It used to hold the whole session in component state and hand it over in a
 * single `onCommit` at the end, with an `onCancel` that threw it away — and that is precisely the
 * defect the owner reported (2026-09-15): a chip is drawn in the FINISHED style, a pill with its
 * own remove control, so the person has every reason to read it as saved, while it was still
 * unsaved state that Escape discarded outright. Every discard path in this component exploited
 * that one gap, so the gap is closed rather than each path patched: what the editor renders as
 * finished IS what the task holds, at every instant, and no exit gesture — Escape, Enter, Tab,
 * click-away, or an unmount nobody asked for — can take it back. See CLAUDE.md's
 * EDITOR-EXIT-CONTRACT named rule, and ui-audit/verify-cell-editor-exit-contract.mjs, which asks
 * every editable cell in this grid the same question.
 *
 * WHAT ESCAPE MEANS NOW, stated because the two exits must not be left disagreeing: Escape
 * abandons only what is genuinely IN PROGRESS — a typed-but-unconfirmed fragment in the input —
 * and then, on a second press with nothing left to clear, closes the editor. It can no longer
 * revert chips, because chips are no longer pending. Ctrl+Z is the recovery for an add or a
 * removal made by mistake, the same as for every other cell edit in this grid.
 *
 * NEW-2 (folded in): a proposed new-contact NAME is guarded at the one place it is actually
 * created — a comma in it is refused outright (a comma is a chip DELIMITER, never a name
 * character — see the comma key handling below, which never lets one reach `query` by typing; the
 * guard here catches a comma that arrives some other way, e.g. a paste) — and a name that is a
 * PREFIX of an existing contact warns instead of silently minting a near-duplicate, requiring the
 * same confirming key again once the person has seen the warning.
 *
 * NEW-5 (folded in): creating a genuinely new contact is now ONE deliberate action — typing a full
 * name and pressing Enter (or comma, or clicking the dropdown's "+ Add" row) commits it immediately.
 * The earlier design asked TWICE (a dropdown affordance, then a separate "Add contact?" modal) —
 * that second step was pure friction, not caution: the friction lived only on the KEYBOARD path
 * (a mouse click on the dropdown row was already one action), which is the inconsistency that made
 * it feel like the confirmation kept reappearing. One path now, for both input methods.
 *
 * NEW-4 (folded in): position tracking is a rAF loop while the picker is open, not a scroll/resize
 * event listener — a `position:fixed` popup portaled to the iframe's own body cannot be kept
 * attached to its cell by any listener that can be starved or miss an event source; re-measuring
 * every frame is what "no perceptible lag" actually requires, on the SAME axis whether the scroll
 * came from a wheel, a scrollbar drag, a key, or a resize. The loop also flips the popup ABOVE the
 * cell when there is no room below, and closes the editor outright if the cell scrolls out of its
 * own scroll container — never leaving a popup floating over a frozen header or hanging off-grid.
 */
export function ContactPicker({ owners, seedText, contacts, onOwnersChange, onClose, variant = "master" }) {
  const isGrid = variant === "grid";
  const initialOwners = React.useMemo(() => (Array.isArray(owners) ? owners : (owners ? [owners] : [])), []); // seed once
  const [chips, setChips] = React.useState(initialOwners);
  const [query, setQuery] = React.useState(seedText || '');
  const [highlight, setHighlight] = React.useState(-1);
  const [ghost, setGhost] = React.useState(null);   // {left, fontSize, fontFamily, fontWeight}
  const [warn, setWarn] = React.useState(null);     // {kind:'comma'|'prefix'|'cap', text}
  const [dragIdx, setDragIdx] = React.useState(null);
  const lastPrefixWarnedFor = React.useRef(null);
  const newContactsRef = React.useRef([]);          // collected across the whole editing session
  const inputRef = React.useRef(null);
  const wrapRef = React.useRef(null);
  const closedRef = React.useRef(false);            // guards against a double-close (rAF close + blur)
  // The chip list as last WRITTEN THROUGH to the task. Every mutation is compared against it so a
  // no-op (re-adding a name already there, closing with nothing changed) never writes — a
  // redundant write would still be a real setData, i.e. a wasted undo step and a wasted save.
  const lastWrittenRef = React.useRef(initialOwners);
  /* The LIVE chip list and the LIVE typed fragment, mirrored into refs every render. `finishEditing`
   * can be reached from the rAF position loop, whose closure is only as fresh as the last time that
   * effect re-ran ([totalItems]) — a chip added since then would otherwise be invisible to it, and
   * the leftover fold below would write a list one name short. Reading refs makes that path exact. */
  const chipsRef = React.useRef(initialOwners);
  const queryRef = React.useRef(seedText || '');

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length; el.setSelectionRange(n, n);   // caret after any seeded character
  }, []);

  const chipSet = React.useMemo(() => new Set(chips.map(c => c.toLowerCase())), [chips]);
  chipsRef.current = chips;
  queryRef.current = query;
  const q = query.trim().toLowerCase();
  const suggestions = (q
    ? contacts.filter(c => !chipSet.has(c.name.toLowerCase()) && (c.name.toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q)))
    : contacts.filter(c => !chipSet.has(c.name.toLowerCase()))
  ).slice(0, 6);

  const trimmed = query.trim();
  const isNewName = trimmed.length > 0 && !contacts.some(c => ownerKey(c.name) === ownerKey(trimmed));
  const atCap = chips.length >= OWNER_CAP;
  const totalItems = suggestions.length + (isNewName ? 1 : 0);

  // Inline prediction = first contact whose name starts with what's typed (prefix match)
  const prediction = query
    ? contacts.find(c => c.name.toLowerCase().startsWith(query.toLowerCase()) && c.name.length > query.length && !chipSet.has(c.name.toLowerCase()))
    : null;
  const ghostText = prediction ? prediction.name.slice(query.length) : '';

  React.useEffect(() => { setHighlight(h => h >= totalItems ? -1 : h); }, [totalItems]);
  React.useEffect(() => { lastPrefixWarnedFor.current = null; setWarn(w => (w && w.kind === "prefix") ? null : w); }, [query]);

  // Compute the ghost-text offset (font-metrics dependent; only needs the input's OWN metrics, so
  // it is fine to recompute on every query change rather than every frame).
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const fontFamily = cs.fontFamily, fontSize = cs.fontSize, fontWeight = cs.fontWeight || '400';
    const padL = parseFloat(cs.paddingLeft) || 0;
    const bordL = parseFloat(cs.borderLeftWidth) || 0;
    const w = _cpMeasure(query, `${fontWeight} ${fontSize} ${fontFamily}`);
    setGhost({ left: padL + bordL + w, fontSize, fontFamily, fontWeight });
  }, [query]);

  /* NEW-4 — track the cell every frame while the picker is open, and close (committing whatever is
   * final) the instant the cell scrolls out of view. NEW-1 / B2465520 MOVED this loop into the shared
   * `useAnchoredPopover` (the grid's other cell popovers had no tracking at all and floated off their
   * cell on scroll) — what stays here is only THIS popup's placement: it flips ABOVE the cell when there
   * is no room below. The hook also closes it when the cell goes UNDER the sticky header or a pinned
   * column, which the private loop this replaced did not know about. `place` reads the live item count
   * through the hook's ref, so it is never a render behind. */
  const pos = useAnchoredPopover(true, inputRef, r => {
    const popupH = Math.min(260, 40 + totalItems * 40);   // rough estimate; only decides which side to open on
    const roomBelow = window.innerHeight - r.bottom;
    const above = roomBelow < popupH + 8 && r.top > popupH + 8;
    return { left: Math.round(r.left), top: above ? Math.round(r.top - popupH - 2) : Math.round(r.bottom + 2),
      width: Math.max(240, r.width), above };
  }, () => finishEditing());   // scrolled fully out of view — never float over the header

  /* THE ONE WRITE PATH (B1341728). Every chip mutation goes through here, immediately — there is
   * no deferred "final" list to lose. `newContact` is handed over in the SAME call that assigns
   * it, so a brand-new person can never be created-but-unassigned (the quieter second leak of the
   * old deferred design: on Escape the chip AND the contact both vanished). */
  function writeThrough(next, newContact) {
    const news = newContact ? [newContact] : [];
    if (news.length) newContactsRef.current = [...newContactsRef.current, ...news];
    const prev = lastWrittenRef.current;
    const same = prev.length === next.length && prev.every((n, i) => n === next[i]);
    if (same && !news.length) return;
    lastWrittenRef.current = next;
    onOwnersChange(next, news);
  }

  function closeEditor() {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }

  function finishEditing() {
    if (closedRef.current) return;
    // A recognized leftover (typed but never explicitly committed) is kept rather than dropped —
    // an unrecognized one is discarded silently (NEVER auto-created on blur/close: that is the
    // original NEW-1 protection this redesign keeps in full). It is the ONLY thing left that this
    // exit decides; every chip is already written. Read the LIVE chips/query off the refs, never the
    // closure — see their declaration for the rAF path that makes the difference.
    const liveChips = chipsRef.current;
    const liveTrimmed = String(queryRef.current || "").trim();
    if (liveTrimmed) {
      const lower = liveTrimmed.toLowerCase();
      const existing = contacts.find(c => ownerKey(c.name) === lower);
      const already = liveChips.some(n => ownerKey(n) === lower);
      if (existing && !already) writeThrough([...liveChips, existing.name]);
    }
    closeEditor();
  }

  function addChip(name, newContact) {
    const n = String(name || "").trim();
    if (!n) return;
    if (chipSet.has(n.toLowerCase())) { setQuery(""); setWarn(null); return; }   // already an owner — quiet no-op
    if (atCap) { setWarn({ kind: "cap", text: `Owner is capped at ${OWNER_CAP} people — remove one to add another.` }); return; }
    const next = [...chips, n];
    setChips(next);
    writeThrough(next, newContact);
    setQuery(""); setWarn(null); setHighlight(-1);
    requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
  }

  function removeChip(i) {
    const next = chips.filter((_, idx) => idx !== i);
    setChips(next);
    writeThrough(next);
  }

  function reorderChips(from, to) {
    if (from === to || from == null || to == null) return;
    const next = [...chips]; const [m] = next.splice(from, 1); next.splice(to, 0, m);
    setChips(next);
    writeThrough(next);
  }

  // The ONE deliberate action that mints a new contact (NEW-5) — reached from Enter/comma on the
  // keyboard AND from clicking the dropdown's "+ Add" row, so both input methods behave alike.
  function attemptCreate(name) {
    if (name.includes(",")) {
      setWarn({ kind: "comma", text: `A contact name can't contain a comma — that's how two people become one. Use comma or Enter to add each person separately.` });
      return;
    }
    const prefixHit = contacts.find(c => c.name.toLowerCase().startsWith(name.toLowerCase()) && c.name.length > name.length);
    if (prefixHit && lastPrefixWarnedFor.current !== name.toLowerCase()) {
      lastPrefixWarnedFor.current = name.toLowerCase();
      setWarn({ kind: "prefix", text: `"${prefixHit.name}" already exists — press Enter again to add "${name}" anyway, or → to use that instead.` });
      return;
    }
    addChip(name, { name, email: "" });
  }

  function selectItem(i) { if (i < suggestions.length) addChip(suggestions[i].name); else attemptCreate(trimmed); }
  function acceptGhost() {
    if (!prediction) return;
    addChip(prediction.name);
  }

  /* Outside click finishes editing (commits the final chip list). Clicks inside the popup are
   * ignored — they are handled by the popup's own handlers. */
  React.useEffect(() => {
    function onDocMouseDown(e) {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-contact-dd]')) return;
      finishEditing();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, chips]);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (warn) { setWarn(null); lastPrefixWarnedFor.current = null; return; }   // dismiss the warning, keep editing
      if (query) { setQuery(""); return; }   // clear a typed-but-unconfirmed fragment — the only
                                              // thing in this editor that is genuinely in progress
      // B1341728 — nothing left to clear, so just LEAVE. Escape no longer reverts the chips: they
      // were written to the task the instant they were added, so there is nothing pending to
      // abandon and nothing for this key to destroy. (It used to run a revert-the-whole-session
      // path here, which threw away every owner chosen during the edit — the reported bug.)
      closeEditor();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, totalItems - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, -1)); return; }
    if (e.key === 'ArrowRight') {
      const el = inputRef.current;
      const atEnd = el && el.selectionStart === query.length && el.selectionEnd === query.length;
      if (ghostText && atEnd) { e.preventDefault(); acceptGhost(); }
      return;
    }
    if (e.key === 'Backspace' && !query && chips.length) { e.preventDefault(); removeChip(chips.length - 1); return; }
    if (e.key === ',') {
      e.preventDefault(); e.stopPropagation();
      if (trimmed) { if (highlight >= 0 && highlight < totalItems) selectItem(highlight); else attemptCreate(trimmed); }
      return;
    }
    // Tab always FINISHES editing outright (same as clicking away) — Tab conventionally means
    // "leave this field," so it never leaves the popup hanging open the way Enter deliberately
    // does. Any not-yet-confirmed NEW name is discarded exactly like a blur (finishEditing only
    // folds in an EXACT match — creating a brand-new contact still needs its own Enter first, so
    // Tab can never be the single keystroke that mints one).
    if (e.key === 'Tab') { e.stopPropagation(); finishEditing(); return; }
    if (e.key === 'Enter') {
      e.stopPropagation(); e.preventDefault();
      if (!trimmed) { finishEditing(); return; }   // Enter on an empty input = done editing
      if (highlight >= 0 && highlight < totalItems) { selectItem(highlight); return; }
      // Only accept the prefix prediction when the typed text isn't ALREADY an exact contact —
      // typing "Sam" exactly (with "Samuel Jones" also on file) must add Sam, not the longer ghost.
      if (ghostText && prediction && isNewName) { addChip(prediction.name); return; }
      const existing = contacts.find(c => ownerKey(c.name) === ownerKey(trimmed));
      if (existing) { addChip(existing.name); return; }
      attemptCreate(trimmed);
      return;
    }
  }

  const masterInputStyle = { display:'block', width:'100%', height:'18px', border:'none', borderBottom:'1.5px solid var(--blue)',
    outline:'none', background:'transparent', color:'var(--txt)', fontSize:12, fontFamily:'inherit', padding:'0 2px' };

  const popup = pos ? ReactDOM.createPortal(
    <div data-contact-dd data-owner-popup {...MENU_STOPS_GRID} style={{position:'fixed', left:pos.left, top:pos.top, width:pos.width, zIndex:100000,
      background:'var(--bg)', border:'1px solid var(--bd2)', borderRadius:7, boxShadow:'0 6px 20px rgba(0,0,0,.13)',
      display:'flex', flexDirection: pos.above ? 'column-reverse' : 'column', overflow:'hidden', maxHeight:280}}>
      {chips.length > 0 && (
        <div data-owner-chips style={{display:'flex', flexWrap:'wrap', gap:5, padding:'8px 9px', borderBottom:'1px solid var(--bd)'}}>
          {chips.map((name, i) => (
            <span key={name + i} data-owner-chip draggable
              onDragStart={e=>{ e.dataTransfer.effectAllowed='move'; setDragIdx(i); }}
              onDragOver={e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; }}
              onDrop={e=>{ e.preventDefault(); reorderChips(dragIdx, i); setDragIdx(null); }}
              onDragEnd={()=>setDragIdx(null)}
              title={i === 0 ? "Accountable owner — drag another chip here to change" : "Drag to reorder"}
              style={{display:'inline-flex', alignItems:'center', gap:5, padding:'2px 4px 2px 8px', borderRadius:12,
                background: i === 0 ? '#eef2ff' : '#f3f4f6', border: i === 0 ? '1px solid #c7d2fe' : '1px solid var(--bd2)',
                fontSize:11.5, color:'var(--txt)', cursor:'grab', opacity: dragIdx===i ? 0.4 : 1}}>
              {name}
              <span data-owner-chip-remove onMouseDown={e=>{ e.preventDefault(); e.stopPropagation(); removeChip(i); }}
                style={{display:'inline-flex', alignItems:'center', justifyContent:'center', width:14, height:14, borderRadius:'50%',
                  color:'var(--mut)', cursor:'pointer', fontSize:11, lineHeight:1}}>×</span>
            </span>
          ))}
        </div>
      )}
      {warn && (
        <div data-owner-warn style={{fontSize:11, color: warn.kind === "cap" ? "var(--mut)" : "#b45309", background: warn.kind === "cap" ? "var(--surf)" : "#fffbeb",
          padding:'7px 10px', lineHeight:1.4, borderBottom:'1px solid var(--bd)'}}>{warn.text}</div>
      )}
      {(suggestions.length > 0 || isNewName) && (
        <div style={{overflowY:'auto', maxHeight:220}}>
          {suggestions.map((c, i) => (
            <div key={c.id}
              onMouseEnter={()=>setHighlight(i)}
              onMouseDown={e=>{ e.preventDefault(); addChip(c.name); }}
              style={{display:'flex', alignItems:'center', gap:8, padding:'7px 10px', cursor:'pointer',
                background: highlight===i ? '#f0f2ff' : 'transparent'}}>
              <div style={{width:24,height:24,borderRadius:'50%',background:avatarColor(c.name),
                display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'#fff',flexShrink:0}}>{getInitials(c.name)}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12,color:'var(--txt)',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
                {c.email && <div style={{fontSize:10,color:'var(--mut)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.email}</div>}
              </div>
            </div>
          ))}
          {isNewName && (
            <div data-owner-add-new onMouseEnter={()=>setHighlight(suggestions.length)}
              onMouseDown={e=>{ e.preventDefault(); attemptCreate(trimmed); }}
              style={{display:'flex', alignItems:'center', gap:7, padding:'7px 10px', cursor:'pointer',
                borderTop: suggestions.length ? '1px solid var(--bd)' : 'none',
                color:'var(--blue)', fontSize:11, fontWeight:500,
                background: highlight===suggestions.length ? '#f0f5ff' : 'transparent'}}>
              <span style={{fontSize:14,lineHeight:1}}>+</span>
              <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Add "<span style={{fontWeight:600}}>{trimmed}</span>" as new contact</span>
            </div>
          )}
        </div>
      )}
    </div>, document.body) : null;

  return (
    <div ref={wrapRef} style={{position:'relative', width:'100%'}}>
      <input {...NO_AUTOFILL} ref={inputRef} value={query}
        className={isGrid ? "ei" : undefined}
        style={isGrid ? undefined : masterInputStyle}
        onChange={e=>{ setQuery(e.target.value); }}
        onKeyDown={onKeyDown}
        placeholder={chips.length ? "Add another…" : "Type a name…"} />
      {ghostText && ghost && (
        <span aria-hidden style={{position:'absolute', left:ghost.left, top:0, height:'100%',
          display:'flex', alignItems:'center', pointerEvents:'none', whiteSpace:'pre',
          fontSize:ghost.fontSize, fontFamily:ghost.fontFamily, fontWeight:ghost.fontWeight,
          color:'var(--mut)', opacity:0.5, overflow:'hidden',
          maxWidth:`calc(100% - ${ghost.left}px - 4px)`}}>{ghostText}</span>
      )}
      {popup}
    </div>
  );
}

// Shared column-autosize measurement (B255). Both the per-project grid
// (autoSizeCol) and the master multi-project list (autoSizeMCol) size a column to
// the widest of its header + its cell strings, at the grid's header/body fonts,
// with 24px of padding and a per-view minimum floor. The two callers keep their
// own column-value extraction + width-persistence (their column sets have drifted
// apart); this collapses the identical canvas-measure skeleton they duplicated.
export function measuredColWidth(headerLabel, cellValues, floor) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = "bold 10px Inter, system-ui, sans-serif";
  let maxW = ctx.measureText(String(headerLabel || "").toUpperCase()).width + 24;
  ctx.font = "12px Inter, system-ui, sans-serif";
  for (const val of cellValues) {
    if (val) maxW = Math.max(maxW, ctx.measureText(val).width + 24);
  }
  return Math.max(floor, Math.ceil(maxW));
}

// ── DepCell ───────────────────────────────────────────────
// `flagged` (B443249) marks an entry that contributes NOTHING to the derived date — a predecessor with no
// dates of its own, or an id with no row left in this project. Such an entry used to render identically to
// a satisfied one, so a date computed from a SUBSET of its inputs looked exactly like a real one.
//
// B655552 shipped two lines gated on a 24px threshold (10px font / 12px line-height, "measured" —
// which is what 1.2x line-height naturally renders for a 10px font). The owner's row-height slider
// floor is 20px, and his OWN saved setting (confirmed via Supabase: settings.rowHeight === 20) sits
// AT that floor — 4px short of the threshold — so every predecessor/successor cell on his real
// schedule fell back to the "one line + '+N'" degradation. That fallback was never something he
// asked for; his spec, restated three times, is two lines, unconditionally. B655552 (round 2) (2026-08-25) —
// re-measured with the REAL Inter font (not a fallback sans-serif) via a live headless render of
// this page: for THIS font, the natural non-clipping line-height is exactly font-size + 2px at every
// size tested (10→12, 9→11, 8→10, 7→9 — anything tighter clips, confirmed both ways). So the fix
// is not a bigger row — the owner explicitly chose to shrink the cell's OWN text instead, after
// being shown the alternative (a taller row, changing the whole grid) and picking this trade-off
// knowingly. DEPCELL_FONT_SIZE 8 / DEPCELL_LINE_H 10 is the largest size in that safe series whose
// two-line total (20px) still fits his floor with zero clipping — same box-equals-ink relationship
// the original 10/12 pair already shipped safely at, just smaller. This makes `canTwoLine` true
// across the ENTIRE 20–34 row-height slider range in the grid/split view (s.height is ROW_H there,
// clamped to that range) — the one-line "+N" fallback below is now reachable ONLY from MasterView's
// own DepCell call site, whose `s` carries no `height` at all (a separate, pre-existing, narrower
// list view outside this report's scope — left untouched). The font size is intentionally FIXED
// across the whole slider range rather than scaling up with extra room: the original design never
// scaled with ROW_H either (10px/12px was constant from 24 all the way to 34), and a size that
// changes with an unrelated setting would be a new, untested variant — the exact thing this rule
// exists to prevent (see the B655552 defect-B history above).
//
// B655552 (round 2) also adds the hover requirement: `title` on the cell now always lists every item's FULL
// label + name (untruncated, one per line via the native tooltip), not just the flagged/lag-hint
// text the caller may also supply (which is appended below the list, not replaced). A native
// `title` was chosen over a positioned overlay specifically because this grid has a history of
// overlays swallowing presses meant for the cell underneath (CHROME-NEVER-EATS-A-PRESS) — the
// browser's own tooltip never participates in hit-testing, so it cannot intercept the double-click
// that opens the predecessor editor, cannot conflict with the existing "+N" hover popup below, and
// needs no new interaction-safety proof.
const DEPCELL_FONT_SIZE = 8;                    // largest size whose natural line-height fits the 20px floor
const DEPCELL_LINE_H = 10;                      // 8px font-size's own natural (non-clipping) line-height, measured
const DEPCELL_TWO_LINE_MIN_H = DEPCELL_LINE_H * 2; // = 20px — matches the row-height slider's floor exactly
function depCellFullTitle(items, renderLabel, renderName, extraNote) {
  const list = items.map(item => `${renderLabel(item)} · ${renderName(item)}`).join("\n");
  return extraNote ? `${list}\n\n${extraNote}` : list;
}
// B2132257 — the owner's answer: two lines at every normal width, ONE line only when this column is
// too narrow for the two-line form to read. Driven by the cell's OWN measured width (a ResizeObserver on
// the cell, never the window), so Split's grid pane and a user-resized column behave the same. The
// two-line form needs the label's hanging indent (up to ~38px for "20FS+360d") PLUS a readable run of
// name on the continuation line; below ~110px that run is a word or two, and "24 · Find and send…" on
// one line reads better. The default column is 148px, so it stays two-line. Hysteresis (enter one-line
// under 110, leave it only at 126 or wider) stops a cell flickering when a drag parks on the boundary.
const DEPCELL_ONE_LINE_BELOW = 110;
const DEPCELL_TWO_LINE_AT = 126;
function depCellNarrowNext(prevNarrow, width) {
  if (!(width > 0)) return prevNarrow;               // not laid out yet — keep what we had
  if (width < DEPCELL_ONE_LINE_BELOW) return true;
  if (width >= DEPCELL_TWO_LINE_AT) return false;
  return prevNarrow;                                  // inside the dead band: hold
}
export function DepCell({items, renderLabel, renderName, s, title, flagged}) {
  const [hovered, setHovered] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [cellEl, setCellEl] = useState(null);
  const ref = useRef(null);
  const setRef = useCallback(el => { ref.current = el; setCellEl(el); }, []);
  React.useLayoutEffect(() => {
    if (!cellEl) return;
    const measure = () => setNarrow(prev => depCellNarrowNext(prev, cellEl.offsetWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(cellEl);
    return () => ro.disconnect();
  }, [cellEl]);
  const canTwoLine = (s.height || 0) >= DEPCELL_TWO_LINE_MIN_H;
  const visibleCount = canTwoLine && !narrow ? 2 : 1;
  const extra = items.length - visibleCount;

  // NEW-1 — the "+N" list follows its cell and drops when the cell leaves the visible grid.
  const pos = useAnchoredPopover(hovered && extra > 0, ref, r => ({top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220)}), () => setHovered(false));
  const onEnter = () => {
    if (!ref.current || items.length <= visibleCount) return;
    setHovered(true);
  };

  if (!items.length) return <span ref={setRef} style={{...s}} />;

  const fullTitle = depCellFullTitle(items, renderLabel, renderName, title);

  // Exactly one link, with room for a second line: let the name WRAP into the otherwise-unused
  // second line instead of ellipsizing on line 1 while line 2 sits empty.
  if (items.length === 1 && canTwoLine && !narrow) {
    const item = items[0];
    // B655552 (round 3) — a HANGING INDENT: without it, a wrapped continuation line starts flush
    // left under the ID/lag label, so it visually reads as a second entry rather than the tail of
    // the one above it — exactly the ambiguity this whole cell exists to avoid (one link wrapped to
    // two lines vs. two separate links, one per line, must never be confusable at a glance). The
    // indent must be MEASURED per item, not a fixed guess: `renderLabel(item)` ranges from a bare
    // 2-digit id ("24") to a lag-suffixed label several times wider ("20FS+360d"), so a constant
    // tuned for one is wrong for the other by construction. `_cpMeasure` is the same shared canvas
    // text-measurement helper already used elsewhere in this file (ContactPicker's ghost-text
    // alignment) for exact pixel alignment — reused here rather than inventing a second mechanism.
    // The classic CSS hanging-indent pair (`padding-left` + equal-and-opposite `text-indent`) shifts
    // every line right by `indent`, then pulls line 1 back to its original position — so line 1 is
    // pixel-identical to before, and only the WRAPPED line 2 sits indented under the name text.
    const prefixText = (flagged && flagged(item) ? "⚠ " : "") + renderLabel(item);
    const indent = _cpMeasure(prefixText, `500 ${DEPCELL_FONT_SIZE}px 'Inter', system-ui, sans-serif`)
      + _cpMeasure(" · ", `${DEPCELL_FONT_SIZE}px 'Inter', system-ui, sans-serif`);
    return (
      <div ref={setRef} data-dep-lines="2" title={fullTitle} style={{...s, alignItems:"flex-start", padding:"0 8px", whiteSpace:"normal"}}>
        <span style={{display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
          overflow:"hidden", maxHeight:DEPCELL_LINE_H*2, lineHeight:`${DEPCELL_LINE_H}px`, fontSize:DEPCELL_FONT_SIZE, fontFamily:"'Inter',system-ui,sans-serif",
          whiteSpace:"normal", width:"100%", minWidth:0, wordBreak:"break-word",
          paddingLeft:indent, textIndent:-indent}}>
          <span style={{color: flagged && flagged(item) ? "var(--warn-text,#a16207)" : "#1d4ed8", fontWeight:500}}>{flagged && flagged(item) ? "⚠ " : ""}{renderLabel(item)}</span>
          <span style={{color:"var(--mut)"}}> · {renderName(item)}</span>
        </span>
      </div>
    );
  }

  const slots = Array.from({length: visibleCount}, (_, i) => items[i] ?? null);

  return (
    <>
      <div ref={setRef} title={fullTitle} data-dep-lines={narrow ? "1" : "2"}
        style={{...s, flexDirection:"column", alignItems:"flex-start", justifyContent: narrow ? "center" : "flex-start", gap:0, padding:"0 8px"}}
        onMouseEnter={onEnter} onMouseLeave={() => setHovered(false)}>
        {slots.map((item, i) => (
          <div key={i} style={{display:"flex", alignItems:"baseline", gap:3, overflow:"hidden", width:"100%", lineHeight:`${DEPCELL_LINE_H}px`, minHeight:DEPCELL_LINE_H}}>
            {item != null && <>
              <span style={{fontSize:DEPCELL_FONT_SIZE, color: flagged && flagged(item) ? "var(--warn-text,#a16207)" : "#1d4ed8", fontFamily:"'Inter',system-ui,sans-serif", fontWeight:500, flexShrink:0}}>{flagged && flagged(item) ? "⚠ " : ""}{renderLabel(item)}</span>
              <span style={{fontSize:DEPCELL_FONT_SIZE, color:"var(--mut)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1}}>· {renderName(item)}</span>
              {i === visibleCount - 1 && extra > 0 &&
                <span style={{fontSize:DEPCELL_FONT_SIZE, color:"#94a3b8", flexShrink:0, marginLeft:3, fontFamily:"'Inter',system-ui,sans-serif"}}>+{extra}</span>}
            </>}
          </div>
        ))}
      </div>
      {hovered && extra > 0 && pos && ReactDOM.createPortal(
        <div {...MENU_STOPS_GRID}
          style={{position:"fixed", top:pos.top, left:pos.left, minWidth:pos.width, background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:6, padding:"8px 10px", zIndex:9999, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", display:"flex", flexDirection:"column", gap:5}}
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
          {items.map((item, i) => (
            <div key={i} style={{display:"flex", alignItems:"baseline", gap:5}}>
              <span style={{fontSize:11, color:"#1d4ed8", fontFamily:"'Inter',system-ui,sans-serif", fontWeight:500, flexShrink:0}}>{renderLabel(item)}</span>
              <span style={{fontSize:11, color:"var(--mut)", whiteSpace:"nowrap"}}>· {renderName(item)}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  NO_AUTOFILL: [() => NO_AUTOFILL],
  CONTACT_TOKENS: [() => CONTACT_TOKENS],
  contactField: [() => contactField],
  MENU_STOPS_GRID: [() => MENU_STOPS_GRID],
  anchorHidden: [() => anchorHidden],
  anchorSurroundings: [() => anchorSurroundings],
  useAnchoredPopover: [() => useAnchoredPopover],
  BASE_HEALTH: [() => BASE_HEALTH],
  BASE_HK: [() => BASE_HK],
  BASE_HDARK: [() => BASE_HDARK],
  HEALTH: [() => HEALTH, (v) => { HEALTH = v; }],
  HK: [() => HK, (v) => { HK = v; }],
  HDARK: [() => HDARK, (v) => { HDARK = v; }],
  rebuildHEALTH: [() => rebuildHEALTH],
  showToast: [() => showToast],
  getInitials: [() => getInitials],
  AVATAR_COLORS: [() => AVATAR_COLORS],
  avatarColor: [() => avatarColor],
  _cpCanvas: [() => _cpCanvas],
  _cpCtx: [() => _cpCtx],
  _cpMeasure: [() => _cpMeasure],
  ContactPicker: [() => ContactPicker],
  measuredColWidth: [() => measuredColWidth],
  DEPCELL_FONT_SIZE: [() => DEPCELL_FONT_SIZE],
  DEPCELL_LINE_H: [() => DEPCELL_LINE_H],
  DEPCELL_TWO_LINE_MIN_H: [() => DEPCELL_TWO_LINE_MIN_H],
  depCellFullTitle: [() => depCellFullTitle],
  DEPCELL_ONE_LINE_BELOW: [() => DEPCELL_ONE_LINE_BELOW],
  DEPCELL_TWO_LINE_AT: [() => DEPCELL_TWO_LINE_AT],
  depCellNarrowNext: [() => depCellNarrowNext],
  DepCell: [() => DepCell],
});
