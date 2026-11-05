/* ⛔ NEW-1 (Memphis line band, B2289168 ×3) — THE ONE LOT-CLICK IDENTIFY, shared by every lot-picking flow (the Map's
 * Select parcels click, its address search, and the planner's identify-and-add `quickAddAt`).
 *
 * A click used to be ONE round: ask the county the bundled geometry names, and if it has nothing, say "No lot here". Two
 * measured ways that refused a real lot:
 *   1. THE GEOMETRY NAMED THE WRONG COUNTY. Along the Tennessee–Mississippi line the asset sits ≈550 m north of the surveyed
 *      line, so a Shelby lot on the north side of Stateline Rd was asked of DeSoto alone (see `lineNeighbourKeysForPoint`).
 *   2. A STALLED CONNECTION. One request in a burst of ~80 to the Shelby relay hung for the full 30 s connect timeout while the
 *      rest answered in under a second — a fresh connection answers; the same click used to report an outage.
 *   3. A SKIPPED SOURCE. A source whose circuit breaker is open is dropped from the click — but the breaker is also fed by the
 *      OUTLINE layer, so a county whose outlines kept failing (MARIS, 24 counties, asked for a column it does not have) was
 *      never asked about a click inside it, and its lot read "No lot here".
 * So a click is now up to five rounds, each only when the one before found NO lot:
 *   primary → (NEW-2, 2026-10-28) the FALLBACK for a county that did not answer: its state's statewide layer when that layer really
 *   holds the county, then any town layer the county row declares (lib/parcelFallbacks.js) → retry the sources that never answered
 *   (once) → the counties across any line within reach → the sources the breaker skipped (asked once, last, because they are the
 *   ones most likely to be slow).
 *   The fallback round comes BEFORE the slow retry on purpose (owner: "wire it to the county one, but then default it to the state one"):
 *   a county that has already missed its quick round should not hold the click for another long wait when the state's layer can answer
 *   now. It is asked ONLY when a county was SILENT (errored / timed out) — a county that answered "no lot here" is never second-guessed
 *   by a layer that lags it — and a lot it finds is returned with `via: "fallback"` and `fallback: {kind, label, failed}` on the hit so
 *   the surface says so. The failed county stays SILENT in the bookkeeping (its fallback's answer never counts as the county answering),
 *   so a click nothing could answer still reads "couldn't reach the county server", never "No lot here".
 * A county's server holds only its own parcels, so a lot returned at the point is the lot there — the later rounds can find a
 * lot the first missed, never substitute a wrong one (which is why they are sequential, not one wider race).
 *
 * Pure orchestration: `identify` is injected (defaults to `identifyParcelEager`), so the round logic is unit-tested without a
 * network. Result is `identifyParcelEager`'s shape plus `queried` (every candidate asked, all rounds), `via`
 * ("primary" | "fallback" | "retry" | "neighbour" | "skipped" | null) and `silent` (county keys that never answered in any round). */
import { identifyParcelEager } from "./arcgis.js";
import { CLICK_RETRY_BUDGET_MS } from "./slowSource.js";

const sameSource = (a, b) => a.county === b.county || (a.url && b.url && a.url === b.url);

export async function identifyWithLineFallback({ primary = [], fallbacks = null, neighbours = null, skipped = null, lng, lat, identify = identifyParcelEager, onSettled, retryErrored = true, retryTimeoutMs = CLICK_RETRY_BUDGET_MS } = {}) {
  const queried = [];
  const answered = new Set(); // county keys that answered OK in some round
  const silent = new Set();   // county keys that have not (yet) answered OK
  let last = null;
  const round = async (list, via, extra = {}) => {
    if (!list.length) return null;
    list.forEach((c) => { if (!queried.some((q) => sameSource(q, c))) queried.push(c); });
    const res = await identify(list, lng, lat, { onSettled, ...extra });
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

  /* NEW-2 — the county did not ANSWER (not "answered with nothing"): ask what stands in for it. Booked separately from `round` so the
   * failed county stays silent and `last` (which the retry round indexes against `primary`) is not overwritten. */
  if (typeof fallbacks === "function" && silent.size) {
    let fb = [];
    try { fb = (await fallbacks({ silent: [...silent] })) || []; } catch (_e) { fb = []; }
    fb = fb.filter((c) => c && c.url && !queried.some((q) => q.county === c.county)); // never re-ask a source the primary round already asked (answered empty, or just failed)
    if (fb.length) {
      fb.forEach((c) => { if (!queried.some((q) => q.county === c.county)) queried.push(c); });
      const res = await identify(fb, lng, lat, { onSettled });
      if (res.hits && res.hits.length) {
        const hits = res.hits.map((h) => {
          const c = fb.find((x) => x.county === h.county) || {};
          return { ...h, county: c.asCounty || h.county, fallback: { kind: c.kind || "state", label: c.label || null, failed: c.failedKey || null } };
        });
        return finish({ ...res, hits, via: "fallback" });
      }
    }
  }

  if (retryErrored && last) {
    const again = primary.filter((c, i) => last.sources && last.sources[i] && !last.sources[i].ok);
    /* NEW-2 (2026-10-22) — the retry round WAITS LONGER than the quick first round: a source that missed the app's 8 s is usually waking up (the Comptroller layer's cold ask has taken 27 s),
     * and a click whose only crime was reaching it early used to read as an outage. The first round keeps 8 s so a dead host still cannot stall the click. */
    hit = await round(again, "retry", { timeoutMs: retryTimeoutMs });
    if (hit) return finish(hit);
  }

  if (typeof neighbours === "function") {
    let extra = [];
    try { extra = (await neighbours()) || []; } catch (_e) { extra = []; }
    extra = extra.filter((c) => c && c.url && !queried.some((q) => sameSource(q, c)));
    hit = await round(extra, "neighbour");
    if (hit) return finish(hit);
  }

  if (typeof skipped === "function") {
    let rest = [];
    try { rest = (await skipped()) || []; } catch (_e) { rest = []; }
    rest = rest.filter((c) => c && c.url && !queried.some((q) => sameSource(q, c)));
    hit = await round(rest, "skipped");
    if (hit) return finish(hit);
  }
  return finish(null);
}
