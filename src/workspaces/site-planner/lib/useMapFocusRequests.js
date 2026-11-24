/* useMapFocusRequests — a request arriving from outside MapFinder (a comp pin dropped, a comp marker clicked, the
 * Dashboard's "missing locations" card) switches the rail to the relevant tab and opens the panel; moved verbatim out of
 * MapFinder.jsx (audit batch L2). */
import { useEffect } from "react";

export function useMapFocusRequests({ pendingCompAnchor, focusCompId, focusMissingLocations, setPanelTab, setSitesPanelOpen, setLocationFilterOnly }) {
  // NEW-COMPS/NEW-2 — a comp pin just dropped or an existing comp's marker just got clicked: the
  // Comps tab is what should be showing to act on it, wherever the rail happened to be pointed.
  // B850016 (NEW-11) — this used to also force `mode` (the search-create toggle) to "comp", which
  // was the SAME coupling NEW-11 reports from the other direction: merely clicking an existing
  // comp marker silently rearmed what an address search creates. Selecting a specific comp should
  // surface its detail (the panel tab) — it should not decide what a future search does.
  useEffect(() => {
    if (!pendingCompAnchor && !focusCompId) return;
    setPanelTab("comp");
    setSitesPanelOpen(true);
  }, [pendingCompAnchor, focusCompId]);
  // LOCATIONS-MAP-CARD FIX — same shape as the effect above: a request arriving from outside
  // this component switches the rail to the relevant tab and opens the panel. Re-fires the
  // filter (never toggles it off) on a repeat click from the Dashboard, same convention as
  // `focusCompId` re-firing on a repeat click of the same comp.
  useEffect(() => {
    if (focusMissingLocations == null) return;
    setPanelTab("site");
    setSitesPanelOpen(true);
    setLocationFilterOnly(true);
  }, [focusMissingLocations]);
}
