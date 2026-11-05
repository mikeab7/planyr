/* foodSearchProximity (B2051664) — Food search is ordered nearest-the-visible-map first, as a bias
 * and never a filter. Fixture only: invented rows, no Supabase, none of the owner's data. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rankByProximity, textScore, EXACT_SCORE, nameEquivalent } from "../src/workspaces/food/lib/searchProximity.js";
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

  it("saved vs place-search: the saved place leads at a similar distance AND when a clearly nearer place exists (owner 2026-10-04 reversed the old 'nearer still wins')", () => {
    const saved = { id: "s", name: "Cafe Uno", lat: 29.80, lon: -95.82, kind: "manual", mine: true, sim: undefined };
    const placeSame = row("p", "Cafe Uno", 29.8005, -95.82);
    const placeNear = row("n", "Cafe Uno", 29.7858, -95.8245);
    expect(ids(rankByProximity("cafe uno", [placeSame, saved], KATY))).toEqual(["s", "p"]);
    expect(ids(rankByProximity("cafe uno", [saved, placeNear], KATY))[0]).toBe("s");
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

/* NEW-1 (2026-10-10): a slightly misspelled name must still put the real nearby place on top.
 * Fixture mirrors the measured production pool for a Cinco Ranch centre (names/cities only). */
import { fuzzyNameScore, editDistance } from "../src/workspaces/food/lib/searchProximity.js";
describe("typo-tolerant name score (NEW-1)", () => {
  const CINCO = view(29.74, -95.77, 0.04);
  const FRY = row("fry", "Carrabba's Italian Grill", 29.7, -95.78, { address: "6501 S Fry Rd, Katy, TX, 77494", sim: 0.4 });
  const field = (simFor) => [
    row("kirby", "Carrabbas Italian Grill", 29.72, -95.42, { address: "Kirby Dr, Houston, TX", sim: 1 }),
    row("grape", "Carrabbas Italian Grill", 32.9, -97.1, { address: "Grapevine, TX", sim: 1 }),
    row("carabas-hou", "Carabas Italian Restaurant | Houston, TX", 29.76, -95.37, { address: "Houston, TX", sim: 1 }),
    row("austin", "Carrabas Italian Grill", 30.27, -97.74, { address: "Austin, TX", sim: 1 }),
    row("caramel", "Dallas Caramel Company", 33.0, -96.5, { address: "Wylie, TX", sim: 0.625 }),
    row("chain-hou", "Carrabba's Italian Grill", 29.71, -95.55, { address: "Katy Fwy, Houston, TX", sim: simFor }),
    { ...FRY, sim: simFor },
  ];
  for (const [q, sim] of [["Carabas", 0.4], ["Carrabas", 0.67], ["Carrabbas", 0.8], ["Carrabba's", 1], ["carrab", 1]]) {
    it(`"${q}" → the nearby Carrabba's is #1`, () => {
      expect(rankByProximity(q, field(sim), CINCO)[0].id).toBe("fry");
    });
  }
  it("squashes punctuation, spaces and doubled letters; one edit sits a band below a clean hit", () => {
    expect(fuzzyNameScore("Carabas", "Carrabba's Italian Grill")).toBe(1);
    expect(fuzzyNameScore("Chikfila", "Chick-fil-A")).toBeCloseTo(0.8);
    expect(fuzzyNameScore("Chipolte", "Chipotle Mexican Grill")).toBeCloseTo(0.8);
    expect(fuzzyNameScore("Carabas", "Caramba Street Food")).toBeLessThan(0.85);
    expect(fuzzyNameScore("zoes", "Zoës Kitchen")).toBe(1);
  });
  it("tolerates nothing on very short queries and ignores unrelated names", () => {
    expect(fuzzyNameScore("tac", "Tao")).toBe(0);
    expect(fuzzyNameScore("Carabas", "Dallas Caramel Company")).toBe(0);
    expect(editDistance("chipolte", "chipotle")).toBe(1);
  });
  it("control: a correct spelling and a far exact name are unchanged", () => {
    const torchy = [row("far", "Torchy's Tacos", 32.78, -96.8, { sim: 1 }), row("near", "Taco Bell", 29.74, -95.77, { sim: 0.5 })];
    expect(rankByProximity("Torchys", torchy, CINCO)[0].id).toBe("far");
    expect(textScore("Torchy's Tacos", torchy[0])).toBe(EXACT_SCORE);
  });
});

