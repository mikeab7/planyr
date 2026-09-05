import { useEffect, useState } from "react";
import { loadPursuitsByCounty } from "../lib/cardData.js";

export default function PursuitsByActivityCard() {
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(loadPursuitsByCounty()); }, []);
  if (!rows) return null;
  if (!rows.length) return <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No pursuits yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.slice(0, 8).map((r) => (
        <div key={r.county} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-primary)" }}>
          <span style={{ textTransform: "capitalize" }}>{r.county === "unknown" ? "County unknown" : r.county}</span>
          <span style={{ color: "var(--text-secondary)" }}>
            {r.projectCount} project{r.projectCount === 1 ? "" : "s"} · {r.planCount} plan{r.planCount === 1 ? "" : "s"}
            {r.activeCount > 0 ? ` · ${r.activeCount} active` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
