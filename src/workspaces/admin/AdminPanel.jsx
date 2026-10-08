/* AdminPanel — the shared shell + loader every admin section uses, so each gets the same header pattern
 * (title, one-line description, controls on the right) and the same loading / empty / VISIBLE error
 * states (a silent failure is crash severity). Module-scope components only (MODULE-SCOPE-COMPONENTS).
 * Tokens + controls.jsx primitives, solid fills. The shared TABLE style lives in AdminTable.jsx. */
import { useCallback, useEffect, useRef, useState } from "react";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { Button } from "../../shared/ui/controls.jsx";
export { th, td } from "./AdminTable.jsx";

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

export function PanelState({ loading, error, empty, emptyText, emptyHint, onRetry }) {
  const box = { padding: "18px 14px", border: "1px dashed var(--border-default)", borderRadius: RADIUS.md, fontSize: FONT_SIZE.control, color: "var(--text-secondary)", background: "var(--surface-page)" };
  if (loading) return <div role="status" style={box}>Loading…</div>;
  if (error) {
    return (
      <div role="alert" style={{ ...box, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--danger-text)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
        <span>Could not load: {error}</span>
        {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>}
      </div>
    );
  }
  if (empty) {
    return (
      <div style={box}>
        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{emptyText}</div>
        {emptyHint && <div style={{ marginTop: 2 }}>{emptyHint}</div>}
      </div>
    );
  }
  return null;
}

export default function AdminPanel({ id, title, blurb, actions, children }) {
  return (
    <section data-testid={`admin-section-${id}`} style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <h2 style={{ margin: 0, fontSize: 18, /* design-exempt: page-section title, one step above the 14 display size */ fontWeight: 700, color: "var(--text-primary)" }}>{title}</h2>
          {blurb && <p style={{ margin: "3px 0 0", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{blurb}</p>}
        </div>
        {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A bordered block inside a section (tiles, charts, side panels). */
export function Card({ title, aside, children, style }) {
  return (
    <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, padding: 14, minWidth: 0, ...style }}>
      {(title || aside) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          {title && <h3 style={{ margin: 0, fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)" }}>{title}</h3>}
          <span style={{ flex: 1 }} />
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/** Small solid-fill status chip. tone: ok | warn | danger | info | neutral. */
const TONES = {
  ok: ["var(--success-bg)", "var(--success-text)", "var(--success-border)"],
  warn: ["var(--warn-bg)", "var(--warn-text)", "var(--warn-border)"],
  danger: ["var(--danger-bg)", "var(--danger-text)", "var(--danger-border)"],
  info: ["var(--info-bg)", "var(--info-text)", "var(--border-default)"],
  neutral: ["var(--surface-page)", "var(--text-secondary)", "var(--border-default)"],
};
export function Chip({ tone = "neutral", children, title }) {
  const [bg, fg, bd] = TONES[tone] || TONES.neutral;
  return <span title={title} style={{ display: "inline-block", padding: "1px 8px", borderRadius: RADIUS.pill, background: bg, color: fg, border: `1px solid ${bd}`, fontSize: FONT_SIZE.label, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}
