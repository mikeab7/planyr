/* ActionLink (B895) — the ONE style for a "do something about this" affordance (Enter
 * BFE, Enter allowable release rate, Set unit prices, Verify with district) — a real
 * <button>, the global interactive accent (var(--accent)), deliberately NOT any of the
 * six SourceTag colors so an action never reads as a passive provenance tag. */
export default function ActionLink({ children, onClick, disabled, title, style }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title || ""}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, flex: "none",
        padding: "2px 9px", borderRadius: 999, border: "1px solid var(--accent)",
        background: "transparent", color: "var(--accent)", fontFamily: "inherit",
        fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >{children}</button>
  );
}
