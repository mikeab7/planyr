/* Dev-only harness (not part of the app build) that mounts the real LayerPanel with
 * mock props in a browser, so ui-audit/layerpanel-verify.mjs can headless-assert the
 * B760–B762 panel overhaul (de-text, merged City/ETJ toggle, folded county groups)
 * against actual rendered DOM. Runs under `vite` dev, which serves /src + this file. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LayerPanel from "../src/workspaces/site-planner/components/LayerPanel.jsx";
import JurisdictionBadge from "../src/workspaces/site-planner/components/JurisdictionBadge.jsx";
import { defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

// NB: the ISD endpoint itself is verified LIVE via curl (through the sandbox HTTPS proxy) — see
// the B764 evidence in VERIFICATION.md. A browser-side fetch can't be used to verify it HERE
// because headless Chromium in this sandbox has no external-network egress (it doesn't use the
// proxy), so any in-page fetch to an agency host fails — that on-map render check is owed live.

function Panel({ id, county, mutate }) {
  const [ov, setOv] = useState(() => { const o = defaultOverlayState(); if (mutate) mutate(o); return o; });
  return (
    <div id={id} data-panel style={{ width: 300, border: "1px solid var(--border-default)", borderRadius: 10, padding: 12, background: "var(--surface-overlay)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{id}</div>
      <LayerPanel overlays={ov} setOverlays={setOv} county={county} layerStatus={{}} coverage={{}} />
    </div>
  );
}

function badgeOf(j, opts) {
  const b = formatJurisdictionBadge(j, opts);
  return b ? { ...b, ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC" } : null;
}

function App() {
  return (
    <div>
      {/* B763 — passive jurisdiction badges (site-header chip) */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <span id="badge-city"><JurisdictionBadge badge={badgeOf({ city: ["Houston"], etj: [], county: ["Harris"], straddle: false })} /></span>
        <span id="badge-etj"><JurisdictionBadge badge={badgeOf({ city: [], etj: ["Baytown"], county: ["Harris"], unincorporated: true })} /></span>
        <span id="badge-uninc"><JurisdictionBadge badge={badgeOf({ city: [], etj: [], county: ["Waller"], unincorporated: true })} /></span>
        <span id="badge-straddle"><JurisdictionBadge badge={badgeOf({ city: ["Houston", "Katy"], etj: [], county: ["Harris"], straddle: true })} /></span>
        <span id="badge-null"><JurisdictionBadge badge={null} /></span>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Panel id="panel-harris" county="harris" />
        <Panel id="panel-fortbend" county="fortbend" />
        <Panel id="panel-chambers" county="chambers" />
        {/* "old saved state with jur_etj on" → the merged row must load ON */}
        <Panel id="panel-etjon" county="harris" mutate={(o) => { o.jur_etj.on = true; }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
