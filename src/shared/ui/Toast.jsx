/* Reusable toast stack (B673) — the loud-but-NON-BLOCKING conflict surface for element-level
 * sync, and a general notice rail for any workspace. Design rules (owner, 2026-06-21): solid
 * fill + weight for hierarchy, never faded text; theme tokens only, no raw hex; RED is reserved
 * for genuine alert (--danger), so informational conflict notices ride the raised surface with
 * the warn-amber accent bar. Non-blocking by design: with per-element last-write-wins nothing is
 * lost, so a toast informs (and offers an action like Restore) — it never gates editing.
 *
 * Anatomy: fixed stack (bottom-center), max TOAST_CAP visible + a "+n more" button that expands the stack; each toast
 * auto-dismisses after ttlMs, HOVER-HOLD pauses its timer (mouse over = keep it while reading);
 * an optional action button (e.g. "Restore", "Show") rides on the right. role="status" so screen
 * readers announce without stealing focus.
 *
 * Pure helpers (pushToast/visibleToasts) are exported for unit tests; the host component is
 * MODULE-SCOPE (never define components inside a render body — the remount/focus-loss class).
 */
import { useRef, useState, useEffect, useLayoutEffect, useCallback, useSyncExternalStore } from "react";
import { RADIUS } from "./radius.js";
import { FONT_SIZE } from "./designTokens.js";
import FloatingNotice from "./FloatingNotice.jsx";

export const TOAST_TTL_MS = 8000;
// NEW-1 (B673 round 2, 2026-08-23) — lowered from 4. A single delete cascading across a bonded
// assembly used to be able to push FOUR banners on screen at once (plus a "+n more" pill) — a wall
// of notices reaching well up the canvas from a single gesture. Two upstream fixes now make that
// wall itself rare (elementSync.js's NEW-0 gate silences same-account echoes at the source, and
// SitePlanner.jsx's per-gesture coalescing folds every sync event from ONE commit batch into ONE
// toast), so this cap is a backstop for whatever is left, not the primary defense — kept low so a
// stack that DOES form still reads as a short strip pinned to the bottom edge, not an obstruction.
export const TOAST_CAP = 2;

let toastSeq = 0;

/* ⛔ ROUND EIGHT (B1482353) — SINGLE-INSTANCE NOTICES. A notice that describes a STATE the app
 * is in ("this tab is out of date") is not the same kind of thing as a notice that describes an
 * EVENT that happened ("a building you edited changed"). Two of the second kind are two pieces of
 * news; two of the first are one fact said twice, and the owner photographed exactly that — two
 * identical "This tab is out of date" banners plus a "+1 more" pill, over his canvas, on a plan
 * four minutes old with one tab and one account.
 *
 * A toast carrying `dedupeKey` REPLACES any toast already holding that key, IN PLACE, instead of
 * appending: same slot, same position in the stack, refreshed text/action, and the item's `id` is
 * preserved so React keeps the same `ToastItem` mounted and its lifetime timer is not restarted by
 * the repeat (a state that keeps re-asserting itself must not become un-dismissable). Toasts with
 * no `dedupeKey` behave exactly as before — appended, newest last, nothing about the event-notice
 * path changes.
 *
 * This lives in the SHARED primitive, not in the site planner, because the same class of message
 * is raised by more than one surface and the next one to grow a copy would otherwise re-inherit
 * the bug. See the surface table in the PR body / BACKLOG item. */
export function pushToastPure(list, toast) {
  const l = list || [];
  if (toast && toast.dedupeKey != null) {
    const i = l.findIndex((t) => t && t.dedupeKey === toast.dedupeKey);
    if (i >= 0) {
      const next = l.slice();
      // same slot, same id → no remount, no timer restart. `renew: true` (the Site Planner's merged undo toast,
      // lib/undoToast.js) asks for a FRESH id instead: same slot, but its lifetime starts over, because the toast now
      // describes a newer action ("Deleted 3 parcels" after "Deleted 2 parcels") the person has only just done.
      next[i] = { ...l[i], ...toast, id: toast.renew ? "t" + ++toastSeq : l[i].id };
      return next;
    }
  }
  const t = { ttlMs: TOAST_TTL_MS, ...toast, id: toast.id != null ? toast.id : "t" + ++toastSeq };
  return [...l, t];
}

// Pure: how many toasts in a list carry a given dedupe key. The invariant this module now
// guarantees is that this is never more than 1 — asserted directly in test/toastDedupe.test.js.
export function countByDedupeKey(list, key) {
  return (list || []).filter((t) => t && t.dedupeKey === key).length;
}

