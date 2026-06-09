import { useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import { loadAutosave } from "./lib/storage.js";

/* Two surfaces: a map to find/select a parcel, and the planner to design on it.
 * Both stay mounted (toggled with display) so the planner keeps its work when
 * you pop back to the map for another site. */
export default function App() {
  // Resume in the planner if there's autosaved work; otherwise start at the map.
  const [mode, setMode] = useState(() => {
    const s = loadAutosave();
    return s && ((s.parcels && s.parcels.length) || (s.els && s.els.length) || s.underlay) ? "plan" : "map";
  });
  const [county, setCounty] = useState("harris");
  const [incoming, setIncoming] = useState(null);

  return (
    <>
      <div style={{ display: mode === "map" ? "block" : "none", height: "100vh" }}>
        <MapFinder
          visible={mode === "map"}
          county={county}
          onCounty={setCounty}
          onUseParcels={(payload) => { setIncoming(payload); setMode("plan"); }}
          onSkip={() => setMode("plan")}
        />
      </div>
      <div style={{ display: mode === "plan" ? "block" : "none", height: "100vh" }}>
        <SitePlanner
          active={mode === "plan"}
          incoming={incoming}
          onBackToMap={() => setMode("map")}
        />
      </div>
    </>
  );
}
