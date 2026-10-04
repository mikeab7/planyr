/* Food module, owner report 2026-10-04 (phone): "DAO'N" listed twice in search, picking the second
 * copy saved a brand-new restaurant; picking a restaurant did not bring it into view; typing in
 * search pushed the Map / List toggle off screen.
 *
 * This suite is the CI-runnable half. The browser half is ui-audit/verify-food-phone-search.mjs
 * (Chromium iPhone-15 emulation on a mocked backend), which went 9 checks RED on main and 30/30
 * green with the fix. Every behavioural test here fails on main (the modules did not exist / the
 * source did not call them); the source-shape tests at the bottom pin the wiring so a refactor
 * cannot quietly route search or save around the one identity answer again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeName, sameSpot, findExisting, resolveSaveTarget, NEAR_METERS,
} from "../src/workspaces/food/lib/placeIdentity.js";
import { mergeSearchResults } from "../src/workspaces/food/lib/searchMerge.js";
import { cameraOffsetPx } from "../src/workspaces/food/lib/mapCamera.js";
import { manualPinsFromVisits, manualGroupKey } from "../src/workspaces/food/lib/foodStore.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => readFileSync(join(ROOT, "src/workspaces/food", p), "utf8");

const DAON = { lat: 29.75, lon: -95.42 };
const pin = (name, c = DAON, extra = {}) => ({ key: manualGroupKey(name, c.lat, c.lon), name, lat: c.lat, lon: c.lon, visitIds: ["v1"], ...extra });
const place = (id, name, c = DAON, extra = {}) => ({ id, name, lat: c.lat, lon: c.lon, address: "1 Main St", ...extra });
const near = { lat: DAON.lat + 0.0002, lon: DAON.lon + 0.0002 }; // ~30 m

describe("normalizeName — apostrophes, case and whitespace are not a different restaurant", () => {
  it.each([["DAO'N"], ["Dao’N"], ["  dao n "], ["daoʼn"], ["DAO‘N"]])("%j folds to daon", (n) => {
    expect(normalizeName(n)).toBe("daon");
  });
  it("folds accents and keeps real differences", () => {
    expect(normalizeName("Café Rouge")).toBe("caferouge");
    expect(normalizeName("Pho Saigon")).not.toBe(normalizeName("Pho Hanoi"));
  });
  it("null/undefined/empty are the empty name, never throw", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("sameSpot — name alone never merges, position alone never merges", () => {
  it("same normalised name within a storefront's reach", () => {
    expect(sameSpot({ name: "DAO'N", ...DAON }, { name: "Dao’N", ...near })).toBe(true);
  });
  it("a chain: same name, different suburb (km apart) is a DIFFERENT restaurant", () => {
    expect(sameSpot({ name: "Torchy's Tacos", ...DAON }, { name: "Torchy's Tacos", lat: DAON.lat + 0.05, lon: DAON.lon })).toBe(false);
  });
  it("different name at the same spot is a different restaurant", () => {
    expect(sameSpot({ name: "DAO'N", ...DAON }, { name: "Pho Saigon", ...DAON })).toBe(false);
  });
  it("missing coordinates never match (a name is not identity)", () => {
    expect(sameSpot({ name: "DAO'N", lat: null, lon: null }, { name: "DAO'N", ...DAON })).toBe(false);
  });
  it("the radius is a storefront, not a neighbourhood", () => {
    expect(NEAR_METERS).toBeLessThan(1000);
    expect(NEAR_METERS).toBeGreaterThanOrEqual(100);
  });
});

describe("findExisting", () => {
  const ctx = { manualPins: [pin("DAO'N")], ownPlaces: [place("p-cafe", "Sample Cafe", { lat: 29.8, lon: -95.3 })] };
  it("a snapshot copy of his manual pin resolves to the pin", () => {
    const hit = findExisting(place("p-daon", "Dao’N", near), ctx);
    expect(hit.kind).toBe("manualPin");
    expect(hit.pin.visitIds).toEqual(["v1"]);
  });
  it("his own logged place resolves to itself", () => {
    expect(findExisting(place("p-cafe", "Sample Cafe", { lat: 29.8, lon: -95.3 }), ctx).kind).toBe("place");
  });
  it("a second snapshot record for a place he has logged resolves to the logged one (different id)", () => {
    const hit = findExisting(place("p-cafe-2", "sample cafe", { lat: 29.8001, lon: -95.3001 }), ctx);
    expect(hit.kind).toBe("place");
    expect(hit.place.id).toBe("p-cafe");
  });
  it("a restaurant he never saved resolves to nothing", () => {
    expect(findExisting(place("p-far", "Pho Far Away", { lat: 29.9, lon: -95.5 }), ctx)).toBeNull();
  });
});

describe("mergeSearchResults — ONE row per restaurant he already has", () => {
  const base = { manualPins: [pin("DAO'N")], ownPlaces: [], loggedIds: new Set(), wishlistIds: new Set() };
  const snap = (rows) => rows.map((p) => ({ ...p, kind: "place", mine: false }));

  it("manual pin + matching snapshot hit = one row, his, with the snapshot's address", () => {
    const rows = mergeSearchResults({ ...base, query: "dao'n", snapshotRanked: snap([place("p-daon", "DAO'N", near)]) });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
    expect(rows[0].mine).toBe(true);
    expect(rows[0].address).toBe("1 Main St");
    expect(rows[0].visitIds).toEqual(["v1"]);
  });
  it("curly apostrophe / mixed case on either side still merges", () => {
    const rows = mergeSearchResults({ ...base, manualPins: [pin("Dao’N")], query: "DAO'N", snapshotRanked: snap([place("p-daon", "dao'n", near)]) });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
  });
  it("the typed text need not match HIS name: he typed 'korean', his pin is DAO'N, the snapshot row says Korean", () => {
    const rows = mergeSearchResults({ ...base, query: "korean", snapshotRanked: snap([place("p-daon", "DAO'N", near)]) });
    expect(rows).toHaveLength(0 + 1);
    expect(rows[0].kind).toBe("manual");
  });
  it("a snapshot place he has logged: the search copy IS his place (same id) — one row, 'Been here'", () => {
    const own = place("p-cafe", "Sample Cafe", { lat: 29.8, lon: -95.3 });
    const rows = mergeSearchResults({
      query: "sample", manualPins: [], ownPlaces: [own], loggedIds: new Set(["p-cafe"]), wishlistIds: new Set(),
      snapshotRanked: [{ ...own, kind: "place", mine: true }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("p-cafe");
    expect(rows[0].mine).toBe(true);
  });
  it("a DIFFERENT snapshot record of a place he has logged collapses onto the logged one", () => {
    const own = place("p-cafe", "Sample Cafe", { lat: 29.8, lon: -95.3 });
    const rows = mergeSearchResults({
      query: "sample", manualPins: [], ownPlaces: [own], loggedIds: new Set(["p-cafe"]), wishlistIds: new Set(),
      snapshotRanked: snap([place("p-cafe-dup", "SAMPLE CAFE", { lat: 29.8002, lon: -95.3002 })]),
    });
    expect(rows.map((r) => r.id)).toEqual(["p-cafe"]);
  });
  it("two manual pins for one storefront (spelling variants) read as ONE row opening both visits", () => {
    const rows = mergeSearchResults({
      ...base, manualPins: [pin("DAO'N", DAON, { visitIds: ["v1"] }), pin("Dao’N", near, { visitIds: ["v2"] })],
      query: "daon", snapshotRanked: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].visitIds.sort()).toEqual(["v1", "v2"]);
  });
  it("live (OSM) results fold the same way", () => {
    const rows = mergeSearchResults({ ...base, query: "dao'n", snapshotRanked: [], liveMatches: [{ id: "n123", name: "Dao'n", lat: near.lat, lon: near.lon }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
  });
  it("CONTROLS: a restaurant he never saved is listed once and untouched; a same-name branch far away stays separate", () => {
    const rows = mergeSearchResults({
      ...base, query: "dao",
      snapshotRanked: snap([place("p-far", "Pho Far Away", { lat: 29.9, lon: -95.5 }), place("p-daon-2", "DAO'N", { lat: 29.95, lon: -95.45 })]),
    });
    const names = rows.map((r) => `${r.kind}:${r.id || r.key}`);
    expect(rows).toHaveLength(3); // his pin + the unrelated place + the far same-name branch
    expect(names[0]).toMatch(/^manual:/);
    expect(rows.filter((r) => r.id === "p-daon-2")).toHaveLength(1);
  });
  it("his own rows rank first, and the cap holds", () => {
    const many = Array.from({ length: 20 }, (_, i) => place(`p${i}`, `Dao Place ${i}`, { lat: 29.6 + i * 0.01, lon: -95.2 }));
    const rows = mergeSearchResults({ ...base, query: "dao", snapshotRanked: snap(many), cap: 10 });
    expect(rows).toHaveLength(10);
    expect(rows[0].kind).toBe("manual");
  });
});

describe("resolveSaveTarget — a visit can never create a second record for a place he already has", () => {
  const ctx = { manualPins: [pin("DAO'N")], ownPlaces: [place("p-cafe", "Sample Cafe", { lat: 29.8, lon: -95.3 })] };
  it("picking the snapshot COPY of his manual pin redirects the save to the manual pin", () => {
    const { target, redirected } = resolveSaveTarget({ kind: "place", place: place("p-daon", "Dao’N", near) }, "", ctx);
    expect(redirected).toBe(true);
    expect(target.kind).toBe("manualPin");
    expect(target.pin.name).toBe("DAO'N");
  });
  it("dropping a NEW pin on top of an existing one (spelling/apostrophe/whitespace differ) joins the existing pin", () => {
    const { target, redirected } = resolveSaveTarget({ kind: "newPin", ...near }, "  dao’n ", ctx);
    expect(redirected).toBe(true);
    expect(target.kind).toBe("manualPin");
  });
  it("a new pin dropped on a place he has logged joins that place (place_id), not a manual duplicate of it", () => {
    const { target } = resolveSaveTarget({ kind: "newPin", lat: 29.8001, lon: -95.3001 }, "SAMPLE CAFE", ctx);
    expect(target.kind).toBe("place");
    expect(target.place.id).toBe("p-cafe");
  });
  it("the same place_id is never redirected (it already IS his record)", () => {
    const sel = { kind: "place", place: place("p-cafe", "Sample Cafe", { lat: 29.8, lon: -95.3 }) };
    const { target, redirected } = resolveSaveTarget(sel, "", ctx);
    expect(redirected).toBe(false);
    expect(target).toBe(sel);
  });
  it("CONTROLS: a restaurant he never saved, and a genuinely new pin, save as themselves", () => {
    const selPlace = { kind: "place", place: place("p-far", "Pho Far Away", { lat: 29.9, lon: -95.5 }) };
    expect(resolveSaveTarget(selPlace, "", ctx)).toEqual({ target: selPlace, redirected: false });
    const selPin = { kind: "newPin", lat: 29.7, lon: -95.1 };
    expect(resolveSaveTarget(selPin, "Brand New Truck", ctx)).toEqual({ target: selPin, redirected: false });
  });
  it("same name, far away (another branch of a chain) is NOT redirected", () => {
    const sel = { kind: "place", place: place("p-daon-2", "DAO'N", { lat: 29.95, lon: -95.45 }) };
    expect(resolveSaveTarget(sel, "", ctx).redirected).toBe(false);
  });
  it("null selection is a no-op", () => {
    expect(resolveSaveTarget(null, "", ctx)).toEqual({ target: null, redirected: false });
  });
});

describe("manual pin grouping uses the normalised name", () => {
  it("DAO'N and Dao’N at the same spot are ONE pin", () => {
    const v = (id, name) => ({ id, place_id: null, custom_name: name, custom_lat: DAON.lat, custom_lon: DAON.lon, rating: 8 });
    const pins = manualPinsFromVisits([v("a", "DAO'N"), v("b", "Dao’N "), v("c", "Other Truck")]);
    expect(pins).toHaveLength(2);
    expect(pins.find((p) => p.visitIds.length === 2)).toBeTruthy();
  });
});

describe("mapCamera.cameraOffsetPx — centre the pin in the part of the map that is still visible", () => {
  it("phone: the camera shifts DOWN by half the bottom sheet (never sideways)", () => {
    expect(cameraOffsetPx({ width: 393, height: 500, panelWidth: 340, sheetPx: 300, phone: true })).toEqual([0, 150]);
  });
  it("phone: a sheet taller than the map is clamped so the pin stays on screen", () => {
    const [, dy] = cameraOffsetPx({ width: 393, height: 500, panelWidth: 340, sheetPx: 900, phone: true });
    expect(dy).toBe(200);
  });
  it("phone with no sheet yet: no shift", () => {
    expect(cameraOffsetPx({ width: 393, height: 500, panelWidth: 340, sheetPx: 0, phone: true })).toEqual([0, 0]);
  });
  it("desktop is unchanged: half the right-hand panel, sideways", () => {
    expect(cameraOffsetPx({ width: 1200, height: 800, panelWidth: 340, sheetPx: 300, phone: false })).toEqual([170, 0]);
  });
  it("desktop: a narrow window clamps the panel shift to 80% of the width", () => {
    expect(cameraOffsetPx({ width: 400, height: 800, panelWidth: 340, sheetPx: 0, phone: false })).toEqual([160, 0]);
  });
});

describe("wiring — search and save both go through the ONE identity answer", () => {
  const app = src("FoodApp.jsx");
  const box = src("components/SearchBox.jsx");
  const map = src("components/FoodMap.jsx");

  it("SearchBox builds its rows with mergeSearchResults and is handed his own places", () => {
    expect(box).toMatch(/mergeSearchResults\(/);
    expect(box).not.toMatch(/\.\.\.manualMatches/);
    expect(app).toMatch(/ownPlaces=\{loggedPlaces\}/);
  });
  it("submitVisit AND toggleWishlist resolve the target through resolveSaveTarget before writing", () => {
    const submit = app.slice(app.indexOf("const submitVisit"), app.indexOf("const toggleWishlist"));
    const toggle = app.slice(app.indexOf("const toggleWishlist"), app.indexOf("const removeVisit"));
    expect(submit).toMatch(/resolveSaveTarget\(/);
    expect(submit).toMatch(/target\.kind === "place"/);
    expect(submit).toMatch(/if \(redirected\) setSelected\(target\)/);
    expect(toggle).toMatch(/resolveSaveTarget\(/);
  });
  it("FoodMap's fly-to takes the phone bottom sheet into account, and re-centres once the sheet has measured itself", () => {
    expect(map).toMatch(/cameraOffsetPx\(/);
    expect(map).toMatch(/flyInfoRef/);
    expect(map).toMatch(/SHEET_RECENTRE_WINDOW_MS/);
    expect(map).not.toMatch(/panelOffsetPx/);
  });
  it("on a phone the toolbar strip is one screen wide and the search field flexes (nothing left to scroll to)", () => {
    expect(app).toMatch(/data-testid="food-toolbar"/);
    expect(app).toMatch(/width: "calc\(100vw - 12px\)"/);
    expect(app).toMatch(/fill=\{phone\}/);
    expect(box).toMatch(/width: fill \? "100%" : 220/);
    expect(box).toMatch(/maxHeight: menuMaxH/);
  });
});
