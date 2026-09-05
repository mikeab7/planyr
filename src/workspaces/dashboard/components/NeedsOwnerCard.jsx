import { useEffect, useState } from "react";
import { loadNeedsAnOwner } from "../lib/cardData.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

/* B1196305 — this card is a REACHABILITY aid, never a nag: the owner has stated a high count of
 * unassigned tasks is normal usage, not a defect. It lists which overdue tasks have no owner set
 * so he can assign one WHEN he chooses to — it never suggests the count itself should come down. */
export default function NeedsOwnerCard({ userId }) {
  const [state, setState] = useState({ loading: true, rows: [], signedOut: false });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    loadNeedsAnOwner(userId).then((r) => { if (live) setState({ loading: false, ...r }); });
    return () => { live = false; };
  }, [userId]);

  if (state.loading) return <Muted>Loading…</Muted>;
  if (state.signedOut) return <Muted>Sign in to see unassigned overdue tasks.</Muted>;
  if (!state.rows.length) return <Muted>No unassigned overdue tasks.</Muted>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {state.rows.slice(0, 6).map((t) => (
        <div key={`${t.projectId}:${t.taskId}`} style={{ fontSize: 12, color: "var(--text-primary)", display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.taskName}</span>
          <span style={{ color: "var(--text-secondary)", flex: "none" }}>{t.projectName}</span>
        </div>
      ))}
      {state.rows.length > 6 && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>+{state.rows.length - 6} more</div>}
    </div>
  );
}

function Muted({ children }) {
  return <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{children}</div>;
}
