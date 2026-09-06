/* Model workspace — project-derived, READ-ONLY built-in names (spreadsheet-live-data-refs).
 *
 * Exposes facts already captured elsewhere in Planyr — the open project's site plan, its
 * leasing comps — as dotted, namespaced formula NAMES (`Site.Acres`, `Plan.Building1.SF`,
 * `Comp.<title>.RentPSF`) rather than inventing a second reference mechanism: every name here
 * is injected into `ctx.names` (sheetEngine.js's `evaluateWorkbook`) alongside the sheet's own
 * user-defined named ranges, resolved through the SAME "name" AST node the formula engine
 * already parses a bare identifier into (src/shared/formula/formula.js). See that file's own
 * header note on `resolveNamedRange` for the `{computed:true, value}` entry shape this adds
 * beside the pre-existing `{r1,c1,r2,c2}` cell-range one.
 *
 * READ-ONLY, ONE DIRECTION. This module only READS the site plan / comps data — it never writes
 * back to either. Per the owner's standing rule (claude/RULE-the-model-gets-capabilities-never-
 * presets.md): this is a CAPABILITY (a name resolves to a live project fact), never a preset, a
 * scaffolded row, or a real-estate opinion — the user still types the reference and builds their
 * own layout around it.
 *
 * LIVE, NEVER SNAPSHOTTED. `buildProjectNames` re-reads the site model (a synchronous,
 * side-effect-free localStorage read — see `loadSite`) and re-derives every value FRESH on every
 * call — nothing here is cached across calls. The caller (ModelApp.jsx) re-runs it whenever the
 * workbook recalculates, and re-triggers a recalc whenever the open project's site content
 * changes (`onSiteModelChanged`, storage.js) or its comps are re-fetched — never a value
 * captured once at the moment a formula was typed.
 *
 * NAMING is dotted and case-insensitive, matching `validateNameText`'s own identifier shape
 * (`[A-Za-z_][A-Za-z0-9_.]*` — no whitespace). A comp's own `title` can hold spaces/punctuation a
 * formula identifier can't, so the identifier SEGMENT is that title with every character other
 * than a letter/digit/underscore stripped (`sanitizeIdentSegment`) — e.g. a comp titled
 * "123 Main St." is addressed as `Comp.123MainSt.RentPSF`. Two comps whose titles collapse to the
 * SAME segment are as ambiguous as two comps sharing a title outright (see below).
 * `RESERVED_NAME_PREFIXES` (namedRanges.js) is what stops a user ever defining a name that could
 * collide with one of these; imported from there rather than duplicated.
 *
 * ERRORS, NEVER A SILENT ZERO OR A STALE NUMBER (per the build brief). Three distinct cases:
 *   - The prefix names a real, always-present concept (`Site.*`) but the project has no site
 *     plan yet, or no parcels drawn → injected as `errVal(FORMULA_ERRORS.REF)` ("no such
 *     source" — a real reference, currently broken).
 *   - The identifier names something that EXISTS but the requested FIELD doesn't apply to it
 *     (rent PSF on a land comp; a comp with no executed date yet) → injected as
 *     `errVal(FORMULA_ERRORS.NA)` ("not applicable" — the source is real, the fact isn't).
 *   - The identifier names something that does not currently exist at all (a deleted/renamed
 *     building or comp) → simply never injected into the map, so the engine's own pre-existing
 *     unknown-name path reports the ordinary `#NAME?` — never special-cased here.
 *
 * RENAME CONTRACT — decided and stated per the build brief, not left ambiguous:
 *   - A BUILDING has no user-typed name in the site model today (siteModel.js) — only a
 *     POSITIONAL label ("Building1", "Building2", …, the same numbering already shown on the
 *     canvas/legend) that RENUMBERS when an earlier building is deleted. So `Plan.Building2.SF`
 *     always names WHATEVER IS CURRENTLY SECOND, not a persistent identity, and breaks to
 *     `#NAME?` only once fewer than that many buildings remain. This is a disclosed limitation
 *     of the underlying data model, not a new risk this feature introduces — a future "name your
 *     buildings" feature would let this key off a stable id instead.
 *   - A COMP is addressed by its own typed `title`. Renaming a comp's title BREAKS the old name
 *     (`#NAME?`) and starts resolving the new one — nothing repoints automatically, matching how
 *     the formula engine already treats a renamed [Column] or a renamed named range.
 *   - `Site.Acres` / `Site.County` have no separate "identity" to lose — they always resolve to
 *     the CURRENT project's current site, or `#REF!` if there isn't one.
 *
 * DEFERRED, stated rather than silently dropped:
 *   - `Site.Jurisdiction` (in the brief's suggested naming) is NOT built. Unlike acreage/county,
 *     a site's jurisdiction is resolved by a live GIS parcel-containment lookup
 *     (site-planner/lib/jurisdiction.js) — network-bound, asynchronous, and not cached anywhere
 *     on the site model itself. A formula name has to resolve synchronously from already-known
 *     data; wiring an async GIS round-trip into formula evaluation is a materially bigger, riskier
 *     change than this round's scope. `Site.Acres`/`Site.County` (a plain stored field) cover the
 *     two fields that ARE synchronously available.
 *   - `Site.County` reads the site's own normalized routing key verbatim (e.g. "harris",
 *     "fortbend" — see siteModel.js's `normCountyKey`) rather than a prettified display name
 *     ("Harris County") — a full display-name lookup pulls in the large per-state
 *     `site-planner/lib/counties.js` registry for a cosmetic gain only; deferred.
 *   - Schedule task dates are NOT built this round (the brief allowed deferring them "if cheap"
 *     — they are not: `fetchScheduleProjects()` is a separate async Supabase read with its own
 *     project-linking indirection, the same shape as comps but with no synchronous fallback at
 *     all). Land comps' size (stored in acres, not SF) is likewise not exposed under `.SizeSF`
 *     this round — converting is a plain unit fact, not an opinion, but keeping the SF names
 *     strictly SF-native avoids a silently-implied unit conversion; a `.SizeAC` counterpart is
 *     natural follow-up work, not built here.
 */
