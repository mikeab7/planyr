/* Food search: his saved restaurants come first, exactly once (owner 2026-10-04, NEW-1).
 * Fixtures only — invented/anonymised rows shaped like the production cases; no Supabase, no real list. */
import { describe, it, expect } from "vitest";
import { addressKey, samePlace, existingRestaurants, mergeSearchRows } from "../src/workspaces/food/lib/placeIdentity.js";
import { rankByProximity, textScore } from "../src/workspaces/food/lib/searchProximity.js";
import { rankSearchCandidates } from "../src/workspaces/food/lib/searchQuality.js";

const HOUSTON = { south: 29.5, north: 30.0, west: -95.8, east: -95.0 };
const DALLAS = { south: 32.6, north: 33.0, west: -97.0, east: -96.6 };
const r = (id, name, lat, lon, address, extra = {}) => ({ id, name, lat, lon, address, sim: 1, confidence: 0.9, ...extra });

// DAO'N: same address, zip+4 vs 5-digit, one copy geocoded ~20 km away (the real production shape).
const SAVED_DAON = r("daon-a", "DAO'N Korean Modern Restaurant", 29.79432, -95.53548, "9861 Long Point Rd, Houston, TX, 77055-4107");
const DUP_DAON = r("daon-b", "DAO'N Korean Modern Restaurant", 29.76282, -95.36341, "9861 Long Point Rd, Houston, TX, 77055");
const AUSTIN = r("daon-x", "Daon", 30.47717, -97.79887, "11301 Lakeline Blvd, Austin, TX, 78717-5912");

function pipeline(query, raw, { saved = [], loggedIds, bounds }) {
  const existing = existingRestaurants({ loggedPlaces: saved });
  const logged = new Set(loggedIds);
  const cands = rankSearchCandidates(query, raw, logged);
  const savedRows = existing.filter((e) => e.kind === "place").map((e) => ({ ...e.ref, kind: "place", mine: logged.has(e.ref.id) }));
  const rows = [...savedRows, ...cands.map((p) => ({ ...p, kind: "place", mine: logged.has(p.id) }))];
  const merged = mergeSearchRows({ snapshotRows: rows, existing });
  return rankByProximity(query, merged, bounds);
}

describe("addressKey / samePlace", () => {
  it("ignores zip+4, NW vs Northwest, Freeway vs Fwy, unit, case and punctuation", () => {
    expect(addressKey("9861 Long Point Rd, Houston, TX, 77055-4107")).toBe(addressKey("9861 long point road, Houston, TX 77055"));
    expect(addressKey("12950 NW Fwy, Houston")).toBe(addressKey("12950 Northwest Freeway Ste 100, Houston"));
    expect(addressKey("Houston, TX")).toBeNull();
  });
  it("same name + same street is one place even 20 km apart; same name, different street stays two", () => {
    expect(samePlace(SAVED_DAON, DUP_DAON)).toBe(true);
    expect(samePlace(r("1", "Texas Roadhouse", 29.7, -95.4, "1 A St"), r("2", "Texas Roadhouse", 29.7, -95.6, "9 B St"))).toBe(false);
  });
});

