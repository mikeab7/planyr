/* compsQueryPrefs — the Records list's search/filter/sort, remembered per DEVICE so a refresh does
 * not reset the view (NEW-1). Storage is a convenience, never state of record: every read and write
 * is in try/catch, a missing/blocked/garbled copy just means "start from the defaults", and
 * `clearQueryPrefs` (the panel's "Clear all") removes the persisted copy too. The list of comps
 * itself is never stored here — only the view over it. */
import { defaultFilters, normalizeFilters, normalizeSort } from "./compsQuery.js";

export const COMPS_QUERY_KEY = "planyr:compsRecordsQuery:v1";

export function loadQueryPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPS_QUERY_KEY) || "null");
    if (raw && typeof raw === "object") return { filters: normalizeFilters(raw.filters), sort: normalizeSort(raw.sort) };
  } catch (_) { /* blocked / garbled: fall through */ }
  return { filters: defaultFilters(), sort: "newest" };
}

export function saveQueryPrefs(filters, sort) {
  try { localStorage.setItem(COMPS_QUERY_KEY, JSON.stringify({ filters, sort })); } catch (_) { /* quota / private mode */ }
}

export function clearQueryPrefs() {
  try { localStorage.removeItem(COMPS_QUERY_KEY); } catch (_) { /* ignore */ }
}