/* NEW-1 (2026-10-11, B2155616 ×2) — a stray row spelled exactly like the typo must not beat the nearby real chain. */
describe("typo-equivalent names are one comparable group", () => {
  const CINCO = view(29.74, -95.77, 0.04);
  const cfa = row("katy", "Chick-fil-A", 29.75, -95.76, { sim: 0.33, address: "23860 Westheimer Pkwy, Katy, TX" });
  const strays = [
    row("strayA", "Chik Fila", 29.9, -95.5, { sim: 0.58, address: "6175 Highway 6 N Lot 7, Houston, TX" }),
    row("strayB", "Chik-fil-a", 33.0, -96.7, { sim: 0.44, address: "Plano, TX" }),
  ];
  it("Chikfila / Chikfil-a: the nearest Katy Chick-fil-A beats literal-typo strays", () => {
    for (const q of ["Chikfila", "Chikfil-a"]) expect(rankByProximity(q, [...strays, cfa], CINCO)[0].id).toBe("katy");
  });
  it("Whataburgr: one edit away counts for a long query, so the Katy store beats a far corporate row", () => {
    const rows = [row("irving", "Whataburgr Restaurant", 32.8, -96.9, { sim: 1, address: "1600 Corporate Ct, Irving, TX" }),
      row("katy", "Whataburger", 29.75, -95.76, { sim: 0.82, address: "23540 Westheimer Pkwy, Katy, TX" })];
    expect(rankByProximity("Whataburgr", rows, CINCO)[0].id).toBe("katy");
  });
  it("inside the group a city-only address and a registry name sort after a clean street address, even when nearer", () => {
    const rows = [row("vague", "Chik-fil-a", 29.741, -95.771, { sim: 0.4, address: "Houston, TX" }),
      row("llc", "Chik Fila", 29.742, -95.772, { sim: 0.5, address: "1 Main St, Katy, TX", isRegistryName: true }),
      row("clean", "Chick-fil-A", 29.78, -95.8, { sim: 0.33, address: "9 Katy Fwy, Katy, TX" })];
    expect(ids(rankByProximity("Chikfila", rows, CINCO))).toEqual(["clean", "vague", "llc"]) /* both weak rows tie → distance */;
  });
  it("short queries and two-edit lookalikes stay out of the group", () => {
    expect(nameEquivalent("carrab", { name: "The Juicy Crab" })).toBe(false);
    expect(nameEquivalent("Carabas", { name: "Caramba Street Food" })).toBe(false);
    expect(nameEquivalent("Carabas", { name: "Carrabba's" })).toBe(true);
    expect(nameEquivalent("pho saigon", { name: "Pho Saigon Express Kitchen Bar" })).toBe(false);
    expect(nameEquivalent("Whataburgr", { name: "Whataburger" })).toBe(true);
  });
  it("Fadis: a nearby branded chain location (name starts with the query) joins the group; unbranded extensions don't", () => {
    expect(nameEquivalent("Fadis", { name: "Fadi's Mediterranean Grill", brand: "Fadi's Mediterranean Grill" })).toBe(true);
    expect(nameEquivalent("Fadis", { name: "Fadi's Mediterranean Grill" })).toBe(false);
    const rows = [row("far", "Fadi's", 29.9, -95.5, { sim: 0.67, address: "10403 Katy Fwy, Houston, TX", brand: "Fadi's Mediterranean Grill" }),
      row("katy", "Fadi's Mediterranean Grill", 29.75, -95.76, { sim: 0.67, address: "21792 Katy Fwy, Katy, TX", brand: "Fadi's Mediterranean Grill" })];
    expect(rankByProximity("Fadis", rows, CINCO)[0].id).toBe("katy");
  });
  it("control: a uniquely named far place typed exactly still leads over unrelated nearby rows", () => {
    const rows = [row("austin", "Copperhead Club", 30.24, -97.72, { sim: 1, address: "2120 E Riverside Dr, Austin, TX" }),
      row("near", "Copper Kettle Cafe", 29.745, -95.77, { sim: 0.45, address: "1 Fry Rd, Katy, TX" })];
    expect(rankByProximity("Copperhead Club", rows, CINCO)[0].id).toBe("austin");
  });
});
