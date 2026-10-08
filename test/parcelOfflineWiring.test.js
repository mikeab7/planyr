/* WIRING GUARDS for the "the GIS is down, let me draw the parcel" tranche.
 *
 * ⛔ WHY THESE EXIST, and why they are SOURCE guards rather than behaviour tests.
 *
 * Two failures in this repo's recent history are the exact shape this tranche risks, and a pure
 * unit test on the libraries cannot see either of them:
 *   • B1422 — a mechanism shipped complete while the DATA it needed never did, so the gate could
 *     never fire in the direction that mattered. It looked done for a year.
 *   • This tranche's own near-miss — `promoteDeedToParcel` was written, unit-testable, and
 *     REACHABLE FROM NO MENU. The dead-store ratchet caught it; nothing else would have.
 *
 * So each guard below asserts that a shipped mechanism is actually CONNECTED to the surface that
 * makes it reachable, or that a consumer reads the function that carries the new fact. Every one is
 * mutation-checked (documented per block: delete the wiring, watch it go red).
 *
 * The BEHAVIOUR of the libraries lives in test/sitePlacement.test.js and test/parcelRecord.test.js;
 * the live-browser half (does the aerial actually come on) is V-numbered in VERIFICATION.md,
 * because no static reading can see runtime.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8");
const planner = read("../src/workspaces/site-planner/SitePlanner.jsx");
const app = read("../src/workspaces/site-planner/SitePlannerApp.jsx");
const finder = read("../src/workspaces/site-planner/MapFinder.jsx");
const layerPanel = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
const recordPanel = read("../src/workspaces/site-planner/components/ParcelPage.jsx");
const infoCard = read("../src/workspaces/site-planner/components/ParcelInfoCard.jsx");

describe("NEW-1 — a plan's location is SETTABLE, and everything gated on it re-reads the live value", () => {
  /* Mutation: change `useState(() => normalizeOrigin(restored?.origin))` back to
     `const origin = restored?.origin || null` → this goes red. */
  it("`origin` is REACT STATE, not a read-only field off the restored record", () => {
    /* B519907 renamed the STATE to `originRaw` and derives an identity-stable `origin` from it, so
       an undo restoring an equal-valued origin no longer re-runs ten effects (and no longer tears
       the basemap down). The invariant this guards is unchanged — the anchor is SETTABLE React
       state, not a read-only field off the restored record — so the guard tracks the new name. */
    expect(planner).toMatch(/const \[originRaw, setOrigin\] = useState\(\(\) => normalizeOrigin\(restored\?\.origin\)\)/);
    expect(planner, "`origin` must still be derived from that state").toMatch(/const origin = useMemo\(\s*\(\) => originRaw,/);
    // …and the old read-only form is gone, so it cannot come back by accident.
    expect(planner.includes("const origin = restored?.origin || null;")).toBe(false);
  });

  /* Mutation: drop `origin` from the metaRef assignment → red. This is the field that PERSISTS,
     so a plan located in the UI but not written here would lose its anchor on the next reload. */
  it("the saved metadata reads the LIVE anchor, and is assigned during render (not a passive effect)", () => {
    expect(planner).toMatch(/\n  metaRef\.current = \{ site: siteLabel, name: planLabel, groupId, county: [^\n]*, origin \};/);
  });

  /* Mutation: revert the county-heal effect's deps to `[siteId]` → red. This is the single line
     that turns "I set a location" into county → jurisdiction → setbacks → drainage rules, and it
     is exactly the B1422 shape: the mechanism (setting origin) is useless if this never re-runs. */
  it("county detection re-runs when a location LANDS, not only at mount", () => {
    const heal = planner.slice(planner.indexOf("countyAtPoint(o.lon, o.lat)"));
    expect(heal.slice(0, 2000)).toMatch(/\}, \[siteId, origin\]\);/);
  });

  /* Mutation: remove `origin` from stateRef / histKey / applySnapshot → red.
     Without all three, a placement change is not undoable as one frame. */
  it("the anchor rides the undo snapshot — recorded, keyed, and restored", () => {
    expect(planner).toMatch(/stateRef\.current = \{[^}]*, origin \};/);              // recorded
    expect(planner).toMatch(/"\|O:" \+ \(s\.origin \?/);                              // keyed (a change is its own frame)
    expect(planner).toMatch(/if \(s\.origin !== undefined\) \{\s*\n\s*const o = normalizeOrigin\(s\.origin\);/); // restored
  });

  /* Mutation: delete `ensureBasemapOn()` from applyOriginState → red. The aerial coming on IS
     the owner-visible payoff; a located plan that still shows blank paper reads as a no-op. */
  it("landing an anchor turns the aerial on", () => {
    // The command body moved to lib/plannerPlacementCmds.js (loaded on demand — measured at 9.9 KB
    // of the Site route's largest chunk when inline). The guard follows it.
    const cmds = read("../src/workspaces/site-planner/lib/plannerPlacementCmds.js");
    const fn = cmds.slice(cmds.indexOf("export function applyOriginState"), cmds.indexOf("export function persistPlacement"));
    expect(fn).toContain("ctx.ensureBasemapOn()");
    expect(fn).toContain("ctx.setOrigin(o)");
    // …and the undo path restores it synchronously, in the planner itself.
    expect(planner).toMatch(/if \(o\) ensureBasemapOn\(\);/);
  });

  /* Mutation: delete either entry point → red. A settable origin nobody can reach is B1422 again. */
  it("is reachable from BOTH places the owner meets an unlocated plan", () => {
    expect(planner).toContain('data-testid="set-location-cta"');                    // the Parcel panel
    expect(planner).toMatch(/onSetLocation=\{origin \? null : \(\) => setSetLocOpen\(true\)\}/); // the empty-basemap state
    expect(layerPanel).toContain('data-testid="layers-set-location"');              // …which renders it
  });

  /* Mutation: drop the LOUD-FAILURE branch in persistPlacement → red. A "located ✓" that did not
     save is the B473 class this repo has paid for twice. */
  it("a placement that fails to persist is LOUD, never a silent no-op", () => {
    const cmds = read("../src/workspaces/site-planner/lib/plannerPlacementCmds.js");
    const fn = cmds.slice(cmds.indexOf("export function persistPlacement"), cmds.indexOf("function applyRotated"));
    expect(fn).toContain("ctx.setLocalSaveFailed(true)");
    expect(fn).toContain('ctx.report("save-verify-failed"');
  });
});

