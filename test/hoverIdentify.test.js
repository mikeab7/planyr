/* NEW-2 — "hovering an electric line, substation or pipeline must say what it is."
 *
 * The owner's words: "I should be able to hover over it and see what it is."
 *
 * THE CONSTRAINT THAT SPLITS THIS IN TWO, and which the audit corrected on the way in:
 *
 *  (a) The VECTOR overlays. The OSM power layer already answers a hover, because
 *      evidenceLayers.js binds a tooltip as it draws ("Substation (OSM)", "Transmission line
 *      (OSM) · 138000 V"). The HIFLD electric layers turned out to be vector TOO — `hifld_tx`
 *      and `hifld_substations` are `kind: "esriFeature"`, i.e. esri-leaflet featureLayers, NOT
 *      the raster export the report assumed. Their real defect was `interactive: false` and no
 *      tooltip at all: real features, in the DOM, that simply never answered. So the fix for the
 *      owner's red lines and substations is wording + interactivity (featureHover.js), not a
 *      network identify — and it is the cheaper, more accurate half by a wide margin, since the
 *      attributes are already in hand.
 *
 *  (b) The genuinely RASTER-painted layers — FEMA, wetlands, the City of Houston mains, HCFCD,
 *      BKDD, the RRC wells, the CCN/MUD territories, and the pipeline layer's zoomed-out tier.
 *      Those are server-rendered pictures loaded through a CORS-exempt <img>; there are no
 *      features in the DOM, so no tooltip can ever bind. They can only be identified by asking
 *      the service (rasterIdentify.js). Every outcome must SAY something — LOUD-FAILURE — and
 *      never hang on a spinner or fall silent in a way that reads as a dead layer.
 */
import { describe, it, expect, vi } from "vitest";
import {
  hoverText, hoverTitle, hoverDetails, sourceTag, cleanAttr, pickAttr,
  hoverIdentifyEnabled, HOVER_MAX_CHARS, titleCaseAgency,
} from "../src/workspaces/site-planner/lib/featureHover.js";
import {
  identifyCapable, identifyLayersParam, identifyRequest, readoutFromResult, readoutsFromJson,
  createHoverIdentify, stateMessage, errorMessage, IDENTIFY_STATE, HOVER_IDENTIFY_DEBOUNCE_MS,
} from "../src/workspaces/site-planner/lib/rasterIdentify.js";

// ---------------------------------------------------------------------------
// (a) The vector half — wording that matches the OSM tooltips it sits beside.
// ---------------------------------------------------------------------------
const TX = {
  kind: "esriFeature", label: "Transmission lines", source: "HIFLD (US DOE/NETL)",
  hoverIdentify: true, hoverTitle: "Transmission line", hoverSource: "HIFLD",
  hoverFields: [{ clean: "voltage" }, { clean: "owner" }],
};
const SUB = {
  kind: "esriFeature", label: "Substations", source: "HIFLD",
  hoverIdentify: true, hoverTitle: "Substation", hoverSource: "HIFLD",
  hoverFields: [{ names: ["NAME"] }, { names: ["MAX_VOLTAG", "MAX_VOLT", "VOLTAGE"], unit: "kV" }, { names: ["CITY"] }],
};

