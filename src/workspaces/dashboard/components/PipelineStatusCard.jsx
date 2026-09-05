import { useEffect, useState } from "react";
import { loadPipelineCounts } from "../lib/cardData.js";
import { STATUS_META } from "../../site-planner/lib/siteStatus.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

const chipStyle = { fontSize: FONT_SIZE.label, color: "var(--text-secondary)", background: "var(--surface-page)", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, padding: "2px 8px" };

export default function PipelineStatusCard() {
  const [data, setData] = useState(null);
  useEffect(() => { setData(loadPipelineCounts()); }, []);
  if (!data) return null;
  const rows = Object.keys(data.byStatus).map((key) => ({ key, count: data.byStatus[key], label: (STATUS_META[key] && STATUS_META[key].label) || key }));
  return (
    <div>
      <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>{data.total}</div>
      <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginBottom: 10 }}>pursuits</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rows.map((r) => (
          <span key={r.key} style={chipStyle}>{r.label} {r.count}</span>
        ))}
        {data.trackedCount > 0 && <span style={chipStyle}>Tracked market {data.trackedCount}</span>}
      </div>
    </div>
  );
}
