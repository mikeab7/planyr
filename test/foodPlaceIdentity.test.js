/* B2046224 — Food on a phone. The pure half of the duplicate fix (the browser half — real WebKit at
 * iPhone size, mocked Supabase — is ui-audit/verify-food-phone.mjs, which was run RED against the
 * pre-fix build and GREEN against this one; its output is on the backlog item).
 *
 * The bug: searching DAO'N listed it twice (his manual pin + the snapshot's own record), and picking
 * the second copy would have saved it as a brand-new restaurant. These tests pin the match rule, the
 * one-row merge, and the save-path guard — including the adjacent cases: apostrophes (straight and
 * curly), mixed case, a restaurant he has never saved, and a real chain whose branches must stay apart.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeName, samePlace, MERGE_RADIUS_METERS, existingRestaurants, findExisting, mergeSearchRows, canonicalIdentity,
} from "../src/workspaces/food/lib/placeIdentity.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const AT = { lat: 29.7380, lon: -95.5300 };
const NEAR = { lat: AT.lat + 0.00035, lon: AT.lon }; // ~39 m
const manual = (name, p = AT, extra = {}) => ({ key: `${name}|k`, name, lat: p.lat, lon: p.lon, visitIds: ["v1"], ...extra });
const snap = (name, p = NEAR, id = "fx-daon") => ({ id, name, lat: p.lat, lon: p.lon, address: "1 Fixture Way", kind: "place" });

describe("normalizeName — apostrophes, case, spacing, diacritics", () => {
  it("reads every spelling of DAO'N as one key", () => {
    for (const n of ["DAO'N", "dao'n", "Dao’N", "DAO‘N", "Dao N.", "DAO-N", "  dao 'n "]) expect(normalizeName(n)).toBe("daon");
  });
  it("folds diacritics and & ", () => {
    expect(normalizeName("Café José")).toBe("cafejose");
    expect(normalizeName("Fish & Chips")).toBe("fishandchips");
  });
  it("an empty / punctuation-only name has no key (never matches anything)", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(samePlace({ name: "!!!", ...AT }, { name: "???", ...AT })).toBe(false);
  });
});

describe("samePlace — name AND proximity, never either alone", () => {
  it("same name, a few metres apart → the same restaurant", () => {
    expect(samePlace(manual("DAO'N"), snap("dao’n"))).toBe(true);
  });
  it("same name, kilometres apart → a chain's other branch, NOT the same", () => {
    expect(samePlace(manual("Torchy's Tacos"), snap("Torchy's Tacos", { lat: AT.lat + 0.05, lon: AT.lon }))).toBe(false);
  });
  it("neighbours with different names → not the same", () => {
    expect(samePlace(manual("DAO'N"), snap("Fadi's Mediterranean Grill", NEAR))).toBe(false);
  });
  it("the radius is a stated constant, and the edge is respected", () => {
    const justInside = { lat: AT.lat + (MERGE_RADIUS_METERS - 20) / 111320, lon: AT.lon };
    const justOutside = { lat: AT.lat + (MERGE_RADIUS_METERS + 40) / 111320, lon: AT.lon };
    expect(samePlace(manual("DAO'N"), snap("DAO'N", justInside))).toBe(true);
    expect(samePlace(manual("DAO'N"), snap("DAO'N", justOutside))).toBe(false);
  });
  it("a record with no coordinates never matches (empty is not 'here')", () => {
    expect(samePlace({ name: "DAO'N", lat: null, lon: null }, snap("DAO'N"))).toBe(false);
  });
});

describe("mergeSearchRows — one row per restaurant", () => {
  const existing = existingRestaurants({ manualPins: [manual("DAO'N")] });
  const manualRows = [{ ...manual("DAO'N"), kind: "manual", mine: true }];

  it("DAO'N: his manual pin + the snapshot's record of it → ONE row, and it is the pin", () => {
    const rows = mergeSearchRows({ manualRows, snapshotRows: [snap("DAO'N")], existing });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
    expect(rows[0].visitIds).toEqual(["v1"]); // the row his past visits hang off
  });
  it("…even when the query surfaced only the snapshot side (punctuation-different spelling)", () => {
    const rows = mergeSearchRows({ manualRows: [], snapshotRows: [snap("DAO'N")], existing: existingRestaurants({ manualPins: [manual("Dao’N")] }) });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
    expect(rows[0].name).toBe("Dao’N");
  });
  it("a restaurant he has NEVER saved stays a plain snapshot row", () => {
    const rows = mergeSearchRows({ manualRows, snapshotRows: [snap("Fadi's Mediterranean Grill", { lat: 29.68, lon: -95.46 }, "fx-fadis")], existing });
    expect(rows.map((r) => r.name)).toEqual(["DAO'N", "Fadi's Mediterranean Grill"]);
    expect(rows[1].kind).toBe("place");
  });
  it("a real chain keeps its genuinely different branches", () => {
    const a = { ...snap("Torchy's Tacos", { lat: 29.74, lon: -95.40 }, "a"), address: "10 Alpha St, Houston" };
    const b = { ...snap("Torchy's Tacos", { lat: 29.77, lon: -95.43 }, "b"), address: "20 Beta St, Houston" };
    expect(mergeSearchRows({ snapshotRows: [a, b], existing: [] })).toHaveLength(2);
  });
  it("a second snapshot id for a place he logged under another id collapses onto the logged one", () => {
    const logged = { id: "logged-1", name: "Pho Saigon", lat: AT.lat, lon: AT.lon };
    const ex = existingRestaurants({ loggedPlaces: [logged] });
    const rows = mergeSearchRows({ snapshotRows: [snap("Pho Saigon", NEAR, "other-2")], existing: ex });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("logged-1");
    expect(rows[0].mine).toBe(true);
  });
  it("two of his OWN pins with the same name are never collapsed into each other", () => {
    const rows = mergeSearchRows({ manualRows: [{ ...manual("Taco Stand"), kind: "manual" }, { ...manual("Taco Stand", NEAR), key: "k2", kind: "manual" }], existing: [] });
    expect(rows).toHaveLength(2);
  });
  it("a flagged-only pin reads 'want to try', never 'been here'", () => {
    const ex = existingRestaurants({ wishlistManualPins: [manual("DAO'N", AT, { visitIds: [] })] });
    const rows = mergeSearchRows({ snapshotRows: [snap("DAO'N")], existing: ex });
    expect(rows[0].mine).toBe(false);
    expect(rows[0].wishlisted).toBe(true);
  });
});

describe("canonicalIdentity — the save-path guard", () => {
  const existing = existingRestaurants({ manualPins: [manual("DAO'N")] });

  it("saving on the snapshot copy of a restaurant he has as a manual pin lands on the PIN (no second record)", () => {
    const id = canonicalIdentity({ kind: "place", place: snap("DAO'N") }, "", existing);
    expect(id).toEqual({ custom_name: "DAO'N", custom_lat: AT.lat, custom_lon: AT.lon });
    expect(id.place_id).toBeUndefined();
  });
  it("a dropped pin typed with an existing name near it reuses that pin exactly (same group key)", () => {
    const id = canonicalIdentity({ kind: "newPin", lat: NEAR.lat, lon: NEAR.lon }, "dao’n", existing);
    expect(id).toEqual({ custom_name: "DAO'N", custom_lat: AT.lat, custom_lon: AT.lon });
  });
  it("a never-saved restaurant keeps its own snapshot id", () => {
    expect(canonicalIdentity({ kind: "place", place: snap("Fadi's", { lat: 29.68, lon: -95.46 }, "fx-fadis") }, "", existing)).toEqual({ place_id: "fx-fadis" });
  });
  it("a new pin with a new name stays a new pin", () => {
    expect(canonicalIdentity({ kind: "newPin", lat: 29.9, lon: -95.1 }, "Taco Truck", existing)).toEqual({ custom_name: "Taco Truck", custom_lat: 29.9, custom_lon: -95.1 });
  });
  it("an existing manual pin is never remapped onto a same-named neighbour", () => {
    const two = existingRestaurants({ manualPins: [manual("Taco Stand"), { ...manual("Taco Stand", NEAR), key: "k2" }] });
    const pinB = { ...manual("Taco Stand", NEAR), key: "k2" };
    expect(canonicalIdentity({ kind: "manualPin", pin: pinB }, "", two)).toEqual({ custom_name: "Taco Stand", custom_lat: NEAR.lat, custom_lon: NEAR.lon });
  });
  it("when several of his records match, the NEAREST wins", () => {
    const two = existingRestaurants({ manualPins: [manual("Taco Stand", { lat: AT.lat + 0.002, lon: AT.lon }), { ...manual("Taco Stand", AT), key: "near" }] });
    expect(findExisting({ name: "Taco Stand", lat: AT.lat, lon: AT.lon + 0.00001 }, two).ref.key).toBe("near");
  });
});

/* The wiring — each of these is a line the pre-fix code did not have. The behaviour itself is proven in a
 * real WebKit browser by ui-audit/verify-food-phone.mjs; these keep the wiring from being quietly removed. */
