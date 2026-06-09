import { useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";

/* Two surfaces: a map to find/select a parcel, and the planner to design on it.
 * Both stay mounted (toggled with display) so the planner keeps its work when
 * you pop back to the map for another site. */
export default function App() {
  const [mode, setMode] = useState("map"); // "map" | "plan"
  const [county, setCounty] = useState("harris");
  const [incoming, setIncoming] = useState(null);

  return (
    <>
      <div style={{ display: mode === "map" ? "block" : "none", height: "100vh" }}>
        <MapFinder
          visible={mode === "map"}
          county={county}
          onCounty={setCounty}
          onUseParcel={(p) => { setIncoming({ ...p, _key: Date.now() }); setMode("plan"); }}
          onSkip={() => setMode("plan")}
        />
      </div>
      <div style={{ display: mode === "plan" ? "block" : "none", height: "100vh" }}>
        <SitePlanner
          active={mode === "plan"}
          incomingParcel={incoming}
          onBackToMap={() => setMode("map")}
        />
      </div>
    </>
  );
}