describe("NEW-2(a) — a hovered vector feature names itself, OSM-style", () => {
  it("names a transmission line with its voltage and owner", () => {
    expect(hoverText(TX, { VOLTAGE: 138, OWNER: "CenterPoint Energy" }))
      .toBe("Transmission line (HIFLD) · 138 kV · CenterPoint Energy");
  });

  it("names a substation with its name, voltage and city", () => {
    expect(hoverText(SUB, { NAME: "Addicks", MAX_VOLTAG: 138, CITY: "Houston" }))
      .toBe("Substation (HIFLD) · Addicks · 138 kV · Houston");
  });

  it("reads in the SAME shape as the OSM tooltip it sits next to in the panel", () => {
    // evidenceLayers.js renders "Substation (OSM)" / "Transmission line (OSM) · 138000 V".
    // The point is that a user cannot tell the two paths apart by their wording.
    expect(hoverText(SUB, {})).toBe("Substation (HIFLD)");
    expect(hoverText(TX, {})).toBe("Transmission line (HIFLD)");
  });

  it("ALWAYS names the kind of thing, even when every attribute is withheld", () => {
    // The owner's question is "what is it". A redacted national record still answers that.
    const t = hoverText(SUB, { NAME: "UNKNOWN12345", MAX_VOLTAG: 0 });
    expect(t).toBe("Substation (HIFLD)");
    expect(t).not.toMatch(/UNKNOWN|\b0\b/);
  });

  describe("redaction is ABSENCE, never a fact", () => {
    it("drops HIFLD's withheld sentinels", () => {
      for (const raw of ["NOT AVAILABLE", "not available", "UNKNOWN", "UNKNOWN00193", "0", "", "  ", "N/A", "null", "--"])
        expect(cleanAttr(raw)).toBe("");
    });
    it("keeps a real value that merely contains a zero", () => {
      expect(cleanAttr("138")).toBe("138");
      expect(cleanAttr("Substation 10")).toBe("Substation 10");
    });
    it("never renders a withheld voltage as a number", () => {
      expect(hoverText(TX, { VOLTAGE: 0, VOLT_CLASS: "NOT AVAILABLE" })).toBe("Transmission line (HIFLD)");
    });
    it("falls back to the VOLT_CLASS band when the numeric voltage is withheld", () => {
      expect(hoverText(TX, { VOLTAGE: 0, VOLT_CLASS: "220-287" })).toBe("Transmission line (HIFLD) · 220-287 kV");
    });
  });

  describe("field resolution is tolerant of the dataset's casing", () => {
    it("matches a candidate name case-insensitively", () => {
      expect(pickAttr({ voltage: 69 }, ["VOLTAGE"])).toBe(69);
      expect(pickAttr({ Name: "Katy" }, ["NAME"])).toBe("Katy");
    });
    it("prefers an exact key over a case-folded one", () => {
      expect(pickAttr({ NAME: "exact", name: "folded" }, ["NAME"])).toBe("exact");
    });
    it("returns null when nothing matches, rather than inventing a value", () => {
      expect(pickAttr({ FOO: 1 }, ["NAME", "LABEL"])).toBe(null);
      expect(pickAttr(null, ["NAME"])).toBe(null);
    });
  });

  it("appends a unit only to a bare number", () => {
    expect(hoverDetails(SUB, { MAX_VOLTAG: 138 })).toContain("138 kV");
    expect(hoverDetails(SUB, { MAX_VOLTAG: "138 kV" })).toContain("138 kV"); // not "138 kV kV"
  });

  it("keeps the tooltip to one readable line", () => {
    const long = hoverText(SUB, { NAME: "A".repeat(200), MAX_VOLTAG: 345, CITY: "Houston" });
    expect(long.length).toBeLessThanOrEqual(HOVER_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });

  describe("titles and source tags", () => {
    it("uses the declared singular, not the panel's plural", () => {
      expect(hoverTitle(SUB)).toBe("Substation");
      expect(hoverTitle({ label: "Rail lines" })).toBe("Rail line"); // last-resort de-pluralise
      expect(hoverTitle({ label: "Airports (Part 77/FAA)" })).toBe("Airports (Part 77/FAA)"); // no bare trailing s
      expect(hoverTitle({})).toBe("Feature");
    });
    it("shortens a long provenance string when no tag is declared", () => {
      expect(sourceTag({ source: "HIFLD (US DOE/NETL)" })).toBe("HIFLD");
      expect(sourceTag({ source: "BTS/FRA North American Rail Network", hoverSource: "BTS/FRA" })).toBe("BTS/FRA");
      expect(sourceTag({})).toBe("");
    });
  });

  /* Probed LIVE against the real services 2026-07-29 (the substations layer is reachable from the
   * sandbox; the DOE transmission host is not). Near Katy the actual values are
   * `NAME: "UNKNOWN26520"`, `MAX_VOLTAG: 0`, `CITY: "KATY"` and
   * `OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC"` / `VOLTAGE: 138` / `VOLT_CLASS: "100-161"`.
   * These cases pin the wording against those REAL payloads, not invented ones. */
  describe("against the LIVE payloads (probed 2026-07-29)", () => {
    it("renders a real Katy substation record — every identifying attribute is withheld", () => {
      expect(hoverText(SUB, { NAME: "UNKNOWN26520", CITY: "KATY", MAX_VOLTAG: 0 }))
        .toBe("Substation (HIFLD) · Katy");
    });
    it("renders a real CenterPoint transmission record", () => {
      expect(hoverText(TX, { OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC", VOLTAGE: 138, VOLT_CLASS: "100-161" }))
        .toBe("Transmission line (HIFLD) · 138 kV · Centerpoint Energy Houston Electric, LLC");
    });
    it("keeps the VOLT_CLASS band verbatim when the numeric voltage is withheld", () => {
      expect(hoverText(TX, { OWNER: "NOT AVAILABLE", VOLTAGE: 0, VOLT_CLASS: "100-161" }))
        .toBe("Transmission line (HIFLD) · 100-161 kV");
    });
  });

  describe("ALL-CAPS agency text is title-cased, without mangling acronyms", () => {
    it("keeps corporate suffixes and geographic acronyms upper", () => {
      expect(titleCaseAgency("CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC")).toBe("Centerpoint Energy Houston Electric, LLC");
      expect(titleCaseAgency("HARRIS COUNTY MUD 148")).toBe("Harris County MUD 148");
      expect(titleCaseAgency("KATY ISD")).toBe("Katy ISD");
    });
    it("lowercases connecting words, except in first position", () => {
      expect(titleCaseAgency("CITY OF HOUSTON")).toBe("City of Houston");
      expect(titleCaseAgency("OF COUNSEL")).toBe("Of Counsel");
    });
    it("leaves an already mixed-case value exactly as the publisher wrote it", () => {
      expect(titleCaseAgency("CenterPoint Energy")).toBe("CenterPoint Energy");
      expect(titleCaseAgency("eXelon")).toBe("eXelon");
    });
    it("handles hyphens, slashes and apostrophes", () => {
      expect(titleCaseAgency("O'BRIEN-SMITH")).toBe("O'Brien-Smith");
      expect(titleCaseAgency("BROOKSHIRE/KATY")).toBe("Brookshire/Katy");
    });
    it("never touches a measurement", () => {
      expect(titleCaseAgency("100-161")).toBe("100-161");
      expect(titleCaseAgency("")).toBe("");
    });
  });

  it("is opt-in per layer, so blanket polygons never tooltip under an idle cursor", () => {
    expect(hoverIdentifyEnabled(TX)).toBe(true);
    expect(hoverIdentifyEnabled({ label: "County boundaries" })).toBe(false);
    expect(hoverIdentifyEnabled(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) The raster half — ask the service, and always state the outcome.
// ---------------------------------------------------------------------------
const MS = "https://gis.example.gov/arcgis/rest/services/Water/MapServer";
const RASTER = { kind: "dynamic", label: "Water mains", source: "City of Houston", url: MS, layers: [1, 2] };

describe("NEW-2(b) — identifyCapable declines what it cannot honestly answer", () => {
  it("accepts a MapServer raster layer", () => {
    expect(identifyCapable(RASTER)).toBe(true);
    expect(identifyCapable({ label: "FEMA", url: MS })).toBe(true); // no `kind` == dynamic
  });

  it("declines a FeatureServer — /identify is a MapServer operation", () => {
    expect(identifyCapable({ kind: "esriFeature", url: "https://x.gov/y/FeatureServer/0" })).toBe(false);
  });

  it("declines every VECTOR kind — those answer through the tooltip path, not the network", () => {
    for (const kind of ["esriFeature", "vector", "vectorLine", "pipelineCorridor", "overpass", "mapillary", "contours", "flowdir"])
      expect(identifyCapable({ kind, url: MS })).toBe(false);
  });

  it("declines an ImageServer — its identify returns a PIXEL, and elevation has its own readout", () => {
    expect(identifyCapable({ kind: "esriImage", url: "https://x.gov/y/ImageServer" })).toBe(false);
  });

  it("honours an explicit registry opt-out, and a missing url", () => {
    expect(identifyCapable({ ...RASTER, identify: false })).toBe(false);
    expect(identifyCapable({ kind: "dynamic" })).toBe(false);
    expect(identifyCapable(null)).toBe(false);
  });
});

describe("NEW-2(b) — the identify request", () => {
  const frame = { west: -95.4, south: 29.7, east: -95.3, north: 29.8, width: 1200, height: 800 };
  const req = identifyRequest(RASTER, { lng: -95.36, lat: 29.76 }, frame);

  it("targets the service's /identify operation", () => {
    expect(req.url).toBe(`${MS}/identify`);
  });

  it("asks about EXACTLY the sublayers the layer DRAWS", () => {
    // Reporting a feature from a sublayer the user cannot see would be worse than silence.
    expect(req.params.layers).toBe("all:1,2");
    expect(identifyLayersParam({ layers: [] })).toBe("all");
    expect(identifyLayersParam({})).toBe("all");
  });

  it("describes the REAL viewport, so the pixel tolerance means on screen what it means to the user", () => {
    expect(req.params.mapExtent).toBe("-95.4,29.7,-95.3,29.8");
    expect(req.params.imageDisplay).toBe("1200,800,96");
    expect(req.params.tolerance).toBeGreaterThan(0);
  });

  it("sends lon/lat in 4326 and asks for no geometry back (a readout needs attributes only)", () => {
    expect(JSON.parse(req.params.geometry)).toEqual({ x: -95.36, y: 29.76, spatialReference: { wkid: 4326 } });
    expect(req.params.sr).toBe(4326);
    expect(req.params.returnGeometry).toBe("false");
  });
});

describe("NEW-2(b) — turning an identify result into a readout", () => {
  it("leads with the service's own display value, qualified by the sublayer", () => {
    const r = readoutFromResult(RASTER, { layerName: "Water Mains", value: "12-inch PVC", attributes: {} });
    expect(r.title).toBe("Water Mains: 12-inch PVC");
    expect(r.sourceName).toBe("City of Houston");
  });

  it("falls back to the sublayer name when the display value is empty or redundant", () => {
    expect(readoutFromResult(RASTER, { layerName: "Wastewater", value: "Null", attributes: {} }).title).toBe("Wastewater");
    expect(readoutFromResult(RASTER, { layerName: "Wastewater", value: "Wastewater", attributes: {} }).title).toBe("Wastewater");
    expect(readoutFromResult(RASTER, { layerName: "", value: "", attributes: {} }).title).toBe("Water mains");
  });

  it("reports the facts the brief asks for — voltage, commodity, operator", () => {
    const r = readoutFromResult(RASTER, {
      layerName: "Transmission", value: "", attributes: { VOLTAGE: 138, OWNER: "CenterPoint", STATUS: "In Service" },
    });
    const by = Object.fromEntries(r.rows.map((x) => [x.label, x.text]));
    expect(by.Voltage).toBe("138 kV");
    expect(by.Operator).toBe("CenterPoint");
    expect(by.Status).toBe("In Service");
  });

  it("reports a pipeline's commodity", () => {
    const r = readoutFromResult({ ...RASTER, label: "Pipelines" }, { layerName: "Pipelines", value: "", attributes: { COMMODITY: "Crude oil" } });
    expect(r.rows.find((x) => x.label === "Commodity").text).toBe("Crude oil");
  });

  it("omits withheld attributes and never repeats the headline as a row", () => {
    const r = readoutFromResult(RASTER, {
      layerName: "Mains", value: "Katy Main", attributes: { NAME: "Katy Main", OWNER: "NOT AVAILABLE", VOLTAGE: 0 },
    });
    expect(r.rows.find((x) => x.label === "Name")).toBeUndefined(); // already the headline
    expect(r.rows.find((x) => x.label === "Operator")).toBeUndefined();
    expect(r.rows.find((x) => x.label === "Voltage")).toBeUndefined();
  });

  it("caps the rows — this is a hover readout, not a report", () => {
    const attributes = { NAME: "a", VOLTAGE: 1, COMMODITY: "c", OWNER: "o", TYPE: "t", DIAMETER: 8, STATUS: "s" };
    expect(readoutFromResult(RASTER, { layerName: "L", value: "", attributes }).rows.length).toBeLessThanOrEqual(4);
  });

  it("treats an EMPTY results array as 'nothing here', not as a failure", () => {
    expect(readoutsFromJson(RASTER, { results: [] })).toEqual([]);
    expect(readoutsFromJson(RASTER, {})).toEqual([]);
  });
});

describe("NEW-2(b) — every outcome says something (LOUD-FAILURE)", () => {
  it("has honest, brief wording for each non-hit state", () => {
    expect(stateMessage({ kind: IDENTIFY_STATE.none })).toBe("Nothing here");
    expect(stateMessage({ kind: IDENTIFY_STATE.unsupported })).toBe("This layer can't be identified");
    expect(stateMessage({ kind: IDENTIFY_STATE.pending })).toBe("Checking…");
    expect(stateMessage({ kind: IDENTIFY_STATE.error, msg: "boom" })).toBe("boom");
    // No state renders as an empty string except idle — silence is what reads as a dead layer.
    expect(stateMessage({ kind: IDENTIFY_STATE.error })).toBeTruthy();
  });

  it("distinguishes rate-limiting from being down — one is retryable, the other is not", () => {
    expect(errorMessage({ status: 429 })).toMatch(/rate-limit/i);
    expect(errorMessage({ status: 500 })).toMatch(/HTTP 500/);
    expect(errorMessage({ name: "AbortError" })).toMatch(/in time/i);
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/reach/i);
  });

  it("never leaks a raw JSON-parser message into the readout", () => {
    // Reaching a captive portal / an SPA index.html / a proxy error page yields a 200 that isn't
    // JSON. "Unexpected token '<'" tells the owner nothing about their map.
    expect(errorMessage({ name: "UnreadableIdentifyError", message: "unreadable answer" })).toBe("Source sent an unreadable answer");
    expect(errorMessage(new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`)))
      .toBe("Source sent an unreadable answer");
  });
});

// ---------------------------------------------------------------------------
// The controller: debounce, cancellation, supersession, and honest terminal states.
// ---------------------------------------------------------------------------
const FRAME = { west: -95.4, south: 29.7, east: -95.3, north: 29.8, width: 1000, height: 700 };
const AT = { lng: -95.36, lat: 29.76 };
const LAYERS = [{ id: "coh_water", cfg: RASTER }];

/* A hand-driven clock so nothing here depends on real timers. */
function harness({ fetchJson, debounceMs = HOVER_IDENTIFY_DEBOUNCE_MS } = {}) {
  const states = [];
  let seq = 0;
  const timers = new Map();
  const setTimer = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };
  const clearTimer = (id) => timers.delete(id);
  // Fire only the debounce timers (the shortest pending), never the long abort watchdog.
  const tick = () => {
    const entries = [...timers.entries()].filter(([, t]) => t.ms === debounceMs);
    for (const [id, t] of entries) { timers.delete(id); t.fn(); }
  };
  const ctl = createHoverIdentify({
    fetchJson, debounceMs, setTimer, clearTimer,
    makeController: () => ({ abort() {}, signal: {} }),
    onState: (s) => states.push(s),
  });
  return { ctl, states, tick, pending: () => timers.size };
}

describe("NEW-2(b) — the hover controller", () => {
  it("asks NOTHING until the cursor rests (sweeping the map must not burst requests)", () => {
    const fetchJson = vi.fn();
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, LAYERS);
    expect(fetchJson).not.toHaveBeenCalled();
    h.tick();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("coalesces a rapid sweep into ONE request for the final position", () => {
    const fetchJson = vi.fn(async () => ({ results: [] }));
    const h = harness({ fetchJson });
    for (let i = 0; i < 8; i++) h.ctl.hover({ lng: AT.lng + i * 0.001, lat: AT.lat }, FRAME, LAYERS);
    h.tick();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const geom = JSON.parse(fetchJson.mock.calls[0][1].geometry);
    expect(geom.x).toBeCloseTo(AT.lng + 7 * 0.001);
  });

  it("reports a hit", async () => {
    const fetchJson = async () => ({ results: [{ layerName: "Water Mains", value: "12-inch PVC", attributes: {} }] });
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.tick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const last = h.states[h.states.length - 1];
    expect(last.kind).toBe(IDENTIFY_STATE.hit);
    expect(last.items[0].title).toBe("Water Mains: 12-inch PVC");
  });

  it("reports 'nothing here' — distinct from a failure (the B233 distinction)", async () => {
    const h = harness({ fetchJson: async () => ({ results: [] }) });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.tick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.states[h.states.length - 1].kind).toBe(IDENTIFY_STATE.none);
  });

  it("reports a FAILURE loudly — an unreachable service must never read as empty ground", async () => {
    const h = harness({ fetchJson: async () => { throw new TypeError("Failed to fetch"); } });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.tick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const last = h.states[h.states.length - 1];
    expect(last.kind).toBe(IDENTIFY_STATE.error);
    expect(last.msg).toMatch(/reach/i);
  });

  it("lets a failure WIN over a sibling's empty result, so a dead layer can't hide behind one", async () => {
    const fetchJson = async (url) => {
      if (url.includes("dead")) throw Object.assign(new Error("nope"), { status: 503 });
      return { results: [] };
    };
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, [
      { id: "ok", cfg: RASTER },
      { id: "dead", cfg: { ...RASTER, url: "https://dead.example.gov/x/MapServer" } },
    ]);
    h.tick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.states[h.states.length - 1].kind).toBe(IDENTIFY_STATE.error);
  });

  it("still reports a sibling's HIT when another layer died", async () => {
    const fetchJson = async (url) => {
      if (url.includes("dead")) throw Object.assign(new Error("nope"), { status: 503 });
      return { results: [{ layerName: "Wetlands", value: "PFO1A", attributes: {} }] };
    };
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, [
      { id: "dead", cfg: { ...RASTER, url: "https://dead.example.gov/x/MapServer" } },
      { id: "ok", cfg: RASTER },
    ]);
    h.tick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.states[h.states.length - 1].kind).toBe(IDENTIFY_STATE.hit);
  });

  it("says so when every eligible layer is one it cannot identify — never a silent no-op", async () => {
    const h = harness({ fetchJson: async () => ({ results: [] }) });
    h.ctl.hover(AT, FRAME, [{ id: "elev", cfg: { kind: "esriImage", url: "https://x.gov/y/ImageServer" } }]);
    h.tick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.states[h.states.length - 1].kind).toBe(IDENTIFY_STATE.unsupported);
  });

  it("DROPS a late answer for ground the cursor has already left", async () => {
    let release;
    const fetchJson = () => new Promise((res) => { release = () => res({ results: [{ layerName: "stale", value: "old", attributes: {} }] }); });
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.tick();                 // request in flight for AT
    h.ctl.cancel();           // cursor moved off / pan started
    release();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // The only state after cancel is idle — the stale answer never renders.
    expect(h.states[h.states.length - 1].kind).toBe(IDENTIFY_STATE.idle);
    expect(h.states.some((s) => s.kind === IDENTIFY_STATE.hit)).toBe(false);
  });

  it("cancel() clears a pending debounce so no request is ever made", () => {
    const fetchJson = vi.fn();
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.ctl.cancel();
    h.tick();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("goes idle (and asks nothing) when no layer is eligible — e.g. everything toggled off", () => {
    const fetchJson = vi.fn();
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, []);
    h.tick();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(h.states[h.states.length - 1].kind).toBe(IDENTIFY_STATE.idle);
  });

  it("fires immediately for a click (a pinned readout must not wait out a hover debounce)", () => {
    const fetchJson = vi.fn(async () => ({ results: [] }));
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, LAYERS, { immediate: true });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("passes the layer cfg to the transport, so a noCors host can skip the doomed direct fetch", () => {
    const fetchJson = vi.fn(async () => ({ results: [] }));
    const h = harness({ fetchJson });
    h.ctl.hover(AT, FRAME, LAYERS, { immediate: true });
    expect(fetchJson.mock.calls[0][2].cfg).toBe(RASTER);
  });

  it("surfaces a PENDING state, so the readout is never blank while waiting", () => {
    const h = harness({ fetchJson: () => new Promise(() => {}) });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.tick();
    expect(h.states[0].kind).toBe(IDENTIFY_STATE.pending);
  });

  it("leaves no timer behind after destroy()", () => {
    const h = harness({ fetchJson: vi.fn() });
    h.ctl.hover(AT, FRAME, LAYERS);
    h.ctl.destroy();
    h.tick();
    expect(h.pending()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Registry wiring — the layers the owner actually named must be reachable.
// ---------------------------------------------------------------------------
describe("NEW-2 — the electric and pipeline layers are wired for hover", () => {
  // layers.js pulls in leaflet-facing modules that need a DOM; stub them exactly as
  // test/coverage.test.js does so ALL_LAYERS (a pure config object) loads in node.
  it("declares hover identify on both HIFLD electric layers, and a canvas path for the planner", async () => {
    vi.doMock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
    vi.doMock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
    vi.doMock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
      cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
    }));
    const { ALL_LAYERS, rasterIdentifyLayers } = await import("../src/workspaces/site-planner/lib/layers.js");

    for (const id of ["hifld_tx", "hifld_substations"]) {
      expect(hoverIdentifyEnabled(ALL_LAYERS[id])).toBe(true);
      // The planner's Leaflet backdrop is pointer-events:none, so it reaches these through
      // the canvas accessor instead — both surfaces must be able to answer.
      expect(ALL_LAYERS[id].canvasIdentify).toBe(true);
      expect(hoverText(ALL_LAYERS[id], {})).toMatch(/\(HIFLD\)$/);
    }

    // The OSM member of the same merged "Electric" row already had hover from evidenceLayers.js.
    expect(ALL_LAYERS.osm_power.mergeGroup).toBe("electric");

    // The pipelines the owner named alongside the electric layers: the vector tiers answer
    // through vectorOverlay's own identify, and the zoomed-out raster tier through the
    // service. Either way they are not silent.
    expect(ALL_LAYERS.txrrc_pipe.kind).toBe("vectorLine");
    expect(ALL_LAYERS.txrrc_pipe_easement.kind).toBe("pipelineCorridor");

    // rasterIdentifyLayers only ever offers ON, capable, healthy layers.
    const overlays = { coh_water: { on: true }, hifld_tx: { on: true }, elevation: { on: true }, coh_ww: { on: false } };
    const picked = rasterIdentifyLayers(overlays).map((x) => x.id);
    expect(picked).toContain("coh_water");   // raster MapServer → yes
    expect(picked).not.toContain("hifld_tx"); // vector → the tooltip path, not the network
    expect(picked).not.toContain("elevation"); // ImageServer → declines
    expect(picked).not.toContain("coh_ww");    // toggled off
    // A layer the health probe already failed is not re-asked on every hover.
    expect(rasterIdentifyLayers(overlays, { layerHealthy: () => false })).toEqual([]);
    vi.resetModules();
  });
});