describe("saved place first, once", () => {
  it("'daon' at a Houston view: saved DAO'N is row 1, appears once, the far duplicate is gone", () => {
    const out = pipeline("daon", [AUSTIN, DUP_DAON, SAVED_DAON], { saved: [SAVED_DAON], loggedIds: ["daon-a"], bounds: HOUSTON });
    expect(out[0].id).toBe("daon-a");
    expect(out[0].mine).toBe(true);
    expect(out.filter((x) => /dao'n/i.test(x.name))).toHaveLength(1);
  });
  it("same answer with the map looking at Dallas", () => {
    const out = pipeline("daon", [AUSTIN, DUP_DAON, SAVED_DAON], { saved: [SAVED_DAON], loggedIds: ["daon-a"], bounds: DALLAS });
    expect(out[0].id).toBe("daon-a");
  });
  it("older saved row whose id never came back from the capped RPC is still found, first", () => {
    const manyRoadhouses = Array.from({ length: 60 }, (_, i) => r(`rh${i}`, "Texas Roadhouse", 29.7 + i * 0.001, -95.4, `${100 + i} Main St, Houston`));
    const savedRh = r("rh-saved", "Texas Roadhouse", 29.82, -95.9, "20525 Katy Fwy, Katy, TX 77449");
    const out = pipeline("roadhouse", manyRoadhouses, { saved: [savedRh], loggedIds: ["rh-saved"], bounds: HOUSTON });
    expect(out[0].id).toBe("rh-saved");
  });
  it("saved place without sim scores a punctuation-blind match", () => {
    expect(textScore("daon", { name: "DAO'N Korean Modern Restaurant", address: "" })).toBeGreaterThanOrEqual(1);
  });
  it("two saved places with the same chain name both lead, neither duplicated", () => {
    const a = r("t1", "El Tiempo Cantina", 29.7, -95.4, "1 A St, Houston"), b = r("t2", "El Tiempo Taqueria", 29.8, -95.5, "2 B St, Houston");
    const others = Array.from({ length: 5 }, (_, i) => r(`o${i}`, "El Tiempo Cantina", 29.75, -95.4 + i * 0.01, `${50 + i} Z St, Houston`));
    const out = pipeline("el tiempo", [...others, a, b], { saved: [a, b], loggedIds: ["t1", "t2"], bounds: HOUSTON });
    expect(out.slice(0, 2).map((x) => x.id).sort()).toEqual(["t1", "t2"]);
    expect(new Set(out.map((x) => x.id)).size).toBe(out.length);
  });
});

// NEW-2 (B2021649): "dao" listed his saved Dairy Queen — the RPC's loose trigram pool returned it and
// the saved-place exemption skipped the word-match rule. Fixtures only.
describe("saved places must genuinely match the query (NEW-2)", () => {
  const DQ = r("dq", "Dairy Queen", 29.7, -95.4, "1 Main St, Houston, TX", { sim: 0.4 });
  const REAL = [
    r("deDao", "De Dao", 29.7, -95.4, "2 A St, Houston"), r("phoCaDao", "Pho Ca Dao", 29.7, -95.41, "3 B St, Houston"),
    r("daoLao", "Dao Lao Thai", 29.7, -95.42, "4 C St, Houston"),
  ];
  const names = (q, raw, logged) => rankSearchCandidates(q, raw, new Set(logged)).map((x) => x.name);

  it("'dao' does not list a saved Dairy Queen, but still lists saved places that really match", () => {
    expect(names("dao", [SAVED_DAON, DQ, ...REAL], ["dq", "daon-a", "deDao"])).not.toContain("Dairy Queen");
    expect(names("dao", [SAVED_DAON, DQ, ...REAL], ["dq", "daon-a", "deDao"])).toEqual(expect.arrayContaining(["De Dao"]));
  });
  it("short queries, apostrophes, case, multi-word and starts-with all still find the saved place", () => {
    expect(names("DAO", [SAVED_DAON], ["daon-a"])).toEqual([SAVED_DAON.name]);
    expect(names("daon", [SAVED_DAON], ["daon-a"])).toEqual([SAVED_DAON.name]);
    expect(names("dao'n korean", [SAVED_DAON], ["daon-a"])).toEqual([SAVED_DAON.name]);
    expect(names("dairy queen", [DQ], ["dq"])).toEqual(["Dairy Queen"]);
    expect(names("da", [DQ], ["dq"])).toEqual(["Dairy Queen"]);
  });
  it("a saved duplicate is still never collapsed away", () => {
    expect(names("daon", [SAVED_DAON, DUP_DAON], ["daon-a", "daon-b"]).length).toBe(2);
  });
});
