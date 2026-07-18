/* Dev-only harness (not part of the app build) for B881 / NEW-1: the bottom map furniture
 * (graphic scale bar · "● Scaled" calibration badge · north arrow · coordinate chip · zoom
 * controls) piling onto each other when a docked left panel narrows the map pane. It renders
 * the REAL furniture plates (`screenFurniturePlates`) and the REAL placement decision
 * (`calibBadgePlacement`) inside panes of several widths so bottom-furniture-verify.mjs can
 * assert that none of the four bottom items overlap. Mirrors the SitePlanner canvas JSX.
 * Served by `npm run dev`. */
import { createRoot } from "react-dom/client";
import { screenFurniturePlates, calibBadgePlacement } from "../src/workspaces/site-planner/lib/sheetFurniture.js";
import { PALETTES } from "../src/shared/theme/palette.js";
import { useLayoutEffect, useRef, useState } from "react";

const PAL = PALETTES.light;
const f0 = (n) => Math.round(n).toLocaleString();

function Plate({ p }) {
  return (
    <svg width={p.plateW} height={p.plateH} viewBox={`0 0 ${p.plateW} ${p.plateH}`}
      fontFamily="Inter, system-ui, sans-serif" style={{ display: "block", overflow: "visible" }}
      dangerouslySetInnerHTML={{ __html: p.markup }} />
  );
}

// One narrowed map pane at a fixed width, ppf tuned so the scale bar lands ~large (worst case).
function Pane({ width, ppf, badgeState }) {
  const paneW = width;
  const furn = screenFurniturePlates({ ftPerUnit: 1 / ppf, fmtFeet: f0, pal: PAL });
  const labelRef = useRef(null);
  const [badgeW, setBadgeW] = useState(0);
  useLayoutEffect(() => {
    if (labelRef.current) setBadgeW(labelRef.current.scrollWidth + 40);
  }, []);
  const place = calibBadgePlacement({ paneW, badgeW, scaleBarW: furn.scaleBar.plateW, scaleBarH: furn.scaleBar.plateH });
  const cfg = {
    georef: { bg: "rgba(22,101,52,0.92)", dot: "#4ade80", text: "● Scaled · county GIS", sub: null },
    calibrated: { bg: "rgba(22,101,52,0.92)", dot: "#4ade80", text: "● Scaled · calibrated", sub: "1 px = 2.4 ft" },
  }[badgeState];
  const maxW = place.maxWidth ?? undefined;
  return (
    <div data-pane={width} style={{ position: "relative", width, height: 260, background: "#3a4a2e", overflow: "hidden", border: "1px solid #222", margin: "0 0 14px" }}>
      {/* scale bar + north arrow overlay */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 14, bottom: 40 }} data-testid="north"><Plate p={furn.north} /></div>
        <div style={{ position: "absolute", right: 14, bottom: 40 }} data-testid="scalebar"><Plate p={furn.scaleBar} /></div>
      </div>
      {/* coordinate chip */}
      <div data-testid="coord" style={{ position: "absolute", bottom: 8, left: 10, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", background: "rgba(0,0,0,0.42)", padding: "3px 8px", borderRadius: 5, lineHeight: 1.4, maxWidth: "calc(100% - 20px)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", boxSizing: "border-box" }}>
        30.043633°,&nbsp;-95.760083° · El ≈ 197.8 ft NAVD88
      </div>
      {/* calibration badge */}
      <div data-testid="badge" style={{ position: "absolute", left: place.left, bottom: place.bottom, maxWidth: maxW, display: "flex", alignItems: "center", gap: 8, background: cfg.bg, color: "#fff", padding: "5px 11px", borderRadius: 99, fontSize: 11.5, fontWeight: 600, overflow: "hidden" }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: cfg.dot, flex: "none" }} />
        <span ref={labelRef} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cfg.text}{cfg.sub && <span style={{ fontWeight: 400, opacity: 0.85, fontFamily: "ui-monospace, monospace" }}>· {cfg.sub}</span>}
        </span>
      </div>
      {/* zoom controls */}
      <div style={{ position: "absolute", right: 14, bottom: 100, display: "flex", flexDirection: "column", borderRadius: 9, overflow: "hidden" }} data-testid="zoom">
        {["＋", "－", "⤢"].map((g) => <div key={g} style={{ width: 30, height: 30, display: "grid", placeItems: "center", background: "#fff", border: "1px solid #ccc", fontSize: 16 }}>{g}</div>)}
      </div>
    </div>
  );
}

function App() {
  // ppf chosen so the scale bar picks a large plate (worst case for collision).
  const cases = [
    { width: 260, ppf: 0.9, badgeState: "calibrated" },
    { width: 280, ppf: 0.7, badgeState: "calibrated" },
    { width: 320, ppf: 0.6, badgeState: "calibrated" },
    { width: 360, ppf: 0.5, badgeState: "georef" },
    { width: 460, ppf: 0.4, badgeState: "calibrated" },
    { width: 800, ppf: 0.35, badgeState: "georef" },
  ];
  return (
    <div style={{ padding: 12 }}>
      {cases.map((c) => <Pane key={c.width} {...c} />)}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
