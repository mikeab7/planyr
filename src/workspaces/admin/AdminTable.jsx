/* The ONE admin table style (NEW-1): sticky header, one row height, numeric columns right-aligned,
 * dates relative with the exact time on hover (RelTime), sortable headers. Every section's table is built
 * from these so they cannot drift. Module-scope components only. */
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import { ago } from "./lib/adminPanels.js";
import { exactTime } from "./lib/adminFormat.js";

export const th = {
  position: "sticky", top: 0, zIndex: 1, background: "var(--surface-raised)", padding: "8px 12px", textAlign: "left",
  color: "var(--text-secondary)", fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
  whiteSpace: "nowrap", borderBottom: "1px solid var(--border-strong)",
};
export const td = { padding: "0 12px", height: 36, verticalAlign: "middle", borderTop: "1px solid var(--border-default)", color: "var(--text-primary)" };

/** Scroll container with a capped height, so the sticky header has something to stick to. */
export function AdminTable({ children, maxHeight = 520, minWidth }) {
  return (
    <div style={{ overflow: "auto", maxHeight, border: "1px solid var(--border-default)", borderRadius: RADIUS.md, background: "var(--surface-raised)" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: FONT_SIZE.control, minWidth }}>{children}</table>
    </div>
  );
}

/** A header cell. `sortKey` makes it a sort button; `num` right-aligns. */
export function Th({ children, num, sortKey, sort, onSort, style, ...rest }) {
  const active = sortKey && sort && sort.key === sortKey;
  const base = { ...th, textAlign: num ? "right" : "left", ...style };
  if (!sortKey) return <th style={base} {...rest}>{children}</th>;
  return (
    <th style={base} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} {...rest}>
      <button
        type="button" onClick={() => onSort(sortKey)}
        style={{ all: "unset", cursor: "pointer", display: "inline-flex", gap: 4, alignItems: "center", flexDirection: num ? "row-reverse" : "row", color: active ? "var(--text-primary)" : "inherit" }}
      >
        {children}<span aria-hidden style={{ fontSize: FONT_SIZE.micro, lineHeight: 1, display: "inline-block", minWidth: 8 }}>{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

export function Td({ children, num, style, ...rest }) {
  return <td style={{ ...td, textAlign: num ? "right" : "left", fontVariantNumeric: num ? "tabular-nums" : undefined, ...style }} {...rest}>{children}</td>;
}

/** Truncating cell text that keeps the full value on hover. */
export function Clip({ children, max = 280 }) {
  const title = typeof children === "string" ? children : undefined;
  return <span title={title} style={{ display: "block", maxWidth: max, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>;
}

/** A date: relative text, exact time on hover, never a raw ISO string. */
export function RelTime({ iso, empty = "—" }) {
  if (!iso) return <span style={{ color: "var(--text-tertiary)" }}>{empty}</span>;
  return <time dateTime={iso} title={exactTime(iso)} style={{ whiteSpace: "nowrap" }}>{ago(iso)}</time>;
}

/** Click-to-sort state helper: toggles direction on the active key, otherwise starts descending. */
export function nextSort(sort, key, firstDir = "desc") {
  return sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "email" || key === "message" ? "asc" : firstDir };
}

export function LinkButton({ children, ...rest }) {
  return <button type="button" {...rest} style={{ all: "unset", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: FONT_SIZE.control, ...rest.style }}>{children}</button>;
}
