import { useEffect, useState } from "react";
import { loadScheduleHealth } from "../lib/cardData.js";
import { RADIUS } from "../../../shared/ui/radius.js";

const barStyle = (pct, color) => ({ width: `${Math.max(0, Math.min(100, pct))}%`, background: color, height: 6, borderRadius: RADIUS.pill });

export default function ScheduleHealthCard({ userId }) {
  const [state, setState] = useState({ loading: true, rows: [], signedOut: false });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    loadScheduleHealth(userId).then((r) => { if (live) setState({ loading: false, ...r }); });
    return () => { live = false; };
  }, [userId]);

  if (state.loading) return <Muted>Loading…</Muted>;
  if (state.signedOut) return <Muted>Sign in to see your schedules' health.</Muted>;
  if (!state.rows.length) return <Muted>No schedules yet.</Muted>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {state.rows.slice(0, 5).map((r) => {
        const total = Math.max(1, r.taskCount);
        return (
          <div key={r.id}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-primary)", marginBottom: 4 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
              <span style={{ color: "var(--text-secondary)", flex: "none", marginLeft: 8 }}>
                {r.overdue ? `${r.overdue} overdue` : r.atRisk ? `${r.atRisk} at risk` : "on track"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              <div style={barStyle((r.complete / total) * 100, "var(--accent)")} />
              <div style={barStyle((r.atRisk / total) * 100, "var(--warn-text)")} />
              <div style={barStyle((r.overdue / total) * 100, "var(--danger-text)")} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Muted({ children }) {
  return <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{children}</div>;
}