import { errVal, FORMULA_ERRORS, makeDate, parseLooseDate } from "../../../shared/formula/formula.js";
import { RESERVED_NAME_PREFIXES } from "./namedRanges.js";
import { loadSite } from "../../site-planner/lib/storage.js";
import { siteAcres } from "../../site-planner/lib/siteBoundary.js";
import { elementsOf, isBuilding, buildingNumbers } from "../../site-planner/lib/siteModel.js";

export { RESERVED_NAME_PREFIXES };

const refErr = () => errVal(FORMULA_ERRORS.REF);
const naErr = () => errVal(FORMULA_ERRORS.NA);

/** Strip everything but letters/digits/underscore — the identifier segment a comp's own
 *  (possibly space- and punctuation-filled) title collapses to. Never empty-checked here; the
 *  caller skips a comp whose title sanitizes to nothing (nothing to name it by). */
function sanitizeIdentSegment(text) {
  return String(text ?? "").replace(/[^A-Za-z0-9_]/g, "");
}

/** The shoelace-formula polygon area — deliberately DUPLICATED from
 *  `site-planner/lib/siteGeometry.js`'s own `polyArea` (same formula, same "no usable ring → 0"
 *  guard) rather than imported: importing it pulled that module into a THIRD shared chunk split
 *  across the Site route AND this lazy Model chunk (measured — `npm run ci-parity`'s bundle
 *  budget flagged a brand-new `siteGeometry` chunk appearing on a plain Site-route load, +39 KB,
 *  for a few lines of pure math). Same convention `shared/CLAUDE.md` already documents for
 *  `releaseCanvas.js`: a module reachable from two routes gets hoisted into a chunk BOTH pay for,
 *  so a few duplicated lines of dependency-free math is cheaper than a shared import here. */
