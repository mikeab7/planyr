import { useEffect, useState } from "react";
import { loadCompsSummary } from "../lib/cardData.js";

export default function CompsSummaryCard() {
  const [state, setState] = useState({ loading: true, lines: [], count: 0, error: null });
  useEffect(() => {
    let live = true;
    loadCompsSummary().then((r) => { if (live) setState({ loading: false, ...r }); });
    return () => { live = false; };
  }, []);

  if (state.loading) return <Muted>Loading…</Muted>;
  if (state.error) return <Muted>Comps unavailable right now.</Muted>;
  if (!state.count) return <Muted>No comps recorded yet.</Muted>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{state.count} comp{state.count === 1 ? "" : "s"}</div>
      {state.lines.length
        ? state.lines.map((line, i) => <div key={i} style={{ fontSize: 12, color: "var(--text-primary)" }}>{line}</div>)
        : <Muted>No dated sale comps yet.</Muted>}
    </div>
  );
}

function Muted({ children }) {
  return <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{children}</div>;
}
