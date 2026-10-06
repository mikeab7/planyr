/* NEW-1 / B2088288 — named restaurant lists. The pure half (lib/foodLists.js, no Supabase import): the rules
 * Michael's brief names — the same restaurant reached through two different search rows is ONE membership,
 * a manual pin's identity round-trips, removing from one list leaves the other alone, names are unique
 * case-insensitively — plus the "status is derived, never stored" contract and the source guards (nothing
 * in the lists code writes a status, a visit, a dish or a wishlist row; deleting a list cascades on list_id).
 * The browser half is ui-audit/verify-food-lists.mjs; the database half is db/test/food_rls.test.sql.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LIST_COLORS, nextListColor, cleanListName, validateListName, nextListPosition, identityKey, itemIdentity,
  itemKey, toListIdentity, findItem, addDecision, listIdsFor, emphasisKeys, statusOf, memberRecords, pickerRows,
  itemsOfList, isPaletteColor,
} from "../src/workspaces/food/lib/foodLists.js";
import { existingRestaurants, canonicalIdentity, mergeSearchRows } from "../src/workspaces/food/lib/placeIdentity.js";
import { manualGroupKey, manualPinKey } from "../src/workspaces/food/lib/pinKeys.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Fadi's, twice in the snapshot: the same restaurant under two ids ~40 m apart (a second source's record).
const FADIS_A = { id: "ov:fadis-a", name: "Fadi's Mediterranean Grill", lat: 29.7604, lon: -95.3698, address: "5750 Katy Fwy, Houston, TX" };
const FADIS_B = { id: "ov:fadis-b", name: "Fadis Mediterranean Grill", lat: 29.76043, lon: -95.36975, address: "5750 Katy Freeway, Houston, TX 77007" };
const CFA = { id: "ov:cfa-1", name: "Chick-fil-A", lat: 29.7, lon: -95.4 };
const ZOA = { id: "ov:zoa", name: "Zoa Moroccan Kitchen", lat: 29.8, lon: -95.5 };

let n = 0;
const row = (list_id, ident) => ({ id: `i${++n}`, list_id, ...ident });

describe("list names", () => {
  it("trims, collapses spaces, and refuses a blank name instead of defaulting one", () => {
    expect(cleanListName("  Lunch   @  Work ")).toBe("Lunch @ Work");
    expect(validateListName("   ", []).ok).toBe(false);
    expect(validateListName("   ", []).message).toMatch(/name/i);
  });
  it("is unique per user, case-insensitively — two 'Lunch' lists is refused with a message", () => {
    const lists = [{ id: "L1", name: "Lunch @ Work" }];
    const r = validateListName("  lunch @ WORK ", lists);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already have a list called "Lunch @ Work"/);
    expect(validateListName("Dinner After Work", lists)).toEqual({ ok: true, name: "Dinner After Work" });
  });
  it("a list may keep its own name (or change only its case) when renamed — never clash with itself", () => {
    const lists = [{ id: "L1", name: "Lunch" }, { id: "L2", name: "Dinner" }];
    expect(validateListName("LUNCH", lists, "L1").ok).toBe(true);
    expect(validateListName("dinner", lists, "L1").ok).toBe(false); // but not onto ANOTHER list's name
  });
  it("apostrophes and punctuation are ordinary characters (Fadi's, Little Jimmy's)", () => {
    expect(validateListName("Fadi's & Little Jimmy's", []).name).toBe("Fadi's & Little Jimmy's");
  });
  it("is refused when absurdly long", () => {
    expect(validateListName("x".repeat(80), []).ok).toBe(false);
  });
});

describe("colour + position", () => {
  it("the palette is small and fixed; a new list takes the first colour not yet used", () => {
    expect(LIST_COLORS.length).toBeGreaterThanOrEqual(5);
    expect(LIST_COLORS.length).toBeLessThanOrEqual(6);
    const a = nextListColor([]);
    const b = nextListColor([{ color: a }]);
    expect(b).not.toBe(a);
    expect(isPaletteColor(a)).toBe(true);
    expect(isPaletteColor("#123456")).toBe(false);
  });
  it("cycles once every swatch is used, and a new list goes last", () => {
    const all = LIST_COLORS.map((c, i) => ({ color: c.hex, position: i }));
    expect(isPaletteColor(nextListColor(all))).toBe(true);
    expect(nextListPosition(all)).toBe(all.length);
    expect(nextListPosition([])).toBe(0);
  });
});

describe("identity", () => {
  it("a manual pin's identity round-trips through a stored row with the same key the map draws it under", () => {
    const ident = { custom_name: "Taco Truck", custom_lat: 29.76041, custom_lon: -95.36991 };
    const r = row("L1", ident);
    expect(itemIdentity(r)).toEqual(ident);
    expect(itemKey(r)).toBe(manualPinKey("Taco Truck", 29.76041, -95.36991));
    // the 4dp rounding that makes two presses a few feet apart one pin
    expect(identityKey({ custom_name: "Taco Truck", custom_lat: 29.76043, custom_lon: -95.36989 })).toBe(itemKey(r));
    expect(itemKey(r)).toBe(`pin:${manualGroupKey("Taco Truck", 29.7604, -95.3699)}`);
  });
  it("a snapshot place is keyed place:<id>, matching the map's pin key", () => {
    expect(identityKey({ place_id: "ov:zoa" })).toBe("place:ov:zoa");
    expect(itemKey(row("L1", { place_id: "ov:zoa" }))).toBe("place:ov:zoa");
  });
  it("a live (Overpass) row is stored as a manual pin — its osm: id is not in food_places and would break the FK", () => {
    const live = { id: "osm:node/123", name: "Little Jimmy's", lat: 29.5, lon: -95.2 };
    expect(toListIdentity({ place_id: live.id }, live)).toEqual({ custom_name: "Little Jimmy's", custom_lat: 29.5, custom_lon: -95.2 });
    expect(toListIdentity({ place_id: "ov:zoa" }, ZOA)).toEqual({ place_id: "ov:zoa" });
    expect(toListIdentity({ place_id: "osm:way/9" }, { name: "x" })).toBeNull();
  });
});

describe("the same restaurant reached through two search rows is ONE membership", () => {
  it("collapses onto the record already on the list (via canonicalIdentity over the list members)", () => {
    const items = [row("L1", { place_id: FADIS_A.id })];
    const existing = existingRestaurants({ listPlaces: [FADIS_A] });
    // the second row, a different id for the same restaurant
    const ident = canonicalIdentity({ kind: "place", place: FADIS_B }, null, existing);
    expect(ident).toEqual({ place_id: FADIS_A.id });
    expect(addDecision(items, "L1", ident)).toBe("already");
  });
  it("collapses via a place he has VISITED too (the existing record is the one that is listed)", () => {
    const existing = existingRestaurants({ loggedPlaces: [FADIS_A] });
    expect(canonicalIdentity({ kind: "place", place: FADIS_B }, null, existing)).toEqual({ place_id: FADIS_A.id });
  });
  it("adding by the SAME id twice is 'already' as well", () => {
    const items = [row("L1", { place_id: CFA.id })];
    expect(addDecision(items, "L1", { place_id: CFA.id })).toBe("already");
    expect(addDecision(items, "L1", { place_id: ZOA.id })).toBe("add");
  });
  it("two real branches of a chain stay SEPARATE restaurants (name alone is never enough)", () => {
    const farBranch = { ...CFA, id: "ov:cfa-2", lat: 29.9, lon: -95.6 };
    const existing = existingRestaurants({ listPlaces: [CFA] });
    expect(canonicalIdentity({ kind: "place", place: farBranch }, null, existing)).toEqual({ place_id: "ov:cfa-2" });
  });
  it("a snapshot row that is really a list-only manual pin resolves onto the pin, and the search row is not labelled 'want to try'", () => {
    const pin = { key: manualGroupKey("Fadi's Mediterranean Grill", 29.7604, -95.3698), name: "Fadi's Mediterranean Grill", lat: 29.7604, lon: -95.3698, visitIds: [], listOnly: true };
    const existing = existingRestaurants({ listManualPins: [pin] });
    expect(canonicalIdentity({ kind: "place", place: FADIS_B }, null, existing)).toEqual({ custom_name: pin.name, custom_lat: pin.lat, custom_lon: pin.lon });
    const rows = mergeSearchRows({ snapshotRows: [{ ...FADIS_B, kind: "place" }], existing });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
    expect(rows[0].wishlisted).toBe(false);
  });
});

describe("membership across lists", () => {
  const lunch = "L-lunch", dinner = "L-dinner";
  const items = [
    row(lunch, { place_id: ZOA.id }), row(lunch, { place_id: CFA.id }), row(lunch, { place_id: FADIS_A.id }),
    row(dinner, { place_id: CFA.id }), row(dinner, { place_id: FADIS_A.id }),
  ];
  it("a place can be on several lists", () => {
    expect([...listIdsFor(items, { place_id: CFA.id })].sort()).toEqual([dinner, lunch].sort());
    expect([...listIdsFor(items, { place_id: ZOA.id })]).toEqual([lunch]);
    expect(listIdsFor(items, { place_id: "ov:none" }).size).toBe(0);
  });
  it("removing from one list leaves the other list alone", () => {
    const victim = findItem(items, lunch, { place_id: CFA.id });
    const after = items.filter((i) => i.id !== victim.id);
    expect(findItem(after, lunch, { place_id: CFA.id })).toBeUndefined();
    expect(findItem(after, dinner, { place_id: CFA.id })).toBeDefined();
    expect(itemsOfList(after, dinner)).toHaveLength(2);
  });
  it("emphasis: null for All (the map is exactly as before), the member keys for a list, EMPTY for an empty list", () => {
    expect(emphasisKeys(items, null)).toBeNull();
    expect([...emphasisKeys(items, dinner)].sort()).toEqual([`place:${CFA.id}`, `place:${FADIS_A.id}`].sort());
    const empty = emphasisKeys(items, "L-empty");
    expect(empty).toBeInstanceOf(Set);
    expect(empty.size).toBe(0);
  });
});

describe("status is DERIVED, never stored", () => {
  const ctx = {
    loggedIds: new Set([ZOA.id]), visitedManualKeys: new Set([manualGroupKey("Taco Truck", 29.7604, -95.3699)]),
    wishlistIds: new Set([CFA.id, ZOA.id]), wishlistManualKeys: new Set([manualGroupKey("Pop-up", 29.1, -95.1)]),
  };
  it("been / want / none", () => {
    expect(statusOf({ place_id: ZOA.id }, ctx)).toBe("been"); // visited AND flagged reads as been
    expect(statusOf({ place_id: CFA.id }, ctx)).toBe("want");
    expect(statusOf({ place_id: FADIS_A.id }, ctx)).toBe("none");
    expect(statusOf({ custom_name: "Taco Truck", custom_lat: 29.76041, custom_lon: -95.36991 }, ctx)).toBe("been");
    expect(statusOf({ custom_name: "Pop-up", custom_lat: 29.1, custom_lon: -95.1 }, ctx)).toBe("want");
  });
  it("a want-to-try place on a list that then gets a visit: the flag clears, the membership stays", () => {
    const items = [row("L1", { place_id: CFA.id })];
    const before = statusOf({ place_id: CFA.id }, { wishlistIds: new Set([CFA.id]) });
    expect(before).toBe("want");
    // visit logged → FoodApp's submitVisit removes the wishlist row (list rows are never touched)
    const after = statusOf({ place_id: CFA.id }, { loggedIds: new Set([CFA.id]), wishlistIds: new Set() });
    expect(after).toBe("been");
    expect(findItem(items, "L1", { place_id: CFA.id })).toBeDefined();
  });
  it("member records carry the derived status, and a not-yet-loaded place shows as … rather than vanishing", () => {
    const items = [row("L1", { place_id: CFA.id }), row("L1", { place_id: "ov:loading" }), row("L1", { custom_name: "Taco Truck", custom_lat: 29.7604, custom_lon: -95.3699 })];
    const recs = memberRecords(items, "L1", { nameOf: (i) => (i.place_id === CFA.id ? CFA : null), statusCtx: ctx });
    expect(recs.map((r) => [r.name, r.status])).toEqual([["Chick-fil-A", "want"], ["…", "none"], ["Taco Truck", "been"]]);
  });
});

describe("the picker's browsable rows", () => {
  const sources = {
    been: [{ ident: { place_id: ZOA.id }, name: ZOA.name }, { ident: { place_id: CFA.id }, name: CFA.name }],
    want: [{ ident: { place_id: FADIS_A.id }, name: FADIS_A.name }],
  };
  it("lists Been then Want to try, leaves out what is already on the list, and filters by chip", () => {
    const items = [row("L1", { place_id: CFA.id })];
    expect(pickerRows(sources, items, "L1", "all").map((r) => [r.name, r.status])).toEqual([[ZOA.name, "been"], [FADIS_A.name, "want"]]);
    expect(pickerRows(sources, items, "L1", "been").map((r) => r.name)).toEqual([ZOA.name]);
    expect(pickerRows(sources, items, "L1", "want").map((r) => r.name)).toEqual([FADIS_A.name]);
    expect(pickerRows(sources, items, "L2", "all")).toHaveLength(3); // another list still offers it
  });
});

describe("source guards", () => {
  const store = read("src/workspaces/food/lib/foodStore.js");
  const lists = read("src/workspaces/food/lib/foodLists.js");
  const sql = read("src/workspaces/food/db/food_lists.sql");
  it("the pure module imports no Supabase and the migration is mirrored into db/food.sql", () => {
    expect(lists).not.toMatch(/from\s+["'][^"']*supabase/);
    expect(read("src/workspaces/food/db/food.sql")).toContain(sql.trim());
  });
  it("no status column is added: lists never carry been/want state", () => {
    expect(sql).not.toMatch(/\b(status|been|want_to_try|wishlist)\b\s+(boolean|text)/i);
  });
  it("deleting a list cascades on list_id alone and the list writers touch no visit/dish/wishlist table", () => {
    expect(sql).toMatch(/foreign key \(list_id, user_id\)\s+references public\.food_lists \(id, user_id\) on delete cascade/);
    const block = store.slice(store.indexOf("Named restaurant lists"));
    const tables = [...block.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["food_lists", "food_list_items"])); // never a visit/dish/wishlist table
    expect(block).toMatch(/from\("food_lists"\)\.delete\(\)\.eq\("id", id\)/);
    expect(block).toMatch(/from\("food_list_items"\)\.delete\(\)\.eq\("id", id\)/);
  });
  it("RLS: owner-only, to authenticated, no anon policy, on both tables", () => {
    for (const t of ["food_lists", "food_list_items"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      for (const verb of ["select", "insert", "update", "delete"]) expect(sql).toContain(`create policy "Users ${verb} own ${t}"`);
    }
    expect(sql).not.toMatch(/to anon|to public/i);
  });
});
