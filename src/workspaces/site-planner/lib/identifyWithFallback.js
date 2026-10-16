/* ⛔ NEW-1 (Memphis line band, B2289168 ×3) — THE ONE LOT-CLICK IDENTIFY, shared by every lot-picking flow (the Map's
 * Select parcels click, its address search, and the planner's identify-and-add `quickAddAt`).
 *
 * A click used to be ONE round: ask the county the bundled geometry names, and if it has nothing, say "No lot here". Two
 * measured ways that refused a real lot:
 *   1. THE GEOMETRY NAMED THE WRONG COUNTY. Along the Tennessee–Mississippi line the asset sits ≈550 m north of the surveyed
 *      line, so a Shelby lot on the north side of Stateline Rd was asked of DeSoto alone (see `lineNeighbourKeysForPoint`).
 *   2. A STALLED CONNECTION. One request in a burst of ~80 to the Shelby relay hung for the full 30 s connect timeout while the
 *      rest answered in under a second — a fresh connection answers; the same click used to report an outage.
 * So a click is now up to three rounds, each only when the one before found NO lot:
 *   primary → retry the sources that never answered (once) → the counties across any line within reach.
 * A county's server holds only its own parcels, so a lot returned at the point is the lot there — the later rounds can find a
 * lot the first missed, never substitute a wrong one (which is why they are sequential, not one wider race).
 *
 * Pure orchestration: `identify` is injected (defaults to `identifyParcelEager`), so the round logic is unit-tested without a
 * network. Result is `identifyParcelEager`'s shape plus `queried` (every candidate asked, all rounds), `via`
 * ("primary" | "retry" | "neighbour" | null) and `silent` (county keys that never answered in any round). */
import { identifyParcelEager } from "./arcgis.js";

const sameSource = (a, b) => a.county === b.county || (a.url && b.url && a.url === b.url);

export async function identifyWithLineFallback({ primary = [], neighbours = null, lng, lat, identify = identifyParcelEager, onSettled, retryErrored = true } = {}) {
  const queried = [];
  const answered = new Set(); // county keys that answered OK in some round
  const silent = new Set();   // county keys that have not (yet) answered OK
  let last = null;
  const round = async (list, via) => {
    if (!list.length) return null;
    list.forEach((c) => { if (!queried.some((q) => sameSource(q, c))) queried.push(c); });
    const res = await identify(list, lng, lat, { onSettled });
    (res.sources || []).forEach((s, i) => {
      const key = s.county || (list[i] && list[i].county);
      if (s.ok) { answered.add(key); silent.delete(key); } else if (!answered.has(key)) silent.add(key);
    });
    last = res;
    return res.hits && res.hits.length ? { ...res, via } : null;
  };
  const finish = (hit) => ({
    ...(hit || last || { hits: [], sources: [], complete: true }),
    hits: hit ? hit.hits : [],
    responded: answered.size,
    errors: silent.size,
    queried,
    via: hit ? hit.via : null,
    silent: [...silent],
  });

  let hit = await round(primary, "primary");
  if (hit) return finish(hit);

  if (retryErrored && last) {
    const again = primary.filter((c, i) => last.sources && last.sources[i] && !last.sources[i].ok);
    hit = await round(again, "retry");
    if (hit) return finish(hit);
  }

  if (typeof neighbours === "function") {
    let extra = [];
    try { extra = (await neighbours()) || []; } catch (_e) { extra = []; }
    extra = extra.filter((c) => c && c.url && !queried.some((q) => sameSource(q, c)));
    hit = await round(extra, "neighbour");
    if (hit) return finish(hit);
  }
  return finish(null);
}
