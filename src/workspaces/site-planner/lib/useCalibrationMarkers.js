/* useCalibrationMarkers — draws the calibration clicks on the map (drawing points in the comp accent, their map spots in a
 * contrasting ring, joined by a line); moved verbatim out of MapFinder.jsx (audit batch L2). */
import { useEffect } from "react";
import L from "leaflet";
import { matchPairsOf } from "../../../shared/sitePlans/lib/overlayCalibration.js";

export function useCalibrationMarkers({ mapRef, calibration, COMP_ACCENT, ON_COMP_ACCENT }) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !calibration) return undefined;
    const g = L.layerGroup().addTo(map);
    const pts = calibration.pts;
    const dot = (p, fill, ring) => L.circleMarker([p.lat, p.lng], { radius: 6, color: ring, weight: 2, fillColor: fill, fillOpacity: 1, interactive: false }).addTo(g);
    if (calibration.kind === "trace") {
      pts.forEach((p) => dot(p, COMP_ACCENT, ON_COMP_ACCENT));
      if (pts.length === 2) L.polyline([[pts[0].lat, pts[0].lng], [pts[1].lat, pts[1].lng]], { color: COMP_ACCENT, weight: 3, interactive: false }).addTo(g);
    } else {
      matchPairsOf(pts).forEach((pr) => {
        dot(pr.from, COMP_ACCENT, ON_COMP_ACCENT);
        if (pr.to) {
          dot(pr.to, ON_COMP_ACCENT, COMP_ACCENT);
          L.polyline([[pr.from.lat, pr.from.lng], [pr.to.lat, pr.to.lng]], { color: COMP_ACCENT, weight: 2, dashArray: "5 5", interactive: false }).addTo(g);
        }
      });
    }
    return () => { g.remove(); };
  }, [calibration]);  
}
