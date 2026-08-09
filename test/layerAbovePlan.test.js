/* NEW-1 — "Show above plan": the per-layer, two-state lift, and the correction it carries.
 *
 * THE CORRECTION. B1205/B1206 shipped a fixed stacking model and called per-layer OPACITY "the one
 * escape hatch". That reasoning had a hole: opacity cannot fix OCCLUSION for a layer that draws
 * UNDER the site elements. Fading a buried floodplain fill changes nothing on screen — the building
 * still covers it, and the slider only dims the parts that were already visible. Opacity helps a
 * layer that is ON TOP and too loud. Order can only be fixed by order.
 *
 * WHAT IS NOT CHANGED, and is asserted here so nobody "improves" it away: the DEFAULT. Area fills
 * still sit under the elements and line/point layers still sit over them, so the owner's original
 * case — contours vanishing behind his buildings — still needs ZERO interaction. A toggle you never
 * have to touch beats a toggle you always have to touch.
 *
 * WHERE THE LIFT STOPS. Above the site elements, BELOW the labels/chips and BELOW B1197's
 * always-on-top handle layer. That bound is the reason the lifted band is hosted inside the plan
 * SVG rather than in the map-top host beside the line band: a hairline crossing a handle is the
 * documented, bounded gisLine deviation (B1208), but a filled wash over a handle would hide the
 * grip being dragged — strictly worse than the occlusion the lift exists to fix.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  MAP_STACK, STACK_Z, SVG_TIERS, CANVAS_Z, FRONT_BAND_ATTR,
  LIFTABLE_ROLE, canLiftRole, configCanLift, tierForRole, tierForLayer, layerOverPlan,
  panesForRole, panesForLayer, bandKey, exportBandFor, EXPORT_BANDS,
  PANE_AREA, PANE_AREA_LABEL, PANE_AREA_FRONT, PANE_AREA_FRONT_LABEL, PANE_LINE, PANE_LINE_LABEL,
} from "../src/workspaces/site-planner/lib/mapStack.js";
import { ALL_LAYERS, defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import {
  sanitizeLayerAbove, aboveFromOverlays, applyAboveOverrides, aboveSig, overlaysWithOverrides,
} from "../src/workspaces/site-planner/lib/layerPrefs.js";
import { createSiteModel, mergeSiteContent } from "../src/workspaces/site-planner/lib/siteModel.js";

const read = (rel) => readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/" + rel, import.meta.url)), "utf8");

// Real registry members of each shape, so the assertions below are about the SHIPPED classification
// and not about a hand-made config that happens to agree with it.
const AREA = "wetlands";       // a filled polygon source — the shape that can be buried
const LINE = "contours";       // the owner's own case: already over the plan
const SPLIT = "fema";          // zone POLYGONS under + hazard BOUNDARIES over, from one panel row

describe("NEW-1 — the lifted tier sits exactly where the correction says it does", () => {
  it("gisAreaFront is above the site elements", () => {
    expect(STACK_Z.gisAreaFront).toBeGreaterThan(STACK_Z.elements);
  });

  it("…and BELOW the labels and BELOW the always-on-top handle layer — the bound that matters", () => {
    // A fill over a handle would hide the grip you are dragging. This is the assertion that keeps
    // the lifted band out of the map-top host, where the one-line implementation would have put it.
    expect(STACK_Z.gisAreaFront).toBeLessThan(STACK_Z.label);
    expect(STACK_Z.gisAreaFront).toBeLessThan(STACK_Z.handle);
  });

  it("…and below the GIS line band, so a lift can never bury the contours it was lifted past", () => {
    expect(STACK_Z.gisAreaFront).toBeLessThan(STACK_Z.gisLine);
    expect(STACK_Z.gisAreaFront).toBeGreaterThan(STACK_Z.referenceFront);
  });

  it("it is declared as living inside the ONE plan SVG, which is what makes that bound physical", () => {
    // The labels and the handle layer are children of that SVG. A band hosted OUTSIDE it cannot be
    // under them at all — no z-index can express it — so this is not bookkeeping, it is the design.
    expect(SVG_TIERS).toContain("gisAreaFront");
    expect(SVG_TIERS.indexOf("gisAreaFront")).toBeGreaterThan(SVG_TIERS.indexOf("elements"));
    expect(SVG_TIERS.indexOf("gisAreaFront")).toBeLessThan(SVG_TIERS.indexOf("label"));
    expect(SVG_TIERS.indexOf("gisAreaFront")).toBeLessThan(SVG_TIERS.indexOf("handle"));
    // …and it is therefore NOT one of the canvas's own sibling hosts.
    expect(Object.keys(CANVAS_Z).sort()).toEqual(["basemap", "gisLine", "plan"]);
  });

  it("the model order is still strictly increasing with no ties after the insertion", () => {
    const zs = MAP_STACK.map((t) => t.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(new Set(zs).size).toBe(zs.length);
  });
});

describe("NEW-1 — the DEFAULT is untouched, which is the whole reason the lift is opt-in", () => {
  it("every liftable layer starts NOT lifted", () => {
    const st = defaultOverlayState();
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      if (!configCanLift(cfg)) continue;
      expect(st[id].above, `${id} must not default to lifted`).toBe(false);
    }
  });

  it("the owner's contours case still needs no interaction at all", () => {
    expect(tierForLayer("line", false)).toBe("gisLine");
    expect(layerOverPlan(ALL_LAYERS[LINE], false)).toBe(true);
  });

  it("…and an un-lifted fill still sits under the plan, where it cannot bury a building", () => {
    expect(tierForLayer("area", false)).toBe("gisArea");
    expect(tierForRole("area")).toBe("gisArea"); // the default helper is unchanged
    expect(layerOverPlan(ALL_LAYERS[AREA], false)).toBe(false);
  });
});

describe("NEW-1 — only what the lift can actually MOVE is liftable", () => {
  it("an area role is liftable; line and point roles are over the plan already", () => {
    expect(LIFTABLE_ROLE).toBe("area");
    expect(canLiftRole("area")).toBe(true);
    expect(canLiftRole("line")).toBe(false);
    expect(canLiftRole("point")).toBe(false);
    // Lifting is a no-op for them, and must stay a no-op rather than a second band.
    expect(tierForLayer("line", true)).toBe("gisLine");
    expect(tierForLayer("point", true)).toBe("gisLine");
  });

  it("the registry splits cleanly into liftable and already-above, with real members on both sides", () => {
    const liftable = Object.entries(ALL_LAYERS).filter(([, c]) => configCanLift(c)).map(([id]) => id);
    const already = Object.keys(ALL_LAYERS).filter((id) => !liftable.includes(id));
    expect(liftable.length).toBeGreaterThan(0);
    expect(already.length).toBeGreaterThan(0);
    expect(liftable).toContain(AREA);
    expect(liftable).toContain(SPLIT); // a split source is liftable BY ITS AREA HALF
    expect(already).toContain(LINE);
  });

  it("a role-split source lifts only its area half — the line half was over the plan already", () => {
    expect(tierForLayer("area", true)).toBe("gisAreaFront");
    expect(tierForLayer("line", true)).toBe("gisLine");
    // Both halves over the plan once lifted → the panel reads it as fully above.
    expect(layerOverPlan(ALL_LAYERS[SPLIT], false)).toBe(false);
    expect(layerOverPlan(ALL_LAYERS[SPLIT], true)).toBe(true);
  });
});

describe("NEW-1 — panes and the rebuild key", () => {
  it("a lifted area role resolves to the front band's panes; everything else is unchanged", () => {
    expect(panesForLayer("area", null, false)).toEqual(panesForRole("area"));
    expect(panesForLayer("area", null, true)).toEqual({ pane: PANE_AREA_FRONT, labelPane: PANE_AREA_FRONT_LABEL });
    expect(panesForLayer("line", null, true)).toEqual(panesForRole("line"));
    // A layer's name labels keep riding in that layer's own band.
    expect(PANE_AREA_FRONT_LABEL).not.toBe(PANE_AREA_LABEL);
    expect(PANE_AREA_FRONT).not.toBe(PANE_LINE);
  });

  it("a host may point the lifted band anywhere it likes — the ORDER is the model's", () => {
    const finder = { area: "a", areaLabel: "al", areaFront: "a", areaFrontLabel: "al", line: "b", lineLabel: "bl" };
    // The map finder has no plan to be above, so it collapses the two onto one pane.
    expect(panesForLayer("area", finder, true)).toEqual({ pane: "a", labelPane: "al" });
  });

  it("the rebuild key changes when the band changes — Leaflet fixes a pane at construction", () => {
    const panes = { area: PANE_AREA, areaLabel: PANE_AREA_LABEL, areaFront: PANE_AREA_FRONT, areaFrontLabel: PANE_AREA_FRONT_LABEL, line: PANE_LINE, lineLabel: PANE_LINE_LABEL };
    expect(bandKey(ALL_LAYERS[AREA], panes, true)).not.toBe(bandKey(ALL_LAYERS[AREA], panes, false));
    // A split source's key covers BOTH its halves, so lifting the fill rebuilds the composite.
    expect(bandKey(ALL_LAYERS[SPLIT], panes, true)).not.toBe(bandKey(ALL_LAYERS[SPLIT], panes, false));
    // An already-above layer's key never moves — flipping the flag must cost it nothing.
    expect(bandKey(ALL_LAYERS[LINE], panes, true)).toBe(bandKey(ALL_LAYERS[LINE], panes, false));
  });

  it("…and a surface that COLLAPSES the bands rebuilds nothing, because the key reads panes not flags", () => {
    const collapsed = { area: PANE_AREA, areaLabel: PANE_AREA_LABEL, areaFront: PANE_AREA, areaFrontLabel: PANE_AREA_LABEL, line: PANE_LINE, lineLabel: PANE_LINE_LABEL };
    expect(bandKey(ALL_LAYERS[AREA], collapsed, true)).toBe(bandKey(ALL_LAYERS[AREA], collapsed, false));
  });
});

describe("NEW-1 — PDF-PARITY: the sheet prints the lift where the screen shows it", () => {
  it("there are three bands, and a lifted fill prints in the middle one", () => {
    expect(EXPORT_BANDS).toEqual(["under", "front", "over"]);
    expect(exportBandFor("area", false)).toBe("under");
    expect(exportBandFor("area", true)).toBe("front");
    expect(exportBandFor("line", false)).toBe("over");
    expect(exportBandFor("line", true)).toBe("over"); // already over — the lift adds nothing
    expect(exportBandFor("point", true)).toBe("over");
  });

  it("the sheet composes the front band into the plan's own anchor, not after the plan", () => {
    const ex = read("lib/exportSheet.js");
    expect(ex).toContain("FRONT_BAND_ATTR");
    expect(ex).toMatch(/frontAnchor = clone\.querySelector/);
    expect(ex).toMatch(/append === "front"/);
    // LOUD-FAILURE: a lifted layer with no anchor to print into must SAY so, not print underneath.
    expect(ex).toMatch(/console\.warn\([^)]*lifted above the plan/);
  });

  it("both emitters carry the lift into the band decision — screen and sheet read one rule", () => {
    const ex = read("lib/exportSheet.js");
    expect((ex.match(/exportBandFor\(/g) || []).length).toBe(2); // the raster emitter and the vector emitter
  });
});

describe("NEW-1 — the canvas hosts the lifted band inside the plan SVG", () => {
  const planner = read("SitePlanner.jsx");

  it("the front-band anchor is rendered, and the pane host lives inside it", () => {
    expect(FRONT_BAND_ATTR).toBe("data-gis-front-band");
    expect(planner).toContain("FRONT_BAND_ATTR");
    expect(planner).toContain("geoFrontPaneRef");
    // Inside a <foreignObject>, which is how an HTML/Leaflet pane can live in an SVG at all.
    const at = planner.indexOf("{ [FRONT_BAND_ATTR]: \"1\" }");
    expect(at, "the front-band group is gone").toBeGreaterThan(-1);
    const block = planner.slice(at, at + 900);
    expect(block).toContain("foreignObject");
    expect(block).toContain("geoFrontWrapRef");
    expect(block).toContain("geoFrontPaneRef");
  });

  it("it can neither take a click nor steal a handle", () => {
    const at = planner.indexOf("{ [FRONT_BAND_ATTR]: \"1\" }");
    const block = planner.slice(at, at + 900);
    expect(block).toMatch(/pointerEvents=\{?"none"\}?|pointerEvents: "none"/);
    expect(block).toContain('data-export="skip"'); // the sheet composites its OWN copy of the band
  });

  it("it undoes the SVG's registration shift — a pane inside the SVG must not be nudged twice", () => {
    const at = planner.indexOf("{ [FRONT_BAND_ATTR]: \"1\" }");
    const block = planner.slice(at, at + 900);
    expect(block).toMatch(/translate\(\$\{-regShift\.dx\}px, \$\{-regShift\.dy\}px\)/);
  });

  it("the anchor is rendered AFTER the elements and BEFORE the labels + handle layer", () => {
    // Document order in SVG IS paint order, so this is the physical form of the tier assertion above.
    const front = planner.indexOf("{ [FRONT_BAND_ATTR]: \"1\" }");
    const promoted = planner.indexOf("{overlayBands.above.map(renderSheetOverlay)}");
    const labels = planner.indexOf("{parcelLabels}");
    const handles = planner.indexOf('<g data-export="skip" data-handle-layer="1">');
    for (const [name, at] of [["promoted references", promoted], ["labels", labels], ["handle layer", handles]]) {
      expect(at, `${name} render site not found`).toBeGreaterThan(-1);
    }
    expect(front).toBeGreaterThan(promoted);
    expect(front).toBeLessThan(labels);
    expect(front).toBeLessThan(handles);
  });

  it("LOUD-FAILURE — a missing host is reported, never silently answered with the wrong band", () => {
    // Without this, syncOverlayLayers would helpfully create the pane inside Leaflet's own map
    // pane and a layer the user asked to LIFT would render below the plan, which is the bug.
    expect(planner).toMatch(/console\.error\("\[planyr\] the lifted GIS band host/);
  });
});

describe("NEW-1 — layers.js honours the lift and rebuilds when it flips", () => {
  const layers = read("lib/layers.js");

  it("the pane comes from the model plus the lift, not from a local guess", () => {
    expect(layers).toMatch(/const paneOf = \(role, above\) =>/);
    expect(layers).toMatch(/panesForLayer\(role, panes, above\)/);
    expect(layers).toMatch(/const above = !!st\.above && configCanLift\(cfg\)/);
    // …including the role-split raster path, which asks per ROLE.
    expect(layers).toMatch(/paneOf\(part\.role, above\)/);
  });

  it("a flip tears the layer down and re-adds it IN THE SAME PASS (no blink, no orphan)", () => {
    expect(layers).toMatch(/const wantBand = panes \? bandKey\(cfg, panes, above\) : "legacy"/);
    expect(layers).toMatch(/bands\[k\] !== undefined && bands\[k\] !== wantBand\) release\(k, refs\[k\]\)/);
    expect(layers).toMatch(/const cur = refs\[k\]/); // re-read, so the add path runs this pass
  });

  it("a rebuild uses the SAME teardown as a toggle-off — one release path, not two", () => {
    // The half of a role-split layer that is not `refs[k]` must be released too, or it keeps its
    // tiles and its in-flight request (the resurrection releaseLayer exists to stop). Sharing the
    // helper is what stops the rebuild path from re-deriving that rule and getting it wrong.
    const at = layers.indexOf("const release = (k, lyr) => {");
    expect(at, "the shared release helper is gone").toBeGreaterThan(-1);
    const block = layers.slice(at, at + 500);
    expect(block).toContain("__pfParts");
    expect(block).toContain("releaseLayer");
    expect(block).toMatch(/lyr !== "pending"/); // a pending build has no layer — clearing the slot IS its abort
    expect(block).toMatch(/delete bands\[k\]/);
    /* A CENSUS OF TEARDOWN SITES, not a style check — it goes red the moment someone adds a
     * teardown, so each one has to be a deliberate, named entry here.
     *   1. the "Show above plan" band REBUILD
     *   2. the ordinary toggle-off
     *   3. NEW-2 — the baked-flood-tile fallback: a 404/unreadable archive tears the tile layer
     *      down and re-enters syncOverlayLayers, which then takes the live FEMA raster branch.
     *      It goes through this SAME helper precisely so it inherits the __pfParts / releaseLayer
     *      discipline instead of re-deriving it. */
    expect((layers.match(/release\(k, (refs\[k\]|cur|lyr)\)/g) || []).length).toBe(3);
  });

  it("the band memory is scoped to the caller's refs and never pollutes it", () => {
    // A bookkeeping key stashed on `refs` itself would show up in everything that iterates it.
    expect(layers).toMatch(/const LAYER_BANDS = new WeakMap\(\)/);
    expect(layers).not.toMatch(/refs\.__pf/);
  });
});

