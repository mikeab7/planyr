/* compsViewPrefs — per-DEVICE memory of the Records tab's search / filters / sort, so a refresh does
 * not reset the view. localStorage only (a view preference, not user work), every read and write in
 * try/catch (private windows and blocked storage throw), and a malformed value falls back to the
 * empty view. "Clear all" writes the empty view back, so no stale copy survives it. */
import { emptyFilters, normalizeFilters, normalizeSort } from "./compsQuery.js";

export const COMPS_VIEW_KEY = "planyr:compsView:v1";

export function emptyView() {
  return { filters: emptyFilters(), sort: "newest", search: "", panelOpen: false };
}

export function loadCompsView() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(COMPS_VIEW_KEY) : null;
    if (!raw) return emptyView();
    const o = JSON.parse(raw);
    return {
      filters: normalizeFilters(o?.filters),
      sort: normalizeSort(o?.sort),
      search: typeof o?.search === "string" ? o.search : "",
      panelOpen: !!o?.panelOpen,
    };
  } catch { return emptyView(); }
}

export function saveCompsView(view) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(COMPS_VIEW_KEY, JSON.stringify({
      filters: view.filters, sort: view.sort, search: view.search || "", panelOpen: !!view.panelOpen,
    }));
  } catch { /* quota / private mode — the view just won't survive a reload */ }
}
