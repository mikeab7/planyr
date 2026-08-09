/* PLACEMENT + DEED-PROMOTION COMMANDS — the "the GIS is down" command surface, loaded on demand.
 *
 * ⛔ WHY THESE LIVE HERE AND NOT IN `SitePlanner.jsx`. Measured, not assumed: kept inline, this
 * tranche's command bodies and their owner-facing copy added **9.9 KB** to the Site route's largest
 * chunk — a chunk that arrives with 2.3 KB of headroom left in its band. Every command below is
 * reached only by a deliberate, rare act (locating a plan, nudging its placement, promoting a deed),
 * so none of it belongs on the path every session pays for. This is the `exportSheet.js` pattern
 * (B1042) applied again: the planner passes a `ctx` object rebuilt per call, so add a key THERE
 * rather than reaching back into the component, and nothing here closes over planner state.
 *
 * THE MODEL these encode (full derivation in `lib/sitePlacement.js`):
 *   • the drawing lives in LOCAL FEET and never moves when a location lands; the origin only says
 *     where that local frame sits on the earth;
 *   • NUDGE re-anchors the frame — not one drawn coordinate changes;
 *   • TURN is the one adjustment that moves geometry, because the feet frame is axis-aligned to
 *     true north and has no rotation term to turn.
 *
 * Guards: test/parcelOfflineWiring.test.js (wiring, mutation-proven) plus the live specs
 * e2e/set-location-unlocated-plan.spec.js and e2e/deed-promote-to-parcel.spec.js.
 */
import { normalizeOrigin, sameOrigin, originAtOffset } from "./sitePlacement.js";
import { rotateSiteCollections, siteRotationPivot, normalizeRot } from "./sitePlacementRotate.js";

/* Set the live anchor. `ctx.setMeta` writes it into the save metadata in the SAME turn, because the
 * planner's autosave effect is declared far above the metadata assignment and would otherwise
 * persist the stale (null) anchor on the very commit a location lands. */
export function applyOriginState(ctx, next) {
  const o = normalizeOrigin(next);
  ctx.setOrigin(o);
  ctx.setMeta({ origin: o });
  if (o) ctx.ensureBasemapOn(); // a located plan shows the aerial — that is the whole point of locating it
  return o;
}

/* Persist a placement change RIGHT NOW rather than on the autosave debounce, and verify it landed
 * (LOUD-FAILURE — a "located ✓" that didn't save is the B473 class this repo has paid for twice).
 * `collections` is passed explicitly because the planner's live mirror only catches up next render. */
export function persistPlacement(ctx, nextOrigin, collections) {
  if (!ctx.siteId || ctx.isDeleted()) return;
  const fresh = !ctx.loadSite(ctx.siteId);
  const payload = { id: ctx.siteId, ...ctx.meta(), origin: nextOrigin, ...ctx.live(), ...(collections || {}) };
  const ok = ctx.saveSite(payload);
  if (!ok) {
    ctx.setLocalSaveFailed(true);
    ctx.report("save-verify-failed", "placement change did not persist on device", { id: ctx.siteId, what: "origin" });
  } else {
    ctx.setLocalSaveFailed(false);
    if (fresh) ctx.onSiteSaved?.();
  }
  if (!ctx.cloudActive() || ctx.readOnly()) return;
  ctx.setSaveStatus("saving");
  /* Push the LIVE payload (not by id): the mirror write above may have failed on a full device, and
   * a by-id push would then ship the stale pre-placement copy to the cloud too (B473). */
  ctx.pushModelToCloud(payload)
    .then((r) => { if (r && r.ok) { ctx.setSaveStatus("saved"); ctx.setCloudSaveFailed(false); } else { ctx.setSaveStatus("unsaved"); ctx.setCloudSaveFailed(true); } })
    .catch(() => { ctx.setSaveStatus("unsaved"); ctx.setCloudSaveFailed(true); });
}

/* Push a rotated set of collections into planner state and hand the same object back for the save. */
function applyRotated(ctx, spun) {
  const n = spun.next;
  ctx.setCollections(n);
  try { ctx.flushElems(n); } catch (_) {} // a rotation is a gesture boundary — commit the settled result now
  return { parcels: n.parcels, els: n.els, measures: n.measures, callouts: n.callouts, markups: n.markups, sheetOverlays: n.sheetOverlays };
}

/* Set (or move) the plan's anchor. `rotateDeg` folds a rotation into the SAME undo frame, which is
 * what makes "line my hand-drawn boundary up with the aerial" one action rather than two. */
export function commitOrigin(ctx, next, { rotateDeg = 0, note = "" } = {}) {
  const o = normalizeOrigin(next);
  if (!o) { ctx.flashWarn("That isn't a usable position — check the address or the latitude/longitude.", 7000); return false; }
  const had = ctx.origin();
  if (sameOrigin(o, had) && !rotateDeg) return true; // nothing to record
  ctx.pushHistory();
  let collections = null, spun = null;
  if (rotateDeg) { spun = rotateSiteCollections(ctx.state(), rotateDeg); collections = applyRotated(ctx, spun); }
  applyOriginState(ctx, o);
  persistPlacement(ctx, o, collections);
  ctx.flashWarn(note || (had
    ? `Moved the plan's location. Everything you drew is unchanged — only where it sits on the earth changed.${spun && spun.unrotatable.length ? " The captured aerial underlay can't be turned, so it was left where it was." : ""}`
    : "Location set — the aerial, flood layer, contours and county rules are switching on. Nothing you drew moved."), 9000);
  return true;
}

