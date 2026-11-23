/* A component that reads COUNTIES / COUNTIES_MAP while it renders subscribes here, so it re-renders when a state's county table lands (batch K stage 2,
 * parcelStateTables.js) instead of keeping an answer it computed while the rows were still downloading. `keys` (saved county keys the component shows) are
 * ensured loaded; a failed load is already reported loudly by parcelStateTables.js. */
import { useEffect, useSyncExternalStore } from "react";
import { onParcelTablesLoaded, parcelTablesVersion, ensureParcelStatesForKeys } from "./parcelStateTables.js";

export function useParcelTablesVersion(keys) {
  const v = useSyncExternalStore(onParcelTablesLoaded, parcelTablesVersion, parcelTablesVersion);
  const sig = Array.isArray(keys) ? [...new Set(keys.filter(Boolean))].sort().join("|") : "";
  useEffect(() => { if (sig) ensureParcelStatesForKeys(sig.split("|")).catch(() => {}); }, [sig]);
  return v;
}
