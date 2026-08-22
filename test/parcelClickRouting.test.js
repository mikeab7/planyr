/* NEW-1/NEW-2 (parcel routing, owner report 2026-08-22 — Jordan on a Colorado site) — the in-planner
 * parcel identify used to resolve ONCE against the site's frozen `siteCounty` and cache that single
 * URL for the planner's whole session, falling back to `COUNTIES_MAP.harris` when the key didn't
 * resolve. Panning across a county line (or opening a site outside every configured bbox) left every
 * click and outline querying the wrong — sometimes a state away — service, while the Map view routed
 * the identical point correctly via `candidateCountiesForPoint`. This is a SOURCE guard, mirroring
 * handleLayerOrder.test.js: the property under test ("the identify path never freezes on one county
 * or falls back to Harris") is about which function is called, which a render/behavioural test can't
 * see directly without standing up a full signed-in Leaflet map + live GIS network in this sandbox.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

// The in-planner parcel-identify region: from the outline/candidate refs through the end of
// `quickAddAt`, i.e. everything this fix touched.
const start = SP.indexOf("const identifyTok = useRef(0);");
const end = SP.indexOf("const [siteLabel, setSiteLabel] = useState");
if (start < 0 || end < 0) throw new Error("parcelClickRouting.test.js: identify region markers moved — update the slice");
const region = SP.slice(start, end);

describe("NEW-1: in-planner parcel identify routes by the CLICKED POINT, never a frozen county", () => {
  it("candidateCountiesForPoint drives BOTH the outlines and the click query", () => {
    // The outline effect resolves every configured county (Object.keys(COUNTIES_MAP)...), and the
    // click path asks candidatesAtPoint — both funnel through candidateCountiesForPoint, so they
    // can never again disagree about which counties are in play (the B137 contract).
    expect(region.includes("candidateCountiesForPoint")).toBe(true);
    expect(region.includes("Object.keys(COUNTIES_MAP).forEach")).toBe(true);
    expect(region.includes("candidatesAtPoint(lat, lng)")).toBe(true);
  });

  it("never falls back to a hardcoded county (the old `|| COUNTIES_MAP.harris` shape is gone)", () => {
    expect(region.includes("COUNTIES_MAP.harris")).toBe(false);
    expect(region.includes("COUNTIES.harris")).toBe(false);
  });

  it("never memoizes a single resolved layer URL for the life of the session", () => {
    // The old bug: `if (idLayerRef.current) return idLayerRef.current;` — one URL, resolved once,
    // reused forever. The per-county cache (countyLayerUrlsRef) is fine (it's keyed by county and
    // re-asked per point); a single un-keyed ref is not. (A historical mention of the old function
    // NAME in a comment is fine — this checks it is no longer DEFINED or CALLED.)
    expect(region.includes("idLayerRef")).toBe(false);
    expect(region.includes("resolveCountyLayer()")).toBe(false);
    expect(region.includes("resolveCountyLayer = ")).toBe(false);
  });

  it("the click's \"no parcel\" message distinguishes real causes instead of always blaming aim", () => {
    // NEW-2 — a healthy source answering honestly, an unconfigured county, and an unreachable
    // server must not all collapse to "click directly on a lot."
    expect(region.includes("noParcelSourceNote")).toBe(true);
    expect(region.includes("res.responded === 0")).toBe(true);
  });
});