describe("wiring (B2046224)", () => {
  const app = read("src/workspaces/food/FoodApp.jsx");
  const search = read("src/workspaces/food/components/SearchBox.jsx");
  const map = read("src/workspaces/food/components/FoodMap.jsx");

  it("every write path resolves its identity through canonicalIdentity (save + want-to-try)", () => {
    expect((app.match(/canonicalIdentity\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it("opening a snapshot place that is really an existing restaurant opens THAT one", () => {
    expect(app).toMatch(/findExisting\(place, existing\)/);
  });
  it("the search dropdown merges through mergeSearchRows, not a raw concat of manual + snapshot rows", () => {
    expect(search).toMatch(/mergeSearchRows\(\{/);
    expect(search).not.toMatch(/\.\.\.manualMatches,\s*\n\s*\.\.\.snapshotRanked/);
  });
  it("the phone toolbar fills one screen: the search field flexes instead of a fixed width past the edge", () => {
    // NEW-1 (food controls): one row that fits its slot (width 100%, min-width 0); the search field
    // takes whatever the Map/List switch and the pin button leave, and the pin label shortens on a phone.
    expect(app).toMatch(/width: "100%", minWidth: 0/);
    expect(app).toMatch(/narrow \? "Pin" : "Drop a pin"/);
    expect(search).toMatch(/flex: "1 1 120px", minWidth: 0, maxWidth: 280/);
    expect(search).toMatch(/width: "100%"/);
  });
  it("phone selection centres above the bottom sheet: no right-rail shift on narrow", () => {
    expect(map).toMatch(/panelOffsetPx = narrowViewport \? 0 :/);
    expect(map).toMatch(/applySheetCentring\(\)/);
  });
});
