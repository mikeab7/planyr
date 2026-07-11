/* Dev-only harness (not part of the app build) that mounts the real LayerPanel with
 * mock props in a browser, so ui-audit/layerpanel-verify.mjs can headless-assert the
 * B760–B762 panel overhaul (de-text, merged City/ETJ toggle, folded county groups)
 * against actual rendered DOM. Runs under `vite` dev, which serves /src + this file. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LayerPanel from "../src/workspaces/site-planner/components/LayerPanel.jsx";
import { defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";

function Panel({ id, county, mutate }) {
  const [ov, setOv] = useState(() => { const o = defaultOverlayState(); if (mutate) mutate(o); return o; });
  return (
    <div id={id} data-panel style={{ width: 300, border: "1px solid var(--border-default)", borderRadius: 10, padding: 12, background: "var(--surface-overlay)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{id}</div>
      <LayerPanel overlays={ov} setOverlays={setOv} county={county} layerStatus={{}} coverage={{}} />
    </div>
  );
}

function App() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Panel id="panel-harris" county="harris" />
      <Panel id="panel-fortbend" county="fortbend" />
      <Panel id="panel-chambers" county="chambers" />
      {/* "old saved state with jur_etj on" → the merged row must load ON */}
      <Panel id="panel-etjon" county="harris" mutate={(o) => { o.jur_etj.on = true; }} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
