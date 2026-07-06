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

export const TOAST_TTL_MS = 8000;
export const TOAST_CAP = 4;

let toastSeq = 0;

// Pure: append a toast to a list (newest last). Each entry: { id, text, action?{label}, ttlMs }.
export function pushToastPure(list, toast) {
  const t = { ttlMs: TOAST_TTL_MS, ...toast, id: toast.id != null ? toast.id : "t" + ++toastSeq };
  return [...(list || []), t];
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
  return { toasts, pushToast: push, dismissToast: dismiss };
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
            border: "none", borderRadius: 8, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 800 }}
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
    <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 6500,
      display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none",
      maxWidth: "min(560px, calc(100vw - 16px))" }}>
      {shown.map((t) => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
      {more > 0 && (
        <div style={{ background: "var(--surface-overlay)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, pointerEvents: "auto" }}>
          +{more} more
        </div>
      )}
    </div>
  );
}