// Pure: what renders — the first CAP toasts plus how many are hidden behind "+n more". With
// `expanded` (the person pressed "+n more", NEW-1 2026-11-25) EVERY toast renders and `canCollapse`
// says whether a "Show fewer" control belongs under them. Expansion only means something while the
// list is longer than the cap: once expiry/dismissal brings it back to the cap or below, the stack
// is simply collapsed again (`expanded` false) so the NEXT overflow starts as the short strip.
export function visibleToasts(list, cap = TOAST_CAP, expanded = false) {
  const l = list || [];
  const over = l.length > cap;
  if (expanded && over) return { shown: l, more: 0, expanded: true, canCollapse: true };
  return { shown: l.slice(0, cap), more: Math.max(0, l.length - cap), expanded: false, canCollapse: false };
}

// Hook: the toast list + push/dismiss. Auto-dismiss timing lives in the item component so
// hover-hold can pause per toast.
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => setToasts((l) => pushToastPure(l, t)), []);
  const dismiss = useCallback((id) => setToasts((l) => l.filter((t) => t.id !== id)), []);
  // Withdraw a toast by its `dedupeKey` (a notice whose condition has ended must not outlive it).
  const dismissByKey = useCallback((key) => setToasts((l) => (l.some((t) => t && t.dedupeKey === key) ? l.filter((t) => !t || t.dedupeKey !== key) : l)), []);
  return { toasts, pushToast: push, dismissToast: dismiss, dismissByKey };
}

/* The APP-LEVEL toast store (audit I6). One list, mounted once by the shell through `AppToastHost`;
 * any workspace raises a notice with `useToast().show({...})` instead of mounting its own floating
 * box. Same rules as the per-surface `useToasts` (dedupeKey replaces in place, TTL + hover-hold, cap).
 * A toast may carry `testId` (replaces the default "sync-toast" hook so a surface's own checks keep
 * finding it) and `onClose` (called when the person presses the ✕, so the owner of the state clears it). */
let appToasts = [];
const appListeners = new Set();
const emitApp = () => { for (const l of appListeners) l(); };
const appSubscribe = (l) => { appListeners.add(l); return () => appListeners.delete(l); };
const appSnapshot = () => appToasts;
const appApi = {
  show(t) { appToasts = pushToastPure(appToasts, t); emitApp(); },
  dismiss(id) { const n = appToasts.filter((t) => t.id !== id); if (n.length !== appToasts.length) { appToasts = n; emitApp(); } },
  dismissByKey(key) { const n = appToasts.filter((t) => !t || t.dedupeKey !== key); if (n.length !== appToasts.length) { appToasts = n; emitApp(); } },
};
export function useToast() { return appApi; }
/* One module's single "current notice" line as an app toast (audit M2). Returns `setNotice(text)`: a non-empty string shows it
 * (a new one REPLACES the last, in place — the `dedupeKey`), "" / null clears it, and the toast is withdrawn when the module
 * unmounts so a notice never outlives the surface that raised it. `testId` keeps a surface's own checks finding it. */
export function useNoticeToast(key, { testId, ttlMs = 15000 } = {}) {
  useEffect(() => () => appApi.dismissByKey(key), [key]);
  return useCallback((text) => {
    if (text) appApi.show({ text: String(text), dedupeKey: key, testId, ttlMs });
    else appApi.dismissByKey(key);
  }, [key, testId, ttlMs]);
}
export function AppToastHost() {
  const list = useSyncExternalStore(appSubscribe, appSnapshot, appSnapshot);
  const close = useCallback((id) => appApi.dismiss(id), []);
  return <ToastHost toasts={list} onDismiss={close} />;
}
// Test seam: empty the app-level list.
export function resetAppToasts() { appToasts = []; emitApp(); }

