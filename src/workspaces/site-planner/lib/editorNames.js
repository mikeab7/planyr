/* Conflict-toast naming (B673) — who changed it, and what "it" is.
 *
 * WHO: profiles RLS is own-row-only, so a teammate's name can't be read from profiles directly —
 * the roster comes from the SECURITY DEFINER `list_team_members` RPC (lib/teams.js listMembers),
 * fetched once per site session and cached. The uid space is closed by construction: a foreign
 * uid can only occur on a TEAM site (private-site RLS admits no one else), so a foreign echo on a
 * private site is your own uid from another window → "you (another window)".
 *
 * WHAT: a short human label for an element — buildings by their derived display number
 * ("Building 3", the same numbering the canvas shows), everything else by type/kind.
 *
 * Pure over injected fetchers; unit-tested with no network.
 */
import { buildingNumbers, isBuilding } from "./siteModel.js";

// createNameResolver({ selfUid, teamIdOf, fetchRoster }) → resolve(uid) (async, cached).
//   teamIdOf()   — returns the CURRENT site's teamId (or null) at resolve time.
//   fetchRoster  — async (teamId) => [{ userId, displayName }] (lib/teams.js listMembers).
export function createNameResolver({ selfUid, teamIdOf, fetchRoster }) {
  const cache = new Map();          // uid -> displayName
  let rosterLoaded = null;          // teamId the cached roster belongs to
  async function loadRoster() {
    const teamId = teamIdOf ? teamIdOf() : null;
    if (!teamId || rosterLoaded === teamId || !fetchRoster) return;
    try {
      const members = await fetchRoster(teamId);
      for (const m of members || []) if (m && m.userId) cache.set(m.userId, m.displayName || m.email || "Teammate");
      rosterLoaded = teamId;
    } catch (_) { /* roster fetch failed → fallbacks below */ }
  }
  return async function resolve(uid) {
    if (!uid || uid === selfUid) return "you (another window)";
    if (cache.has(uid)) return cache.get(uid);
    await loadRoster();
    if (cache.has(uid)) return cache.get(uid);
    return "a teammate"; // member left / roster miss — honest generic, never blank
  };
}

const TYPE_LABEL = {
  road: "a road", parking: "a parking field", paving: "a paving area", sidewalk: "a sidewalk",
  landscape: "a landscape area", pond: "a detention pond", trailer: "a trailer court",
};
const MARKUP_LABEL = {
  line: "a line markup", polyline: "a polyline markup", rect: "a rectangle markup",
  ellipse: "an ellipse markup", polygon: "a polygon markup",
  encumbrance: "an easement", easement: "an easement",
  utilRoute: "a utility route", traced: "a traced line", infwater: "an inferred water main",
};

// Short human label for a (kind, element) pair. `els` (the full collection) lets a building get
// its on-canvas display number; everything else labels by type/kind. Never blank.
export function describeElement(kind, el, els) {
  if (kind === "el") {
    if (el && isBuilding(el)) {
      const n = buildingNumbers(els || []).get(el.id);
      return n ? `Building ${n}` : "a building";
    }
    return (el && TYPE_LABEL[el.type]) || "an element";
  }
  if (kind === "markup") return (el && MARKUP_LABEL[el.kind]) || "a markup";
  if (kind === "measure") return "a measurement";
  if (kind === "callout") return "a callout";
  if (kind === "parcel") return "a parcel";
  return "an element";
}
