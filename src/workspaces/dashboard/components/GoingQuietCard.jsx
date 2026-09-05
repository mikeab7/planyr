import { useEffect, useState } from "react";
import { loadGoingQuiet } from "../lib/cardData.js";

function daysAgo(ms) {
  const days = Math.max(0, Math.round((Date.now() - (ms || 0)) / 86400000));
  return `${days}d`;
}

export default function GoingQuietCard({ onNavigate }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(loadGoingQuiet()); }, []);
  if (!rows) return null;
  if (!rows.length) return <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Nothing's gone quiet — every live pursuit has been touched in the last 30 days.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.slice(0, 6).map((s) => (
        <button
          key={s.groupId}
          type="button"
          onClick={() => onNavigate && onNavigate({ module: "site-planner", projectId: s.groupId, cross: false, org: false })}
          style={{
            all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", fontSize: 12,
            color: "var(--text-primary)", padding: "2px 0",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name || s.site}</span>
          <span style={{ color: "var(--text-secondary)", flex: "none", marginLeft: 8 }}>quiet {daysAgo(s.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}