// One toast row. Its lifetime timer PAUSES while hovered (hover-hold) and resumes with the
// remaining time on leave.
function ToastItem({ toast, onDismiss }) {
  const remainRef = useRef(toast.ttlMs || TOAST_TTL_MS);
  const startedRef = useRef(0);
  const timerRef = useRef(null);
  const arm = useCallback(() => {
    startedRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(toast.id), remainRef.current);
  }, [onDismiss, toast.id]);
  const hold = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    remainRef.current = Math.max(1000, remainRef.current - (Date.now() - startedRef.current));
  };
  useEffect(() => { arm(); return () => { if (timerRef.current) clearTimeout(timerRef.current); }; }, [arm]);
  const [held, setHeld] = useState(false);
  return (
    <div
      role="status"
      data-testid={toast.testId || "sync-toast"}
      onMouseEnter={() => { hold(); setHeld(true); }}
      onMouseLeave={() => { arm(); setHeld(false); }}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "var(--surface-raised)", color: "var(--text-primary)",
        border: "1px solid var(--border-strong)", borderLeft: "4px solid var(--warn-text)",
        borderRadius: 8, padding: "9px 12px", fontSize: 12.5, fontWeight: 600,
        boxShadow: "0 8px 28px rgba(0,0,0,0.28)", pointerEvents: "auto", maxWidth: 520,
        ...(toast.countdown ? { position: "relative", overflow: "hidden" } : null),
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span>{toast.text}</span>
        {toast.detail ? <span data-toast-detail="1" style={{ fontSize: FONT_SIZE.label, fontWeight: 500, color: "var(--text-secondary)" }}>{toast.detail}</span> : null}
      </span>
      {toast.action && (
        <button
          onClick={() => { toast.action.onClick?.(); onDismiss(toast.id); }}
          style={{ flex: "none", cursor: "pointer", background: "var(--accent)", color: "var(--on-accent)",
            border: "none", borderRadius: RADIUS.md, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 800 }}
        >{toast.action.label}</button>
      )}
      <button
        aria-label="Dismiss"
        onClick={() => { toast.onClose?.(); onDismiss(toast.id); }}
        style={{ flex: "none", cursor: "pointer", background: "transparent", color: "var(--text-secondary)",
          border: "none", fontSize: 14, fontWeight: 800, padding: "0 2px", lineHeight: 1 }}
      >✕</button>
      {toast.countdown ? (
        // How long the toast stays: drains to empty over its lifetime and PAUSES while hovered (hover-hold).
        <span aria-hidden="true" data-toast-countdown="1" style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: "100%",
          background: "var(--accent)", transformOrigin: "left center",
          animation: `planyr-toast-drain ${toast.ttlMs || TOAST_TTL_MS}ms linear forwards`, animationPlayState: held ? "paused" : "running" }} />
      ) : null}
    </div>
  );
}
// The countdown bar's keyframes, injected once (a toast is app chrome, not a stylesheet module).
if (typeof document !== "undefined" && !document.getElementById("planyr-toast-keyframes")) {
  const st = document.createElement("style");
  st.id = "planyr-toast-keyframes";
  st.textContent = "@keyframes planyr-toast-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}@media (prefers-reduced-motion: reduce){[data-toast-countdown]{animation:none!important;opacity:.6}}";
  document.head.appendChild(st);
}

/* NEW-1 (2026-11-25, owner screenshot: two "Deleted Parcel N [Undo] ✕" toasts and a "+1 more" pill
 * that "says one more, but it won't let me click on it to open it"). The pill was a plain <div> with
 * no handler: it announced hidden toasts and gave no way to reach them, so the hidden toast's Undo was
 * unreachable. It is now a real button that EXPANDS the stack to every toast; expanded, a "Show fewer"
 * button collapses it, and the stack collapses on its own once expiry/dismissal brings it back to the
 * cap. An expanded stack scrolls inside a capped height (TOAST_EXPANDED_MAX_H) rather than growing up
 * the canvas over the map's own controls. */
export const TOAST_EXPANDED_MAX_H = "min(45vh, 340px)";
const pillStyle = {
  background: "var(--surface-overlay)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
  borderRadius: RADIUS.md, padding: "3px 10px", fontSize: FONT_SIZE.control, fontWeight: 700, pointerEvents: "auto",
  cursor: "pointer", fontFamily: "inherit",
};
export function ToastHost({ toasts, onDismiss }) {
  const [expandedWant, setExpanded] = useState(false);
  const { shown, more, expanded, canCollapse } = visibleToasts(toasts, TOAST_CAP, expandedWant);
  // Back at (or under) the cap → forget the expansion, so the next overflow starts collapsed.
  useEffect(() => { if (expandedWant && !expanded) setExpanded(false); }, [expandedWant, expanded]);
  // Opening the list lands on the NEWEST notice (the bottom, next to the button just pressed), not the oldest.
  const listRef = useRef(null);
  useLayoutEffect(() => { if (expanded && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [expanded]);
  if (!shown.length) return null;
  return (
    <FloatingNotice testId="sync-toast-host" pointerEvents="none">
      <div
        ref={listRef}
        data-toast-expanded={expanded ? "1" : undefined}
        style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none",
          ...(expanded ? { maxHeight: TOAST_EXPANDED_MAX_H, overflowY: "auto", pointerEvents: "auto", padding: "2px 4px" } : null) }}
      >
        {shown.map((t) => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
      </div>
      {more > 0 && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 8, pointerEvents: "none" }}>
          <button type="button" data-testid="toast-more" aria-expanded="false" title="Show every notice"
            onClick={() => setExpanded(true)} style={pillStyle}>+{more} more</button>
        </div>
      )}
      {canCollapse && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 8, pointerEvents: "none" }}>
          <button type="button" data-testid="toast-fewer" aria-expanded="true"
            onClick={() => setExpanded(false)} style={pillStyle}>Show fewer</button>
        </div>
      )}
    </FloatingNotice>
  );
}
