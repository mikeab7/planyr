/* React side of the lazy per-state layer files (batch K stage 1 — see lazyLayerFiles.js and the machinery in layers.js).
 *
 *  · `useLayerRegistryVersion()` — re-renders the caller when a lazy file lands, so anything that READS `ALL_LAYERS` in render (the Layers
 *    panel, the drawn-overlays memo, Site Analysis pills) sees the new rows. Keys effects on it too.
 *  · `useEnsureLayerFiles(keys)` — loads the named files. LOUD on failure: a failed chunk fetch is reported to telemetry and logged, and the
 *    next change of `keys` (or a remount) retries; it is never silently read as "this state has no layers". */
import { useEffect, useSyncExternalStore } from "react";
import { layerRegistryVersion, subscribeLayerRegistry, ensureLayerFiles } from "./layers.js";
import { reportClientError } from "../../../shared/telemetry/clientErrors.js";

export const useLayerRegistryVersion = () => useSyncExternalStore(subscribeLayerRegistry, layerRegistryVersion, layerRegistryVersion);

export function loadLayerFilesLoudly(keys) {
  return ensureLayerFiles(keys).catch((e) => {
    console.error("[layers] could not load the layer files", keys, e);
    try { reportClientError(e, { where: "lazy-layer-files", files: (keys || []).join(",") }); } catch (_) { /* telemetry must not throw */ }
  });
}

export function useEnsureLayerFiles(keys) {
  const sig = (keys || []).join(",");
  useEffect(() => { if (sig) loadLayerFilesLoudly(sig.split(",")); }, [sig]);
}
