/* foodSearchProximity (B2051664) — Food search is ordered nearest-the-visible-map first, as a bias
 * and never a filter. Fixture only: invented rows, no Supabase, none of the owner's data. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rankByProximity, textScore, EXACT_SCORE } from "../src/workspaces/food/lib/searchProximity.js";
import { rankSearchCandidates } from "../src/workspaces/food/lib/searchQuality.js";

const view = (lat, lon, half = 0.1) => ({ south: lat - half, north: lat + half, west: lon - half, east: lon + half });
const KATY = view(29.7858, -95.8245), DALLAS = view(32.7767, -96.797), HOUSTON = view(29.76, -95.37);
const row = (id, name, lat, lon, extra = {}) => ({ id, name, lat, lon, address: "", sim: 1, confidence: 0.9, ...extra });

const TACOS = [
  row("d1", "Taco Shack", 32.78, -96.80, { address: "100 Main St, Dallas, TX 75201" }),
  row("k1", "Taco Shack", 29.79, -95.82, { address: "5 Katy Fwy, Katy, TX 77450" }),
  row("d2", "Taco Shack", 32.90, -96.70),
  row("k2", "Taco Shack", 29.70, -95.75),
];
const ids = (xs) => xs.map((x) => x.id);

describe("rankByProximity", () => {
  it("same query: Katy first when centred on Katy, Dallas first when recentred on Dallas", () => {
    expect(ids(rankByProximity("taco shack", TACOS, KATY)).slice(0, 2)).toEqual(["k1", "k2"]);
    expect(ids(rankByProximity("taco shack", TACOS, DALLAS)).slice(0, 2)).toEqual(["d1", "d2"]);
  });

  it("never filters: every candidate is still returned, far ones last", () => {
    const out = rankByProximity("taco shack", TACOS, KATY);
    expect(out).toHaveLength(TACOS.length);
    expect(ids(out).slice(2).sort()).toEqual(["d1", "d2"]);
  });

  it("a match just OUTSIDE the visible area still appears, after the in-view ones", () => {
    const edge = row("e1", "Taco Shack", KATY.north + 0.01, -95.8245);
    const out = rankByProximity("taco shack", [edge, TACOS[1]], KATY);
    expect(ids(out)).toEqual(["k1", "e1"]);
  });

  it("a far exact address beats a weak nearby fuzzy match", () => {
    const far = row("far", "Joe's Diner", 32.78, -96.80, { sim: 0.4, address: "1500 Elm Street, Dallas, TX 75201" });
    const weak = row("weak", "Elm Street Cafe", 29.7858, -95.8245, { sim: 0.55 });
    expect(ids(rankByProximity("1500 elm street dallas", [weak, far], KATY))[0]).toBe("far");
  });

  it("a far exact name beats a weaker nearby partial match; a short fragment is never an 'exact address'", () => {
    const far = row("far", "Pho Saigon", 32.78, -96.80);
    const near = row("near", "Pho Saigon Express Kitchen Bar", 29.7858, -95.8245, { sim: 0.7 });
    expect(ids(rankByProximity("pho saigon", [near, far], KATY))[0]).toBe("far");
    expect(textScore("main", row("x", "Cafe", 0, 0, { address: "100 Main St" }))).toBeLessThan(EXACT_SCORE);
  });

  it("comparable text scores: proximity decides; clearly better text outranks closeness", () => {
    const nearOk = row("nearOk", "Taco Palace", 29.79, -95.82, { sim: 0.9 });
    const farBest = row("farBest", "Taco Heaven", 32.78, -96.80, { sim: 1 });
    const nearWeak = row("nearWeak", "Tacos y Mas", 29.79, -95.82, { sim: 0.5 });
    const out = ids(rankByProximity("taco", [farBest, nearOk, nearWeak], KATY));
    expect(out[0]).toBe("nearOk");      // 0.9 vs 1.0 are comparable → nearer wins
    expect(out.indexOf("farBest")).toBeLessThan(out.indexOf("nearWeak")); // 0.5 is not
  });

  it("saved vs place-search at a similar distance: the saved place leads; a clearly nearer place still wins", () => {
    const saved = { id: "s", name: "Cafe Uno", lat: 29.80, lon: -95.82, kind: "manual", mine: true, sim: undefined };
    const placeSame = row("p", "Cafe Uno", 29.8005, -95.82);
    const placeNear = row("n", "Cafe Uno", 29.7858, -95.8245);
    expect(ids(rankByProximity("cafe uno", [placeSame, saved], KATY))).toEqual(["s", "p"]);
    expect(ids(rankByProximity("cafe uno", [saved, placeNear], KATY))[0]).toBe("n");
  });

  it("zoomed far out (whole state in view): distance from the centre still orders them; no view keeps input order", () => {
    const state = { south: 25.8, north: 36.5, west: -106.6, east: -93.5 };
    const out = rankByProximity("taco shack", TACOS, state);
    expect(out).toHaveLength(4);
    expect(rankByProximity("taco shack", TACOS, null)).toEqual(TACOS);
  });

  it("zero matches near the view: far matches are all returned, nearest-far first", () => {
    const out = rankByProximity("taco shack", [TACOS[2], TACOS[0]], HOUSTON);
    expect(out).toHaveLength(2);
  });

  it("re-running after a pan re-ranks (pure function of the CURRENT view)", () => {
    const a = ids(rankByProximity("taco shack", TACOS, KATY))[0];
    const b = ids(rankByProximity("taco shack", TACOS, DALLAS))[0];
    expect(a).not.toBe(b);
  });
});

describe("pipeline with the real candidate filter (rankSearchCandidates → rankByProximity)", () => {
  it("keeps the Katy-first / Dallas-first behaviour and does not disturb near-duplicate collapse", () => {
    const dupe = row("k1b", "Taco Shack", 29.79001, -95.82001, { confidence: 0.5 }); // same storefront
    const cands = rankSearchCandidates("taco shack", [...TACOS, dupe]);
    expect(cands.some((c) => c.id === "k1b")).toBe(false);
    expect(ids(rankByProximity("taco shack", cands, KATY))[0]).toBe("k1");
    expect(ids(rankByProximity("taco shack", cands, DALLAS))[0]).toBe("d1");
  });
});

describe("wiring", () => {
  const box = readFileSync(new URL("../src/workspaces/food/components/SearchBox.jsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/workspaces/food/lib/foodStore.js", import.meta.url), "utf8");
  it("SearchBox ranks the merged list by the live view and the RPC pool is big enough to hold nearby matches", () => {
    expect(box).toMatch(/rankByProximity\(trimmed,[\s\S]*bounds\)/);
    expect(Number(/SEARCH_RESULT_CAP = (\d+)/.exec(store)[1])).toBeGreaterThanOrEqual(40);
  });
});
