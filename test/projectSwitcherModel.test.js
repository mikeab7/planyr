/* NEW-1 (switcher restyle) — the dropdown's pure model: the synchronous pinned read that removes the
 * first-frame reorder, the ONE last-opened field that both sorts and labels the rows, the short time
 * form, and the search highlight. See src/shared/projects/projectSwitcherModel.js. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readPinnedFromMirror, readOpenedMap, noteProjectOpened, lastOpenedAt, orderForSwitcher,
  relTimeShort, highlightParts, USER_PREFS_MIRROR_KEY, OPENED_KEY,
} from "../src/shared/projects/projectSwitcherModel.js";

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, _m: m };
};
const NOW = Date.parse("2026-09-29T12:00:00Z");
const H = 3600e3;
const P = (id, hoursAgo, extra = {}) => ({ id, name: id.toUpperCase(), updatedAt: NOW - hoursAgo * H, ...extra });

describe("pinned state is available SYNCHRONOUSLY (no first-frame reorder)", () => {
  const store = memStore({ [USER_PREFS_MIRROR_KEY]: JSON.stringify({ sitesPanel: { pinned: ["gp", "gc", 7, "8s"] } }) });

  it("reads the pinned ids straight out of the on-device mirror, dropping non-strings", () => {
    expect(readPinnedFromMirror(store)).toEqual(["gp", "gc", "8s"]);
  });

  it("⛔ the FIRST computed order already has the pinned projects in the pinned group", () => {
    // On the old code the pinned ids started as [] and arrived asynchronously, so this first
    // computation ran with no pins and produced plain recency order.
    const list = [P("a", 1), P("gp", 50), P("b", 2), P("gc", 60), P("8s", 70)];
    const first = orderForSwitcher(list, null, readPinnedFromMirror(store), {});
    expect(first.slice(0, 3).map((p) => p.id).sort()).toEqual(["8s", "gc", "gp"]);
    // …and it is the SETTLED order: recomputing with the same pins changes nothing.
    expect(orderForSwitcher(list, null, readPinnedFromMirror(store), {}).map((p) => p.id)).toEqual(first.map((p) => p.id));
  });

  it("is safe with no storage / garbage / no key", () => {
    expect(readPinnedFromMirror(memStore())).toEqual([]);
    expect(readPinnedFromMirror(memStore({ [USER_PREFS_MIRROR_KEY]: "{not json" }))).toEqual([]);
    expect(readPinnedFromMirror(memStore({ [USER_PREFS_MIRROR_KEY]: JSON.stringify({ sitesPanel: { pinned: "x" } }) }))).toEqual([]);
  });

  it("the component seeds its state from that read (source guard — the mount AND the open handler)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../src/shared/ui/ProjectBreadcrumb.jsx"), "utf8");
    expect(src).toMatch(/useState\(\(\) => readPinnedFromMirror\(\)\)/);
    expect(src).toMatch(/if \(!open\) \{ setPinnedIds\(readPinnedFromMirror\(\)\); setOpened\(readOpenedMap\(\)\); \}/);
  });
});

describe("both groups sort by last opened, newest first — and the time shown is that same field", () => {
  const opened = { a: NOW - 30 * 60e3, gp: NOW - 5 * H, b: NOW - 26 * H };
  const list = [P("b", 1), P("c", 30), P("a", 100), P("gp", 200), P("gc", 90), P("cur", 500)];

  it("current leads; pinned then recent; each group strictly newest-first by lastOpenedAt", () => {
    const out = orderForSwitcher(list, "cur", ["gc", "gp"], opened);
    expect(out.map((p) => p.id)).toEqual([
      "cur",            // current
      "gp", "gc",       // pinned: gp opened 5h ago, gc only edited 90h ago
      "a", "b", "c",    // recent: a opened 30m ago; b edited 1h ago (newer than its 26h-old open); c edited 30h ago
    ]);
    for (const grp of [out.slice(1, 3), out.slice(3)]) {
      const t = grp.map((p) => lastOpenedAt(p, opened));
      expect(t).toEqual([...t].sort((x, y) => y - x));
    }
  });

  it("⛔ the displayed time is derived from the SAME field as the sort key", () => {
    const out = orderForSwitcher(list, null, [], opened);
    const shown = out.map((p) => relTimeShort(lastOpenedAt(p, opened), NOW));
    // b: max(opened 26h, edited 1h) → 1h  (an edit counts as an interaction)
    expect(shown[out.findIndex((p) => p.id === "b")]).toBe("1h");
    expect(shown[out.findIndex((p) => p.id === "a")]).toBe("30m");
    // sort and label agree by construction: labels are never out of order
    const mins = out.map((p) => lastOpenedAt(p, opened));
    expect(mins).toEqual([...mins].sort((x, y) => y - x));
  });

  it("a project both current and pinned appears once, as current", () => {
    const out = orderForSwitcher(list, "gp", ["gp", "gc"], opened);
    expect(out.filter((p) => p.id === "gp")).toHaveLength(1);
    expect(out[0].id).toBe("gp");
  });

  it("a row with no timestamp at all sorts last and shows no time (never a fake one)", () => {
    const out = orderForSwitcher([{ id: "z", name: "Z" }, P("y", 5)], null, [], {});
    expect(out.map((p) => p.id)).toEqual(["y", "z"]);
    expect(relTimeShort(lastOpenedAt(out[1], {}), NOW)).toBe("");
  });
});

describe("noteProjectOpened", () => {
  it("records the open, persists it, and lastOpenedAt then prefers it over an older save", () => {
    const store = memStore();
    const map = noteProjectOpened("p1", NOW, store);
    expect(map).toEqual({ p1: NOW });
    expect(readOpenedMap(store)).toEqual({ p1: NOW });
    expect(lastOpenedAt({ id: "p1", updatedAt: NOW - 9 * H }, map)).toBe(NOW);
  });
  it("caps the map, keeping the most recent entries", () => {
    const store = memStore({ [OPENED_KEY]: JSON.stringify(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`o${i}`, i + 1]))) });
    const map = noteProjectOpened("new", NOW, store);
    expect(Object.keys(map)).toHaveLength(500);
    expect(map.new).toBe(NOW);
    expect(map.o0).toBeUndefined();
  });
  it("never throws when storage is unavailable", () => {
    const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
    expect(() => noteProjectOpened("p", NOW, broken)).not.toThrow();
  });
});

describe("relTimeShort", () => {
  const at = (ms) => relTimeShort(NOW - ms, NOW);
  it("uses the short forms the design asks for", () => {
    expect(at(10e3)).toBe("now");
    expect(at(12 * 60e3)).toBe("12m");
    expect(at(1 * H)).toBe("1h");
    expect(at(4 * H)).toBe("4h");
    expect(at(21 * H)).toBe("21h");
    expect(at(24 * H)).toBe("1d");
    expect(at(3 * 24 * H)).toBe("3d");
    expect(at(14 * 24 * H)).toBe("2w");
  });
  it("accepts an ISO string, and answers '' for nothing", () => {
    expect(relTimeShort("2026-09-29T08:00:00Z", NOW)).toBe("4h");
    expect(relTimeShort(0, NOW)).toBe("");
    expect(relTimeShort(undefined, NOW)).toBe("");
  });
});

describe("highlightParts", () => {
  it("splits around every case-insensitive hit and rejoins to the original text", () => {
    const parts = highlightParts("Goose Creek — Creekside", "creek");
    expect(parts.filter((x) => x.hit).map((x) => x.text)).toEqual(["Creek", "Creek"]);
    expect(parts.map((x) => x.text).join("")).toBe("Goose Creek — Creekside");
  });
  it("no query, or no hit, is one plain segment", () => {
    expect(highlightParts("Alpha", "")).toEqual([{ text: "Alpha", hit: false }]);
    expect(highlightParts("Alpha", "zzz")).toEqual([{ text: "Alpha", hit: false }]);
  });
});

// NEW-2 (company workspace card) — pure rules for the card above the projects card.
import { companyCards, companyCardsFor, COMPANY_SUBTITLE } from "../src/shared/projects/projectSwitcherModel.js";
describe("company cards", () => {
  it("one card: the organization's own name on line one, 'Company workspace' on line two", () => {
    expect(companyCards("Acme Industrial")).toEqual([{ id: "org:Acme Industrial", name: "Acme Industrial", subtitle: "Company workspace" }]);
    expect(COMPANY_SUBTITLE).toBe("Company workspace");
  });
  it("one card per organization when the account has several", () => {
    expect(companyCards(["Acme", "Beta LLC"]).map((c) => c.name)).toEqual(["Acme", "Beta LLC"]);
  });
  it("an unset name falls back to the word Organization, never a stale or invented name", () => {
    expect(companyCards("")[0].name).toBe("Organization");
    expect(companyCards(null)[0].name).toBe("Organization");
    expect(companyCards("  ")[0].name).toBe("Organization");
  });
  it("hidden while the search has text unless the name matches", () => {
    expect(companyCardsFor("Acme Industrial", "")).toHaveLength(1);
    expect(companyCardsFor("Acme Industrial", "acme")).toHaveLength(1);
    expect(companyCardsFor("Acme Industrial", "goose creek")).toHaveLength(0);
  });
});