describe("NEW-1 — the lift is remembered PER SITE, like every other per-plan decision", () => {
  it("only real, liftable layers survive sanitising", () => {
    expect(sanitizeLayerAbove({ [AREA]: true })).toEqual({ [AREA]: true });
    expect(sanitizeLayerAbove({ [LINE]: true })).toEqual({});      // nothing to lift
    expect(sanitizeLayerAbove({ gone_from_registry: true })).toEqual({});
    expect(sanitizeLayerAbove({ [AREA]: false })).toEqual({});     // not-lifted is absence
    expect(sanitizeLayerAbove({ [AREA]: "yes" })).toEqual({});
    expect(sanitizeLayerAbove(null)).toEqual({});
    expect(sanitizeLayerAbove(["nope"])).toEqual({});
  });

  it("the projection round-trips through a real overlays state", () => {
    const ov = { ...defaultOverlayState() };
    ov[AREA] = { ...ov[AREA], on: true, above: true };
    ov[SPLIT] = { ...ov[SPLIT], on: true };
    const proj = aboveFromOverlays(ov);
    expect(proj).toEqual({ [AREA]: true });
    const rebuilt = overlaysWithOverrides({ [AREA]: true }, proj);
    expect(rebuilt[AREA].above).toBe(true);
    expect(rebuilt[AREA].on).toBe(true);
    expect(rebuilt[SPLIT].above).toBe(false);
  });

  it("a saved lift restores onto a LIVE overlays state without disturbing opacity or on/off", () => {
    const ov = { ...defaultOverlayState() };
    ov[AREA] = { ...ov[AREA], on: true, opacity: 0.35 };
    const out = applyAboveOverrides(ov, { [AREA]: true });
    expect(out[AREA]).toEqual({ ...ov[AREA], above: true });
    expect(out[AREA].opacity).toBe(0.35);
    expect(out[AREA].on).toBe(true);
    // Reference-stable for every layer it doesn't have to touch, so React can skip them.
    for (const k of Object.keys(ov)) if (k !== AREA) expect(out[k]).toBe(ov[k]);
  });

  it("an absent map returns every layer to the default band — which is how UNDO reverts a lift", () => {
    const ov = { ...defaultOverlayState() };
    ov[AREA] = { ...ov[AREA], on: true, above: true };
    expect(applyAboveOverrides(ov, {})[AREA].above).toBe(false);
    expect(applyAboveOverrides(ov, null)[AREA].above).toBe(false);
  });

  it("the undo signature moves on a lift and stands still on anything else", () => {
    expect(aboveSig({ [AREA]: true })).not.toBe(aboveSig({}));
    expect(aboveSig({ [AREA]: true })).toBe(aboveSig({ [AREA]: true, [LINE]: true })); // the un-liftable key is dropped
  });

  it("the site model carries it additively, and merges newer-wins like its neighbour", () => {
    expect(createSiteModel({}).layerAbove).toEqual({});
    expect(createSiteModel({ layerAbove: { [AREA]: true, junk: 3 } }).layerAbove).toEqual({ [AREA]: true });
    // Idempotent: renormalising a clean record changes nothing.
    const once = createSiteModel({ layerAbove: { [AREA]: true } });
    expect(createSiteModel(once).layerAbove).toEqual({ [AREA]: true });
    const older = createSiteModel({ id: "s1", updatedAt: 1000, layerAbove: { [AREA]: true }, parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] });
    const newer = createSiteModel({ id: "s1", updatedAt: 2000, layerAbove: {}, parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] });
    expect(mergeSiteContent(older, newer).layerAbove).toEqual({});
    expect(mergeSiteContent(newer, older).layerAbove).toEqual({}); // order-independent (by updatedAt)
  });

  it("a pre-NEW-1 saved plan reads exactly as it always did", () => {
    const legacy = createSiteModel({ layerOverrides: { [AREA]: true } });
    expect(legacy.layerAbove).toEqual({});
    expect(overlaysWithOverrides(legacy.layerOverrides, legacy.layerAbove)[AREA].above).toBe(false);
  });

  it("the planner persists and undoes it alongside the visibility set", () => {
    const sp = read("SitePlanner.jsx");
    expect(sp).toMatch(/stateRef\.current = \{[^}]*layerAbove \};/);
    expect(sp).toMatch(/const payload = \{[^}]*layerAbove \};/);
    expect(sp).toMatch(/"\|A:" \+ aboveSig\(s\.layerAbove\)/); // its own undo frame
    expect(sp).toMatch(/applyAboveOverrides\(applyOnOverrides\(cur, snapOverrides\), snapAbove\)/);
    expect(sp).toMatch(/overlaysWithOverrides\(layerOverrides, layerAbove\)/);
  });
});