describe("NEW-2 — a plotted deed can BECOME the parcel, and the menus can reach it", () => {
  /* Mutation: delete either menu row → red. This is the guard that would have caught the real
     miss in this tranche: the function existed and shipped connected to nothing. */
  it("'Use as parcel boundary' is wired into the right-click menu AND the deed inspector", () => {
    expect(planner).toContain('text: deedAlreadyPromoted(dm) ? "Already the parcel boundary" : "Use as parcel boundary"');
    expect(planner).toMatch(/on: \(\) => \{ promoteDeedToParcel\(dm\.id\); close\(\); \}/);
    expect(planner).toContain('data-testid="deed-promote"');
    // Both call sites drive the same function — never a second, drifting copy.
    expect((planner.match(/promoteDeedToParcel\(dm\.id\)/g) || []).length).toBe(2);
  });

  /* Mutation: remove the `main.closed === false` refusal → red. Manufacturing a boundary from
     calls that never return to the point of beginning is the one thing this must not do. */
  it("an OPEN traverse is refused loudly and mints no parcel", () => {
    const fn = read("../src/workspaces/site-planner/lib/plannerPlacementCmds.js");
    const refusal = fn.indexOf("if (main.closed === false)");
    expect(refusal).toBeGreaterThan(-1);
    expect(fn.slice(refusal, refusal + 700)).toMatch(/flashWarn\([^)]*don't close/);
    // The refusal RETURNS before any parcel is created — order matters, not just presence.
    expect(refusal).toBeLessThan(fn.indexOf("ctx.addParcel(pc)"));
  });

  /* Mutation: drop `deedMisclosureFt` from the promoted parcel, or drop the chip that renders it
     → red. A deed closing to 0.4′ and one closing to 40′ must not look identical on screen. */
  it("the deed's misclosure is CARRIED onto the parcel and RENDERED there", () => {
    const fn = read("../src/workspaces/site-planner/lib/plannerPlacementCmds.js");
    expect(fn).toMatch(/deedMisclosureFt: Number\.isFinite\(gap\)/);
    expect(recordPanel).toContain('data-testid="parcel-misclosure"');
    expect(recordPanel).toContain("close to {parcel.deedMisclosureFt}′");
    /* …and a loose deed is visually DISTINCT from a tight one, not just numerically different.
       Asserted on the whole call, both arguments: an earlier version of this guard matched the
       phrase anywhere in the file and stayed green when the fill tone was reverted and only the
       border kept it — a guard that survives half the defect is half a guard. */
    expect(recordPanel).toContain('color: parcel.deedMisclosureFt > 1 ? "var(--warn-text)" : "var(--text-secondary)"'); // a loose deed reads in the warning ink, a tight one quiet
  });

  /* Mutation: remove `skipDeedGroup` → red. Without it a promoted deed fits its own copy at a
     perfect 0° and "Align to county parcel" silently does nothing forever after. */
  it("a deed never 'aligns' to the parcel promoted from itself, and the two move together", () => {
    expect(planner).toMatch(/bestDeedFit\(main\.pts, \{ skipDeedGroup: main\.deedGroup \|\| null \}\)/);
    expect(planner).toMatch(/if \(skipDeedGroup && pc\.fromDeedGroup === skipDeedGroup\) continue;/);
    // Both align paths (empirical fit + grid convergence) carry the promoted parcel with them.
    expect((planner.match(/alignPromotedParcel\(main\.deedGroup/g) || []).length).toBe(2);
  });

  /* Mutation: delete the button or gut `selectDeedOfGroup` → red. MEASURED, not assumed: after
     promotion the parcel lies over the deed and the Parcel panel takes the dock, so a right-click
     where the deed visibly is answers with the PARCEL's menu — the deed was kept in the data and
     lost to the product. This is the door back in. */
  it("the deed a parcel came from stays REACHABLE, from the parcel it produced", () => {
    expect(recordPanel).toContain('data-testid="parcel-select-deed"');
    expect(recordPanel).toMatch(/parcel\.fromDeedGroup && deedFrom/);
    expect(planner).toMatch(/deedFrom=\{selectDeedOfGroup\}/);
    const fn = planner.slice(planner.indexOf("const selectDeedOfGroup = "), planner.indexOf("const deedAlreadyPromoted = "));
    expect(fn).toMatch(/setSel\(\{ kind: "markup", id: main\.id \}\)/);
    expect(fn).toContain("openInspector()");
  });

  /* Mutation: drop the `already` guard → red. A second promotion would double-count the tract in
     every yield, coverage and detention number. */
  it("promoting the same deed twice is refused", () => {
    const fn = read("../src/workspaces/site-planner/lib/plannerPlacementCmds.js");
    expect(fn).toMatch(/const already = ctx\.parcels\(\)\.find\(\(p\) => p\.fromDeedGroup/);
  });
});

describe("NEW-3 — a hand-drawn parcel carries the same record as a clicked one", () => {
  /* Mutation: delete the provenance chip → red. This is not cosmetic: a plan that goes to review
     must never present a hand-drawn boundary as though it came from the county. */
  it("provenance renders on the parcel, for every lot and not just drawn ones", () => {
    // Parcels rework (NEW-2): the page's source chip carries it, derived by lib/parcelOrigin.js (combined / county / deed / drawn).
    expect(read("../src/workspaces/site-planner/components/ParcelPage.jsx")).toContain('data-testid="parcel-provenance"');
    expect(planner).toMatch(/const origin = parcelOrigin\(pc, \{ cadName: parcelCadName, idField: parcelIdField \}\);/);
    expect(planner).toMatch(/<ParcelPage parcel=\{pc\}/);
  });

  /* Mutation: point the badge / list / Boundary rows back at `polyArea(pc.points)` → red.
     One area function, so a promoted deed's carve-outs come off every number that quotes acreage. */
  it("every acreage consumer reads the NET area, not the raw ring", () => {
    // B520560 moved the LABEL from the bare word "Parcel" to the parcel's own lineage name
    // (Parcel 1A / 1B); the AREA function under test is unchanged and is still the net one.
    expect(planner).toContain('const txt = `${(parcelInfo.get(pc.id) || {}).name || "Parcel"} ${f2(parcelNetSqft(pc) / SQFT_PER_ACRE)} AC`;'); // canvas badge
    // NEW-1 (B1239328) — the Land tab row moved acreage into its own right-aligned column
    // (account number, when present, now gets its own secondary line instead of sharing this one).
    expect(read("../src/workspaces/site-planner/lib/parcelOps.js")).toContain("acres: parcelNetSqft(pc) / SQFT_PER_ACRE"); // panel table rows (buildParcelRows)
    expect(planner).toContain("acres={parcelNetSqft(pc) / SQFT_PER_ACRE}"); // the parcel page's sub-line
    expect(planner).toContain("acres: parcelNetSqft(p) / SQFT_PER_ACRE");                            // report/print
  });

  /* Mutation: drop `parcelExceptSqft` from dissolvedParcelSqft → red (and test/polyClip.test.js
     goes red too — that one measures the number, this one pins the seam). */
  it("the SITE area function deducts save-and-except holes", () => {
    const clip = read("../src/workspaces/site-planner/lib/polyClip.js");
    expect(clip).toContain("import { parcelExceptSqft }");
    expect(clip).toMatch(/const except = active\.reduce\(\(s, p\) => s \+ parcelExceptSqft\(p\), 0\);/);
  });

  /* Mutation: commit per keystroke instead of on blur → red. A typed word must be ONE undo frame. */
  it("a typed field commits on blur/Enter, and a no-op edit burns no undo frame", () => {
    const fn = planner.slice(planner.indexOf("const setParcelField = "), planner.indexOf("const setParcelField = ") + 900);
    expect(fn).toMatch(/if \(!cur \|\| \(cur\[key\] \?\? null\) === v\) return;/);
    expect(fn).toContain("pushHistory()");
    expect(recordPanel).toContain("onBlur={(e) => { if (e.target.value !== (value || \"\")) onCommit(e.target.value); }}");
  });
});

describe("NEW-4 — an outage offers the way forward instead of dead-ending", () => {
  /* Mutation: delete `failUnavailable` / the toast button → red. */
  it("a source OUTAGE carries the fallback; 'no parcel right there' deliberately does not", () => {
    expect(finder).toMatch(/if \(res\.responded === 0\) failUnavailable\(/);
    expect(finder).toContain('data-testid="map-start-blank-here"');
    // The non-outage branch must NOT offer it — that is the distinction being guarded.
    const branch = finder.slice(finder.indexOf("if (res.responded === 0) failUnavailable("), finder.indexOf("if (res.responded === 0) failUnavailable(") + 600);
    expect(branch).toMatch(/else setErr\(gap/);
    expect(branch.includes("else failUnavailable(")).toBe(false);
  });

  /* Mutation: drop the origin from startBlankHere's payload → red. THE point of the fallback is
     that the plan is born located; without it we have merely renamed "Start blank". */
  it("the fallback captures WHERE the map is looking, so the plan is never stranded", () => {
    const fn = finder.slice(finder.indexOf("const startBlankHere = "), finder.indexOf("const startBlankHere = ") + 1400);
    expect(fn).toMatch(/const origin = \{ lat: c\.lat, lon: c\.lon != null \? c\.lon : c\.lng \}/);
    // B1399568 — awaited now (was fire-and-forget `onSkip && onSkip(…)`), so the function's own
    // in-flight guard actually covers the whole round trip through newBlankSite's write.
    expect(fn).toMatch(/await onSkip\?\.\(\{ origin, county/);
    expect(infoCard).toContain('data-testid="parcel-card-start-blank"');
  });

  /* Mutation: revert newBlankSite to `goPlan(newId())` → red. The blank path must WRITE the
     record when it has an anchor, or `persistOrDrop` throws the located plan away on leave. */
  it("'Start blank' from the map is born LOCATED and is written immediately", () => {
    // B326416 made this path async (it awaits the default-share team before the row is created,
    // because `team_id` is written only on INSERT). The GUARD is unchanged in intent: the blank
    // path must still WRITE a located record — only the signature moved.
    const fn = app.slice(app.indexOf("const newBlankSite = async (opts)"), app.indexOf("// NEW-COMPS"));
    expect(fn).toMatch(/saveSite\(\{ id, groupId: id, site: opts\.name \|\| "Untitled site", name: "Concept A", origin: o/);
    // …and it must be born with whatever sharing the account default resolves to, stamped BEFORE
    // the write rather than patched in afterwards (an afterwards-UPDATE is refused by the DB).
    expect(fn).toMatch(/await defaultShareTeam\(/);
    expect(fn.indexOf("defaultShareTeam(")).toBeLessThan(fn.indexOf("saveSite({"));
  });
});

describe("NEW-1 — one entry point for starting a plan, not two of equal weight (owner report 2026-08-29)", () => {
  /* Mutation: restore the row-1 header's standalone "Start blank" button → red. It duplicated
     MapFinder's own control, at equal visual weight, on the same screen. */
  it("the row-1 header no longer offers its own 'Start blank' button", () => {
    expect(app).not.toContain("newBlankSiteHere");
    expect(app).not.toContain("mapCenterRef");
    expect(app).toMatch(/toolbarContent=\{null\}/);
  });

  /* ⛔ SUPERSEDED 2026-09-08 (NEW-1, the ground-first map toolbar) — AND THE REVERSAL IS
     DELIBERATE, not a loosening. B831780's rule was "one entry point for starting a plan, not two
     of equal weight", and it was RIGHT for what it was about: "Select parcels" and "Start blank"
     are two ways to make the SAME thing (a plan), so hiding the rarer one behind a caret stopped
     them competing for the same press.
     The toolbar now offers three ways to POINT AT GROUND — Select parcels · Draw · Drop a pin —
     which make DIFFERENT things, and burying two of them behind a caret is what forced the
     toolbar to guess with a Site/Comp mode in the first place. So "Start blank" came out of the
     caret as the first-class "Draw" button, the caret and its menu are gone, and the property
     worth guarding changed shape with them: Select parcels stays the PRIMARY (the only
     accent-filled one — almost every plan starts from a real lot), the other two are secondary
     buttons beside it, and Draw still reaches the very same `startBlankHere`. */
  it("'Select parcels' is still the one PRIMARY action, with Draw and Drop a pin secondary beside it", () => {
    // The at-rest row, bounded by the armed-pin block that follows it. The end marker is searched
    // FROM the start index on purpose: `{placingCompPin && (` also opens the map-wide armed ring
    // a couple of hundred lines EARLIER, and slicing to that one yields an empty string that
    // silently passes every `not.toContain` below.
    const rowStart = finder.indexOf("{!selectMode && !placingCompPin && !decideTarget && (");
    expect(rowStart, "the at-rest row was not found").toBeGreaterThan(-1);
    const block = finder.slice(rowStart, finder.indexOf("{placingCompPin && (", rowStart));
    expect(block.length, "the at-rest row sliced empty — the end marker moved").toBeGreaterThan(500);
    expect(block).toContain('data-testid="map-toolbar-select-parcels"');
    // exactly one primary in this row, and it is Select parcels
    expect(block.match(/variant="primary"/g) || []).toHaveLength(1);
    expect(block).toContain(">Select parcels</span>");
    expect(block).toMatch(/variant="primary"[\s\S]{0,200}data-testid="map-toolbar-select-parcels"/);
    // the other two are real, visible, co-equal-to-each-other secondaries — never a caret menu
    expect(block).toContain('data-testid="map-toolbar-draw"');
    expect(block).toContain('data-testid="map-toolbar-drop-pin"');
    expect(block.match(/variant="ghost"/g) || []).toHaveLength(2);
  });

  /* Mutation: point Draw at anything other than `startBlankHere` → red. It is still the one door
     to a blank plan from the map's resting toolbar; only its packaging changed. */
  it("Draw starts a blank plan the same way the caret's menu item did", () => {
    const i = finder.indexOf('data-testid="map-toolbar-draw"');
    expect(i, "the Draw button is missing").toBeGreaterThan(-1);
    const btn = finder.slice(Math.max(0, i - 400), i + 400);
    expect(btn).toMatch(/onClick=\{\(\) => startBlankHere\(\)\}/);
  });

  /* And the caret machinery is gone, not merely unused — a leftover menu is how a second entry
     point creeps back in. */
  it("the split-button caret and its menu no longer exist", () => {
    for (const gone of ["startBlankMenuOpen", "startBlankMenuBtnRef", "map-start-blank-menu-item"]) {
      expect(finder, `${gone} came back`).not.toContain(gone);
    }
  });
});
