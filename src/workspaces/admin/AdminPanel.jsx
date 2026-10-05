/* AdminPanel (B711905–B711908) — the shared shell + loader every NEW admin section uses, so each
 * one gets the same loading, empty and VISIBLE error states (a silent failure is crash severity).
 * Module-scope components only (MODULE-SCOPE-COMPONENTS). Tokens + controls.jsx primitives, solid fills. */
import { useCallback, useEffect, useRef, useState } from "react";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { Button } from "../../shared/ui/controls.jsx";

/** Run an async loader on mount and on reload(); returns { loading, data, error, reload }. */
export function useAdminLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve(loader()).then(({ data, error }) => {
      if (mine !== seq.current) return;
      setState({ loading: false, data: error ? null : data, error: error || null });
    });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { seq.current += 1; }; }, [load]);
  return { ...state, reload: load };
}

export const th = { padding: "4px 10px 4px 0", textAlign: "left", color: "var(--text-tertiary)", fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" };
export const td = { padding: "6px 10px 6px 0", verticalAlign: "top" };

export function PanelState({ loading, error, empty, emptyText, onRetry }) {
  if (loading) return <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>Loading…</div>;
  if (error) {
    return (
      <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>
        <span>Could not load: {error}</span>
        {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
      </div>
    );
  }
  if (empty) return <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>{emptyText}</div>;
  return null;
}

export default function AdminPanel({ id, title, blurb, actions, wide = true, children }) {
  return (
    <section
      data-testid={`admin-section-${id}`}
      style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
        padding: 18, display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)" }}>{title}</h2>
        <span style={{ flex: 1 }} />
        {actions}
      </div>
      {blurb && <p style={{ margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{blurb}</p>}
      {children}
    </section>
  );
}