/* Rotate the whole plan about its body centre — for a boundary plotted from a deed, which never
 * lands square on the aerial first try. The anchor does not move. */
export function rotatePlan(ctx, deg) {
  const d = Number(deg) || 0;
  if (!d) return;
  if (!siteRotationPivot(ctx.state())) { ctx.flashWarn("There's nothing drawn to rotate yet.", 5000); return; }
  ctx.pushHistory();
  const spun = rotateSiteCollections(ctx.state(), d);
  persistPlacement(ctx, ctx.origin(), applyRotated(ctx, spun));
  ctx.bumpPlaceRot((r) => normalizeRot(r + d));
  if (spun.unrotatable.length)
    ctx.flashWarn(`Turned the plan ${Math.abs(d).toFixed(1)}° ${d > 0 ? "clockwise" : "counter-clockwise"}. The captured aerial underlay is a fixed north-up picture, so it stayed put.`, 9000);
}

/* Nudge the plan across the ground. NOT a geometry edit: the anchor moves, so every drawn
 * coordinate is untouched and the plan simply sits somewhere slightly different. */
export function nudgePlan(ctx, dxFt, dyFt) {
  const cur = ctx.origin();
  if (!cur) return;
  const next = originAtOffset(cur, dxFt, dyFt);
  if (!next) return;
  ctx.pushHistory();
  applyOriginState(ctx, next);
  persistPlacement(ctx, next, null);
}

/* ── NEW-2 — PROMOTE A PLOTTED DEED TO THE PARCEL BOUNDARY ─────────────────────────────────────
 *
 * When the county service is down, the legal description IS the boundary. A plotted deed was only
 * ever a MARKUP: the one thing its menu offered was "Align to parcel", which needs a county parcel
 * to already exist. The promoted lot goes through the same shape a map-clicked parcel does, so
 * acreage, setbacks, edge runs, the acreage chip and the area math all work identically — plus
 * three things a clicked parcel does not carry: `source: "deed"` (provenance, so a reviewer is
 * never shown a plotted deed as a county record), `deedMisclosureFt` (a deed closing to 0.4 ft and
 * one closing to 40 ft must not look the same on screen), and the save-and-except rings as
 * `exceptions`, deducted from every area consumer.
 *
 * An OPEN traverse is refused LOUDLY rather than quietly closed: a boundary is not the place to
 * guess at a missing call. */
export function promoteDeedToParcel(ctx, id) {
  const misclosure = ctx.deed().misclosure;
  const m = ctx.markups().find((x) => x.id === id && x.kind === "encumbrance");
  if (!m || !(m.pts && m.pts.length >= 3)) { ctx.flashWarn("Select a plotted deed boundary first.", 5000); return; }
  const members = ctx.deedGroupMembers(m);
  const main = ctx.deedMainOf(members, m);
  if (!(main.pts && main.pts.length >= 3)) { ctx.flashWarn("That deed has no closed outline to promote.", 6000); return; }
  const gap = misclosure(main.centerline && main.centerline.length ? main.centerline : [...main.pts, main.pts[0]]);
  if (main.closed === false) {
    ctx.flashWarn(`This deed's calls don't close (they end about ${gap.toFixed(1)}′ from where they started), so it can't become a property boundary. Check the description for a missing or mistyped call, then plot it again — or draw the boundary by hand.`, 0);
    return;
  }
  const already = ctx.parcels().find((p) => p.fromDeedGroup && main.deedGroup && p.fromDeedGroup === main.deedGroup);
  if (already) { ctx.selectParcel(already.id); ctx.flashWarn("This deed is already the parcel boundary — selected it.", 6000); return; }
  const clone = (pts) => pts.map((p) => ({ x: p.x, y: p.y }));
  const exceptions = members.filter((x) => x.except && x.pts && x.pts.length >= 3)
    .map((x) => ({ pts: clone(x.pts), label: x.label || "Save & except" }));
  const pc = {
    id: ctx.uid(), points: clone(main.pts), locked: true,
    ...ctx.parcelDefaultStyle(), // born with the user's Standards parcel defaults, like every parcel (B929)
    source: "deed",
    label: main.label && main.label !== "Tract boundary" ? main.label : null,
    deedMisclosureFt: Number.isFinite(gap) ? Math.round(gap * 100) / 100 : null,
    fromDeedGroup: main.deedGroup || null,
    ...(exceptions.length ? { exceptions } : {}),
  };
  ctx.pushHistory();
  ctx.addParcel(pc);
  ctx.selectParcel(pc.id);
  ctx.flashPolyWarn(pc.points, "Parcel"); // the same self-intersection / zero-area guard a drawn parcel gets
  const exNote = exceptions.length ? ` Its ${exceptions.length} save-and-except tract${exceptions.length > 1 ? "s are" : " is"} carved out of the acreage.` : "";
  const closeNote = gap > 1
    ? ` ⚠ The calls close to about ${gap.toFixed(1)}′ — loose for a boundary; verify before you rely on it.`
    : ` The calls close to about ${gap.toFixed(2)}′.`;
  ctx.flashWarn(`Boundary set from the deed.${closeNote}${exNote} The deed stays on the plan so you can still compare it, or align it once the county map is back.`, 12000);
}
