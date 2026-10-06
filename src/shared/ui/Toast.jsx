/* Reusable toast stack (B673) — the loud-but-NON-BLOCKING conflict surface for element-level
 * sync, and a general notice rail for any workspace. Design rules (owner, 2026-06-21): solid
 * fill + weight for hierarchy, never faded text; theme tokens only, no raw hex; RED is reserved
 * for genuine alert (--danger), so informational conflict notices ride the raised surface with
 * the warn-amber accent bar. Non-blocking by design: with per-element last-write-wins nothing is
 * lost, so a toast informs (and offers an action like Restore) — it never gates editing.
 *
 * Anatomy: fixed stack (bottom-center), max TOAST_CAP visible + a "+n more" line; each toast
 * auto-dismisses after ttlMs, HOVER-HOLD pauses its timer (mouse over = keep it while reading);
 * an optional action button (e.g. "Restore", "Show") rides on the right. role="status" so screen
 * readers announce without stealing focus.
 *
 * Pure helpers (pushToast/visibleToasts) are exported for unit tests; the host component is
 * MODULE-SCOPE (never define components inside a render body — the remount/focus-loss class).
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { RADIUS } from "./radius.js";
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
      next[i] = { ...l[i], ...toast, id: l[i].id };   // same slot, same id → no remount, no timer restart
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

// Pure: what renders — the first CAP toasts plus how many are hidden behind "+n more".
export function visibleToasts(list, cap = TOAST_CAP) {
  const l = list || [];
  return { shown: l.slice(0, cap), more: Math.max(0, l.length - cap) };
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
  return (
    <div
      role="status"
      data-testid="sync-toast"
      onMouseEnter={hold}
      onMouseLeave={arm}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "var(--surface-raised)", color: "var(--text-primary)",
        border: "1px solid var(--border-strong)", borderLeft: "4px solid var(--warn-text)",
        borderRadius: 8, padding: "9px 12px", fontSize: 12.5, fontWeight: 600,
        boxShadow: "0 8px 28px rgba(0,0,0,0.28)", pointerEvents: "auto", maxWidth: 520,
      }}
    >
      <span style={{ flex: 1 }}>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action.onClick?.(); onDismiss(toast.id); }}
          style={{ flex: "none", cursor: "pointer", background: "var(--accent)", color: "var(--on-accent)",
            border: "none", borderRadius: RADIUS.md, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 800 }}
        >{toast.action.label}</button>
      )}
      <button
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        style={{ flex: "none", cursor: "pointer", background: "transparent", color: "var(--text-secondary)",
          border: "none", fontSize: 14, fontWeight: 800, padding: "0 2px", lineHeight: 1 }}
      >✕</button>
    </div>
  );
}

export function ToastHost({ toasts, onDismiss }) {
  const { shown, more } = visibleToasts(toasts);
  if (!shown.length) return null;
  return (
    <FloatingNotice testId="sync-toast-host" pointerEvents="none">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none" }}>
        {shown.map((t) => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
        {more > 0 && (
          <div style={{ background: "var(--surface-overlay)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
            borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, pointerEvents: "auto" }}>
            +{more} more
          </div>
        )}
      </div>
    </FloatingNotice>
  );
}
