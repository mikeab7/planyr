/* Loads the service-area geometry once a location exists and re-renders the caller when it lands (B2436066).
 * Returns a number that changes when the geometry arrives, for a memo dependency. Both Layers hosts' draw filter and the panel
 * itself call it, so the three re-evaluate together. */
import { useEffect, useState } from "react";
import { ensureServiceAreas, subscribeServiceAreas, serviceAreasReady } from "./serviceAreas.js";

export function useServiceAreas(hasLocation) {
  const [ready, setReady] = useState(serviceAreasReady());
  useEffect(() => {
    if (!hasLocation) return undefined;
    const unsub = subscribeServiceAreas(() => setReady(true));
    ensureServiceAreas();
    if (serviceAreasReady()) setReady(true);
    return unsub;
  }, [hasLocation]);
  return ready;
}
