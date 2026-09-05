import { useEffect, useState } from "react";
import { loadJumpBackIn } from "../lib/cardData.js";
import { MODULE_TAB_LABEL } from "../../../shared/ui/moduleTabLabel.js";
import { Button } from "../../../shared/ui/controls.jsx";

export default function JumpBackInCard({ onNavigate }) {
  const [data, setData] = useState({ loading: true, lastRoute: null, projectName: null, newestReview: null });
  useEffect(() => {
    let live = true;
    loadJumpBackIn().then((r) => { if (live) setData({ loading: false, ...r }); });
    return () => { live = false; };
  }, []);

  if (data.loading) return <Muted>Loading…</Muted>;

  const moduleLabel = data.lastRoute ? (MODULE_TAB_LABEL[data.lastRoute.module] || null) : null;
  const canResume = !!data.lastRoute && !!moduleLabel;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {canResume ? (
        <div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
            Where you left off: <strong style={{ color: "var(--text-primary)" }}>{moduleLabel}</strong>
            {data.projectName ? ` · ${data.projectName}` : ""}
          </div>
          <Button
            size="sm" variant="ghost"
            onClick={() => onNavigate && onNavigate({ module: data.lastRoute.module, projectId: data.lastRoute.projectId || null, cross: !!data.lastRoute.cross, org: !!data.lastRoute.org })}
          >Resume</Button>
        </div>
      ) : (
        <Muted>Nowhere to resume yet — open a project to get started.</Muted>
      )}
      {data.newestReview && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", borderTop: "1px solid var(--border-default)", paddingTop: 8 }}>
          Last opened drawing: <span style={{ color: "var(--text-primary)" }}>{data.newestReview.title || "Untitled"}</span>
        </div>
      )}
    </div>
  );
}

function Muted({ children }) {
  return <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{children}</div>;
}
