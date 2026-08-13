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

/* ⛔ NEW-4 — AN ACTION IS ATTRIBUTED TO A PERSON ONLY ON A POSITIVE DIFFERENT-ACCOUNT ANSWER.
 *
 * The owner opened his own plan in a second tab and got ~5 banners crediting the edits to a
 * teammate who was never there. The mechanism was not the uid comparison itself — it was that
 * `selfUid` was SNAPSHOTTED at engine-construction time, from `activeUid()`, which is null until
 * the auth session resolves. On any load where the planner mounted first, `selfUid` stayed null
 * for the whole plan session, so `uid === selfUid` was false for every row and the final fallback
 * — "a teammate" — invented a collaborator out of a missing value.
 *
 * Two changes, and both are needed:
 *   • `selfUid` may be a GETTER, and is read at RESOLVE time. A late sign-in is picked up.
 *   • the fallback is no longer a person. An actor we cannot PROVE is a different account resolves
 *     as this account in another tab. The uid space makes that the honest default rather than a
 *     guess: private-site RLS admits nobody else, so on a non-team site a foreign uid cannot occur,
 *     and with `selfUid` unknown we have no evidence of a second person at all. A roster MISS on a
 *     real team site (a member who left) still resolves as `a teammate` — that one IS a proven
 *     different account, and staying silent about it would be the opposite error.
 *
 * Returns `{ name, self }`, not a bare string, so the toast layer can pick a sentence that names a
 * TAB instead of a person. Callers must not re-derive `self` by string-matching `name`.
 */
export const SELF_ACTOR = { name: "you (another window)", self: true };

// createNameResolver({ selfUid, teamIdOf, fetchRoster }) → resolve(uid) (async, cached).
//   selfUid      — the signed-in user's id, OR a function returning it (read at resolve time).
//   teamIdOf()   — returns the CURRENT site's teamId (or null) at resolve time.
//   fetchRoster  — async (teamId) => [{ userId, displayName }] (lib/teams.js listMembers).
export function createNameResolver({ selfUid, teamIdOf, fetchRoster }) {
  const cache = new Map();          // uid -> displayName
  let rosterLoaded = null;          // teamId the cached roster belongs to
  const selfNow = () => {
    try { return typeof selfUid === "function" ? selfUid() : selfUid; } catch (_) { return null; }
  };
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
    const me = selfNow();
    if (!uid || uid === me) return SELF_ACTOR;
    // No signed-in id to compare against → no evidence of a second PERSON. Never invent one.
    if (!me) return SELF_ACTOR;
    if (cache.has(uid)) return { name: cache.get(uid), self: false };
    await loadRoster();
    if (cache.has(uid)) return { name: cache.get(uid), self: false };
    // A proven different account that the roster cannot name (member left / roster miss). The uid
    // itself is the proof, so this one IS a person — honest generic, never blank.
    return { name: "a teammate", self: false };
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