function polyAreaSf(pts) {
  if (!Array.isArray(pts) || !pts.length) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/** A building's footprint, sq ft — the SAME derivation SitePlanner.jsx's own metrics use: a
 *  polygon-shaped building (`el.points` set) reads its own ring area; a rectangular one is
 *  w×h plus any attached dogEar bump-out corners. There is no second-story concept in the site
 *  model today, so `.SF` and `.Footprint` (below) are deliberately the SAME number — see this
 *  file's header. */
function buildingFootprintSf(el, els) {
  if (Array.isArray(el.points) && el.points.length >= 3) return polyAreaSf(el.points);
  const bumps = els.filter((x) => x.attachedTo === el.id && x.dogEar);
  const bumpArea = bumps.reduce((s, b) => s + (Number(b.w) || 0) * (Number(b.h) || 0), 0);
  return (Number(el.w) || 0) * (Number(el.h) || 0) + bumpArea;
}

/** `Site.*` and `Plan.<building>.*` — everything derivable synchronously from the project's own
 *  site model (see the file header for what's deliberately NOT here — Site.Jurisdiction). `null`/
 *  missing `projectId` reads exactly like a project with no site plan yet: `Site.*` reads
 *  `#REF!`, and no `Plan.*` names are injected at all (so referencing one is an ordinary
 *  `#NAME?`, not a special-cased error). */
function siteEntries(projectId) {
  const out = {};
  const put = (name, value, sourceLabel) => { out[name.toLowerCase()] = { name, computed: true, value, sourceLabel }; };

  let site = null;
  if (projectId) {
    try { site = loadSite(projectId); } catch (_) { site = null; }
  }

  // A site record with NO parcels drawn yet — or none currently ACTIVE (deactivated by a split,
  // a delete-and-undo, …) — is functionally "no site plan" for acreage purposes: `siteAcres`
  // itself (siteBoundary.js -> polyClip.js's `dissolvedParcelSqft`) dissolves only `active !==
  // false` parcels and returns a plain 0 once none qualify. Showing that 0 verbatim would be
  // exactly the silent-zero this feature is built to avoid (requirement c) — checked the same
  // way the dissolve itself decides "is there anything to dissolve at all".
  const hasParcels = !!(site && Array.isArray(site.parcels) && site.parcels.some((p) => p && p.active !== false));
  if (!site || !hasParcels) {
    put("Site.Acres", refErr(), "Site plan — no parcels drawn yet for this project");
    put("Site.County", (site && site.county) || refErr(), "Site plan · county");
    return out;
  }

  put("Site.Acres", siteAcres(site), "Site plan · total acreage");
  put("Site.County", site.county || refErr(), "Site plan · county");

  const els = elementsOf(site);
  const numbers = buildingNumbers(els); // Map<elementId, 1-based positional number>
  for (const el of els) {
    if (!isBuilding(el)) continue;
    const n = numbers.get(el.id);
    if (!n) continue;
    const sf = buildingFootprintSf(el, els);
    const label = `Plan.Building${n}`;
    put(`${label}.SF`, sf, `Site plan · Building ${n} · footprint (SF)`);
    put(`${label}.Footprint`, sf, `Site plan · Building ${n} · footprint (SF)`);
  }
  return out;
}

/** A comp's simple stated lease rate — never the derived net-effective/opex-normalized figures
 *  (comps.js), per the build brief's "the simple stated rate field, not a derived one." Only a
 *  LEASE comp has one; anything else is "not applicable," never a silent zero. */
function compRentPsf(comp) {
  if (comp.compType !== "lease" || typeof comp.leaseRate !== "number") return naErr();
  return comp.leaseRate;
}

/** A comp's size in SF — the type-appropriate field, verbatim (never converted). A land comp's
 *  size is stored in acres (`landSizeValue`/`landSizeUnit`) and is deliberately NOT exposed under
 *  `.SizeSF` this round — see the file header. */
function compSizeSf(comp) {
  if (comp.compType === "lease" && typeof comp.leaseSizeSf === "number") return comp.leaseSizeSf;
  if (comp.compType === "building_sale" && typeof comp.bldgSizeSf === "number") return comp.bldgSizeSf;
  return naErr();
}

/** A comp's executed date, as the engine's own date typed-value — `#N/A` (not `#REF!`) when the
 *  comp is real but simply has no date recorded yet (comps.js's B986096 note: `compDate` is
 *  usually required at entry, but a legacy/edge row can still be missing it). */
function compDateValue(comp) {
  const serial = comp.compDate ? parseLooseDate(comp.compDate) : null;
  return serial == null ? naErr() : makeDate(serial);
}

/** `Comp.<title>.*` for every comp belonging to this project with a real, non-blank `title` —
 *  comps with no title aren't addressable by name at all (a fallback like the internal id would
 *  be meaningless to type). `comps` is the caller's own already-fetched list (compsStore.js is
 *  async-only — see the file header); this function is pure over it. */
function compEntries(comps, projectId) {
  const out = {};
  const put = (name, value, sourceLabel) => { out[name.toLowerCase()] = { name, computed: true, value, sourceLabel }; };
  if (!Array.isArray(comps) || !projectId) return out;

  const bySegment = new Map(); // sanitized segment -> [{comp, title}]
  for (const c of comps) {
    if (!c || c.projectId !== projectId) continue;
    const title = String(c.title || "").trim();
    if (!title) continue;
    const segment = sanitizeIdentSegment(title);
    if (!segment) continue;
    if (!bySegment.has(segment)) bySegment.set(segment, []);
    bySegment.get(segment).push({ comp: c, title });
  }

  for (const [segment, list] of bySegment) {
    const base = `Comp.${segment}`;
    if (list.length > 1) {
      // Two comps whose titles read the same (or sanitize to the same identifier) is a real
      // ambiguity — pick one silently and it's a wrong number that looks right. LOUD-FAILURE:
      // every field under this title reads broken until the titles are told apart.
      const titles = [...new Set(list.map((x) => x.title))].join('", "');
      const note = `${list.length} comps share the name "${list[0].title}" — rename one so ${base}.* knows which to use ("${titles}").`;
      put(`${base}.RentPSF`, refErr(), note);
      put(`${base}.SizeSF`, refErr(), note);
      put(`${base}.Date`, refErr(), note);
      continue;
    }
    const { comp, title } = list[0];
    put(`${base}.RentPSF`, compRentPsf(comp), `Comp · ${title} · rent per SF`);
    put(`${base}.SizeSF`, compSizeSf(comp), `Comp · ${title} · size (SF)`);
    put(`${base}.Date`, compDateValue(comp), `Comp · ${title} · executed date`);
  }
  return out;
}

/** The whole project-derived name map for one project — `Site.*`, `Plan.<building>.*` and
 *  `Comp.<title>.*` — ready to spread into a sheet's own `ctx.names` (sheetEngine.js). `comps` is
 *  the caller's own already-fetched, unfiltered comps list (or `undefined`/`null` — no comps
 *  fetched yet just means no `Comp.*` names resolve, exactly like a project with no comps at all). */
export function buildProjectNames(projectId, { comps } = {}) {
  let site = {};
  try { site = siteEntries(projectId); } catch (_) { site = {}; }
  let comp = {};
  try { comp = compEntries(comps, projectId); } catch (_) { comp = {}; }
  return { ...site, ...comp };
}