describe("NEW-1 — the panel offers the lift, and stops calling opacity the answer", () => {
  const panel = read("components/LayerPanel.jsx");

  it("there is exactly ONE control implementation, on all three row shapes", () => {
    // The B1206 discipline: one answer, in the same place, on every layer in every group — and
    // one CALL SITE too, so the three row shapes cannot drift in how they read or write the lift.
    expect((panel.match(/const abovePlanControl = /g) || []).length).toBe(1);
    expect((panel.match(/abovePlanControl\(/g) || []).length).toBe(1);
    expect((panel.match(/aboveRow\(/g) || []).length).toBe(3); // solo · City-limits composite · merge group
  });

  it("it is named for what it does, and carries a per-layer accessible name", () => {
    const at = panel.indexOf("const abovePlanControl = ");
    const block = panel.slice(at, panel.indexOf("const showAbove =", at));
    expect(block).toContain("Show above plan");
    expect(block).toMatch(/aria-label=\{`Show \$\{label\} above plan`\}/);
    expect(block).toContain('type="checkbox"'); // two-state, not a free-form order picker
  });

  it("an already-above layer shows the control in its ON state, inert — never hidden", () => {
    // Hiding it would leave the row's silence to be interpreted ("already above?" vs "not offered
    // here?"). Reading where a layer sits is the point of adding the control at all.
    const at = panel.indexOf("const abovePlanControl = ");
    const block = panel.slice(at, panel.indexOf("const showAbove =", at));
    expect(block).toMatch(/disabled=\{!liftable\}/);
    expect(block).toContain("Already drawn over your plan");
    // …and the shared row helper passes `true` for the un-liftable case rather than skipping the
    // render, so EVERY row shape shows the state instead of leaving a silence to be interpreted.
    expect(panel).toMatch(/lift \? entries\.some\(\(\[id\]\) => overlays\[id\]\?\.above === true\) : true/);
  });

  it("liftability comes from the model, never from a local guess about a layer's shape", () => {
    expect(panel).toMatch(/import \{ configCanLift \} from "\.\.\/lib\/mapStack\.js"/);
  });

  it("it is a PLANNER affordance — the map finder has no plan for a layer to be above", () => {
    expect(panel).toMatch(/const showAbove = surface === "planner"/);
    expect((panel.match(/showAbove && /g) || []).length).toBe(3);
  });

  it("⛔ opacity no longer claims to answer 'I can't see through my plan'", () => {
    // The correction, guarded: the opacity control's own copy must not promise occlusion relief,
    // and the file must say plainly which control does.
    const at = panel.indexOf("const opacityControl = ");
    // Bounded to the control's own EXPRESSION, not to the next declaration — the comment block
    // that introduces abovePlanControl is allowed to say the word this one may not.
    const block = panel.slice(at, panel.indexOf("\n  );", at));
    expect(block).toContain("See through this layer"); // B1206's hover, unchanged and still true
    expect(block).not.toMatch(/escape hatch/i);
    expect(panel.slice(0, at)).toMatch(/CORRECTED BY NEW-1/);
    // And the lift's own hover says why opacity is not the substitute.
    expect(panel).toMatch(/Opacity can't do this/);
  });

  it("…and neither does the model file", () => {
    const stack = read("lib/mapStack.js");
    expect(stack).toMatch(/THE ONE ESCAPE HATCH IS \*ORDER\*, NOT OPACITY/);
    expect(stack).not.toMatch(/Per-layer OPACITY is the one escape\s+\*?\s*hatch/);
  });
});
