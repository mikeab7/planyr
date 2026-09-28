import { describe, it, expect } from "vitest";
import { buildSinceLastHereFeed, KIND_META, compAddedSubline } from "../src/workspaces/dashboard/lib/sinceLastHereFeed.js";
import { compHeadlineRate, formatRateValue, DEFAULT_LEASE_PERIOD } from "../src/workspaces/dashboard/lib/compsCardModel.js";

const DAY = 86400000;
const NOW = new Date(2026, 8, 8, 12, 0, 0).getTime(); // Sep 8, noon
const TWO_DAYS_AGO = NOW - 2 * DAY;

function baseArgs(overrides = {}) {
  return {
    now: NOW,
    lastVisitAt: TWO_DAYS_AGO,
    sites: [],
    buildingCountBySite: {},
    sqftBySite: {},
    scheduleProjects: null,
    comps: [],
    notePages: [],
    prevSnapshot: { plans: {}, tasks: {} },
    ...overrides,
  };
}

describe("buildSinceLastHereFeed — empty state", () => {
  it("returns no rows when nothing changed", () => {
    const feed = buildSinceLastHereFeed(baseArgs());
    expect(feed.rows).toEqual([]);
    expect(feed.overflowCount).toBe(0);
  });
});

describe("buildSinceLastHereFeed — plans", () => {
  it("reports a plan created in the window, with building substance when available", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Grand Port South", county: "Waller", status: "pursuit", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites, buildingCountBySite: { s1: 14 }, sqftBySite: { s1: 412000 } }));
    expect(feed.rows).toHaveLength(1);
    const row = feed.rows[0];
    expect(row.kind).toBe("plan-created");
    expect(row.parts.some((p) => p.bold && p.text === "Grand Port South")).toBe(true);
    expect(row.subline).toBe("14 buildings · 412,000 SF");
    expect(row.open).toEqual({ kind: "project", groupId: "g1" });
  });

  it("falls back to county/status when no building data is available for a new plan", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Tracked Lot", county: "Harris", status: "pursuit", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].subline).toBe("Harris County · Pursuit");
  });

  // B1407824 — `site.county` is a lower-case ROUTING KEY ("bowie", "harris", "fort_bend"), not a
  // display string; the subline used to print it verbatim ("bowie County"). Two adjacent cases:
  // the routing key needs capitalizing, and one that already arrives correctly capitalized (a
  // legacy row, or the map-marker path — see shared/CLAUDE.md's County ROUTING KEYS note) must
  // read exactly the same either way.
  it("title-cases a lower-case county routing key (single- and multi-word)", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Alumax Rd", county: "bowie", status: "pursuit", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows[0].subline).toBe("Bowie County · Pursuit");

    const multiWord = [{ id: "s2", group_id: "g2", site: "Katy Tract", county: "fort_bend", status: "active", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed2 = buildSinceLastHereFeed(baseArgs({ sites: multiWord }));
    expect(feed2.rows[0].subline).toBe("Fort Bend County · Active");
  });

  it("a county name that already arrives correctly capitalized reads identically", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Alumax Rd", county: "Harris", status: "pursuit", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows[0].subline).toBe("Harris County · Pursuit");
  });

  // B1407824 — the exact reported production case: the stored plan name FITS under the feed
  // row's own limit (nothing to cut for space), but itself dangles on a bare trailing comma.
  it("cleans a short plan name that itself dangles on a comma, even though nothing needed cutting for space", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "ALUMAX RD, NASH,", county: "bowie", status: "pursuit", created_at: new Date(NOW - DAY).toISOString(), updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows[0].parts.map((p) => p.text).join("")).toBe("New plan ALUMAX RD, NASH");
  });

  it("never reports a plan backfilled to the 1970 sentinel as 'created'", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Old Plan", county: "Harris", status: "pursuit", created_at: "1970-01-01T00:00:00.000Z", updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows.filter((r) => r.kind === "plan-created")).toHaveLength(0);
  });

  it("reports a rename via siteRenamedAt, and does not also report it as created", () => {
    const sites = [{
      id: "s1", group_id: "g1", site: "Silvestri", county: "Fort Bend", status: "active",
      created_at: "1970-01-01T00:00:00.000Z", updated_at: new Date(NOW - DAY).toISOString(),
      siteRenamedAt: String(NOW - DAY),
    }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].kind).toBe("plan-renamed");
    expect(feed.rows[0].parts.some((p) => p.bold && p.text === "Silvestri")).toBe(true);
  });

  it("a plan created AND renamed in the same window only reports 'created' once", () => {
    const createdMs = NOW - DAY;
    const sites = [{
      id: "s1", group_id: "g1", site: "Brand New", county: "Waller", status: "pursuit",
      created_at: new Date(createdMs).toISOString(), updated_at: new Date(createdMs).toISOString(),
      siteRenamedAt: String(createdMs + 1000),
    }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites }));
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].kind).toBe("plan-created");
  });

  it("reports a meaningful edit only against a KNOWN prior baseline, never on first sight", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "8 South", county: "Harris", status: "active", created_at: "1970-01-01T00:00:00.000Z", updated_at: new Date(NOW - DAY).toISOString() }];
    const noBaseline = buildSinceLastHereFeed(baseArgs({ sites, buildingCountBySite: { s1: 6 }, sqftBySite: { s1: 90000 } }));
    expect(noBaseline.rows).toHaveLength(0); // first sight — establishes the baseline only
    expect(noBaseline.nextSnapshot.plans.s1).toEqual({ name: "8 South", buildingCount: 6, sqft: 90000 });

    const withBaseline = buildSinceLastHereFeed(baseArgs({
      sites, buildingCountBySite: { s1: 8 }, sqftBySite: { s1: 120000 },
      prevSnapshot: { plans: { s1: { name: "8 South", buildingCount: 6, sqft: 90000 } }, tasks: {} },
    }));
    expect(withBaseline.rows).toHaveLength(1);
    expect(withBaseline.rows[0].kind).toBe("plan-edited");
    expect(withBaseline.rows[0].subline).toBe("8 buildings · 120,000 SF");
  });

  it("does not fire an edit for a sub-noise sqft change with the same building count", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "8 South", county: "Harris", status: "active", created_at: "1970-01-01T00:00:00.000Z", updated_at: new Date(NOW - DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({
      sites, buildingCountBySite: { s1: 6 }, sqftBySite: { s1: 90003 },
      prevSnapshot: { plans: { s1: { name: "8 South", buildingCount: 6, sqft: 90000 } }, tasks: {} },
    }));
    expect(feed.rows).toHaveLength(0);
  });
});

describe("buildSinceLastHereFeed — schedule", () => {
  // B1939344 — `linkedSiteName` set, so the subline's project half is the qualified
  // "<Project> / <Schedule>" label (crossScheduleLabel), not the bare schedule name.
  const scheduleProjects = {
    p1: {
      id: "p1", name: "Goose Creek", linkedSiteId: "s9", linkedSiteName: "Goose Creek",
      tasks: [{ id: "t1", name: "Grading permit", end: "2026-10-05", health: "yellow", parentId: null }],
    },
  };

  it("reports a milestone that slipped, naming the project and the day count", () => {
    const feed = buildSinceLastHereFeed(baseArgs({
      scheduleProjects,
      prevSnapshot: { plans: {}, tasks: { p1: { t1: { end: "2026-10-01", health: "yellow", name: "Grading permit" } } } },
    }));
    expect(feed.rows).toHaveLength(1);
    const row = feed.rows[0];
    expect(row.kind).toBe("schedule-slip");
    expect(row.parts.some((p) => p.bold && p.text === "Grading permit")).toBe(true);
    expect(row.subline).toBe("Goose Creek / Goose Creek · +4d");
    // ⛔ WAS `expect(row.ts).toBe(TWO_DAYS_AGO)` — this line PINNED the defect the 2026-09-08
    // adversarial review found. Stamping at the window FLOOR sorts a schedule row below every
    // real-stamped event in the window, so the cap deleted 100% of them (3 of 3 measured on a
    // one-month absence). A snapshot-diffed change has no exact time; it carries the tightest
    // MEASURED upper bound instead, marked approximate, with its real interval alongside.
    expect(row.tsApprox).toBe(true);
    expect(row.tsEarliest).toBe(TWO_DAYS_AGO);
    expect(row.ts).toBeGreaterThan(TWO_DAYS_AGO);
    expect(row.ts).toBeLessThanOrEqual(NOW);
  });

  it("reports a milestone pulled in earlier as a negative slip", () => {
    const feed = buildSinceLastHereFeed(baseArgs({
      scheduleProjects,
      prevSnapshot: { plans: {}, tasks: { p1: { t1: { end: "2026-10-10", health: "yellow", name: "Grading permit" } } } },
    }));
    expect(feed.rows[0].subline).toBe("Goose Creek / Goose Creek · -5d");
    expect(feed.rows[0].parts.some((p) => p.text.includes("moved up"))).toBe(true);
  });

  // B1939344 (NEW-1) — the RED-PROOF for this feed: two schedules named identically under
  // different projects must produce distinct sublines. On unmodified main both read
  // "Master Schedule · <n>d" — indistinguishable.
  it("RED-PROOF (fails on unmodified main): two same-named schedules under different projects slip into distinct sublines", () => {
    const sameNamed = {
      p1: {
        id: "p1", name: "Master Schedule", linkedSiteId: "s1", linkedSiteName: "Goose Creek",
        tasks: [{ id: "t1", name: "Grading permit", end: "2026-10-05", health: "yellow", parentId: null }],
      },
      p2: {
        id: "p2", name: "Master Schedule", linkedSiteId: "s2", linkedSiteName: "Grand Port",
        tasks: [{ id: "t2", name: "Foundation start", end: "2026-11-01", health: "yellow", parentId: null }],
      },
    };
    const feed = buildSinceLastHereFeed(baseArgs({
      scheduleProjects: sameNamed,
      prevSnapshot: {
        plans: {},
        tasks: {
          p1: { t1: { end: "2026-10-01", health: "yellow", name: "Grading permit" } },
          p2: { t2: { end: "2026-10-25", health: "yellow", name: "Foundation start" } },
        },
      },
    }));
    const byTask = Object.fromEntries(feed.rows.map((r) => [r.parts.find((p) => p.bold)?.text, r.subline]));
    expect(byTask["Grading permit"]).toBe("Goose Creek / Master Schedule · +4d");
    expect(byTask["Foundation start"]).toBe("Grand Port / Master Schedule · +7d");
    expect(byTask["Grading permit"]).not.toBe(byTask["Foundation start"]);
  });

  // ── FEED-2, B1405456 (2026-09-08 adversarial review) ──────────────────────────────────────
  // A task's raw `.health` field is a user-set status label (the HealthPicker color), not a
  // recorded completion event, and it carries no real timestamp. The feed used to announce a
  // "batch of tasks closed" purely off that field flipping to "green" — which can happen for
  // reasons that have nothing to do with the work actually finishing (see sinceLastHereFeed.js's
  // header). Per the review's own stated remedy — derive from real completions with real
  // timestamps, or drop the row rather than infer one — that kind is now GONE entirely.
  it("FEED-2: never reports a health-field flip as a 'tasks completed' event, however many tasks flip at once", () => {
    const manyTasks = {
      p1: {
        id: "p1", name: "Goose Creek", linkedSiteId: "s9",
        tasks: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `t${n}`, name: `Task ${n}`, end: "2026-10-05", health: "green", parentId: null })),
      },
    };
    const prevTasks = {};
    for (let n = 1; n <= 6; n++) prevTasks[`t${n}`] = { end: "2026-10-05", health: "yellow", name: `Task ${n}` };
    const feed = buildSinceLastHereFeed(baseArgs({
      scheduleProjects: manyTasks,
      prevSnapshot: { plans: {}, tasks: { p1: prevTasks } },
    }));
    // On unfixed trunk this fixture produced exactly one "tasks-completed" row — health alone
    // changing (no date moved) must now surface nothing at all.
    expect(feed.rows.some((r) => r.kind === "tasks-completed")).toBe(false);
    expect(feed.rows).toHaveLength(0);
  });

  it("FEED-2: KIND_META no longer carries the removed kind", () => {
    expect(KIND_META["tasks-completed"]).toBeUndefined();
  });

  it("does not report a task with no prior snapshot as slipped", () => {
    const feed = buildSinceLastHereFeed(baseArgs({ scheduleProjects, prevSnapshot: { plans: {}, tasks: {} } }));
    expect(feed.rows).toHaveLength(0);
  });

  it("excludes a parent/summary row from slip detection — only the leaf's own date move surfaces", () => {
    const withParent = {
      p1: {
        id: "p1", name: "Goose Creek", linkedSiteId: "s9",
        tasks: [
          { id: "parent", name: "Phase 1", end: "2026-10-20", health: "yellow", parentId: null },
          { id: "t1", name: "Grading permit", end: "2026-10-09", health: "yellow", parentId: "parent" },
        ],
      },
    };
    const feed = buildSinceLastHereFeed(baseArgs({
      scheduleProjects: withParent,
      prevSnapshot: { plans: {}, tasks: { p1: { parent: { end: "2026-10-01", name: "Phase 1" }, t1: { end: "2026-10-05", name: "Grading permit" } } } },
    }));
    // parent's own end moved too, but only the leaf's slip should surface
    expect(feed.rows.map((r) => r.kind)).toEqual(["schedule-slip"]);
    expect(feed.rows[0].parts.some((p) => p.bold && p.text === "Grading permit")).toBe(true);
  });
});

describe("buildSinceLastHereFeed — comps", () => {
  it("reports a comp with its rate and size", () => {
    const comps = [{
      id: "c1", title: "FM 1463 Land", compType: "lease", leaseSizeSf: 18200,
      leaseRate: 8.5, leaseRatePeriod: "annual", leaseRateExpense: "nnn",
      createdAt: new Date(NOW - DAY).toISOString(), projectId: "s1",
    }];
    const feed = buildSinceLastHereFeed(baseArgs({ comps }));
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].kind).toBe("comp-added");
    expect(feed.rows[0].parts.some((p) => p.bold && p.text === "FM 1463 Land")).toBe(true);
    // Two decimals, matching the Comps card's own `formatRateValue` — was "$8.5/SF/yr NNN" (raw,
    // unpadded interpolation of the stored value) before FEED-3's fix.
    expect(feed.rows[0].subline).toBe("$8.50/SF/yr NNN · 18,200 SF");
  });

  // ── FEED-3, B1405457 (2026-09-08 adversarial review) ──────────────────────────────────────
  // The feed used to render a lease comp's rate in its OWN entered period; the Comps card always
  // normalizes to Michael's chosen display period. Same comp, two different figures, on the same
  // screen. Both must now read through the same `compHeadlineRate`/`formatRateValue` — proved here
  // by computing the "expected" figure independently, off the exact functions the Comps card
  // calls, rather than a second hand-typed string that could itself drift.
  it("FEED-3: a monthly-quoted lease comp reads the SAME figure the Comps card would show, not its own raw entered period", () => {
    const comp = {
      id: "c1", title: "Monthly NNN lease", compType: "lease", leaseSizeSf: 10000,
      leaseRate: 0.65, leaseRatePeriod: "monthly", leaseRateExpense: "nnn",
      createdAt: new Date(NOW - DAY).toISOString(), projectId: "s1",
    };
    const feed = buildSinceLastHereFeed(baseArgs({ comps: [comp] }));
    const cardRate = compHeadlineRate(comp, DEFAULT_LEASE_PERIOD); // what the Comps card shows by default (annual)
    const expectedRateText = `${formatRateValue(cardRate.value)}${cardRate.unit.replace(/^\$/, "")} ${cardRate.basis.toUpperCase()}`;
    expect(feed.rows[0].subline).toContain(expectedRateText);
    expect(expectedRateText).toBe("$7.80/SF/yr NNN"); // 0.65 * 12, spelled out so the assertion above can't drift silently
    // On unfixed trunk the feed printed the comp's own native period instead — must never reappear.
    expect(feed.rows[0].subline).not.toContain("$0.65/SF/mo");
  });

  it("FEED-3: compAddedSubline follows whichever compsRatePeriod it is given, exported for the card to recompute live", () => {
    const comp = {
      id: "c1", title: "Monthly NNN lease", compType: "lease", leaseSizeSf: 10000,
      leaseRate: 0.65, leaseRatePeriod: "monthly", leaseRateExpense: "nnn",
    };
    expect(compAddedSubline(comp, "annual")).toBe("$7.80/SF/yr NNN · 10,000 SF");
    expect(compAddedSubline(comp, "monthly")).toBe("$0.65/SF/mo NNN · 10,000 SF");
  });
});

describe("buildSinceLastHereFeed — notes", () => {
  it("quotes a note's opening words", () => {
    const notePages = [{ id: "n1", title: "Entitlements Q&A", createdAt: NOW - DAY, opening: "Called the county today about…", projectId: "g1", orgScope: false }];
    const feed = buildSinceLastHereFeed(baseArgs({ notePages }));
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].kind).toBe("note-written");
    expect(feed.rows[0].subline).toContain("Called the county today about");
  });

  it("drops a blank page rather than showing an empty quote", () => {
    const notePages = [{ id: "n1", title: "Untitled page", createdAt: NOW - DAY, opening: "", projectId: null, orgScope: false }];
    const feed = buildSinceLastHereFeed(baseArgs({ notePages }));
    expect(feed.rows).toHaveLength(0);
  });
});

describe("buildSinceLastHereFeed — own-action debounce", () => {
  it("excludes anything from the last 30 seconds, even a real event", () => {
    const comps = [{ id: "c1", title: "Just added", compType: "land", landSizeValue: 5, landSizeUnit: "ac", createdAt: new Date(NOW - 10000).toISOString(), projectId: "s1" }];
    const feed = buildSinceLastHereFeed(baseArgs({ comps }));
    expect(feed.rows).toHaveLength(0);
  });
  it("keeps an event from 31+ seconds ago", () => {
    const comps = [{ id: "c1", title: "Just added", compType: "land", landSizeValue: 5, landSizeUnit: "ac", createdAt: new Date(NOW - 31000).toISOString(), projectId: "s1" }];
    const feed = buildSinceLastHereFeed(baseArgs({ comps }));
    expect(feed.rows).toHaveLength(1);
  });
});

describe("buildSinceLastHereFeed — capping and ordering", () => {
  it("caps the row count and reports how many more there were, newest first", () => {
    const comps = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`, title: `Comp ${i}`, compType: "land", landSizeValue: 5, landSizeUnit: "ac",
      createdAt: new Date(NOW - (i + 1) * 3600000).toISOString(), projectId: "s1",
    }));
    const feed = buildSinceLastHereFeed(baseArgs({ comps }));
    expect(feed.rows).toHaveLength(12);
    expect(feed.overflowCount).toBe(8);
    expect(feed.totalCount).toBe(20);
    // newest (smallest offset) first
    expect(feed.rows[0].id).toBe("comp-added:c0");
    for (let i = 1; i < feed.rows.length; i++) expect(feed.rows[i - 1].ts).toBeGreaterThanOrEqual(feed.rows[i].ts);
  });
});

describe("buildSinceLastHereFeed — first-ever visit", () => {
  it("falls back to a 24h window when there is no prior mark, rather than flooding the feed", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "Two days old", county: "Harris", status: "pursuit", created_at: new Date(NOW - 2 * DAY).toISOString(), updated_at: new Date(NOW - 2 * DAY).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites, lastVisitAt: null }));
    expect(feed.rows).toHaveLength(0); // outside the 24h fallback window
  });

  it("still reports something genuinely inside the 24h fallback window", () => {
    const sites = [{ id: "s1", group_id: "g1", site: "New today", county: "Harris", status: "pursuit", created_at: new Date(NOW - 3600000).toISOString(), updated_at: new Date(NOW - 3600000).toISOString() }];
    const feed = buildSinceLastHereFeed(baseArgs({ sites, lastVisitAt: null }));
    expect(feed.rows).toHaveLength(1);
  });
});

describe("KIND_META", () => {
  it("has a glyph and an accent for every kind this module ever emits", () => {
    const kinds = ["plan-created", "plan-renamed", "plan-edited", "schedule-slip", "comp-added", "note-written"];
    for (const k of kinds) {
      expect(KIND_META[k]).toBeTruthy();
      expect(typeof KIND_META[k].glyph).toBe("string");
      expect(typeof KIND_META[k].accent).toBe("string");
    }
  });
});


/* ── The "Since you were last here" feed defect, 2026-09-08 adversarial review ────────────────
 * Reproduction: ui-audit/review-2026-09-08/probe-feed-month-away.mjs, as originally run (17 events
 * derived, 12 shown, all 3 schedule events in the hidden 5 — back when a task-health flip still
 * counted as a third schedule event kind; FEED-2 removed that kind afterward, so a fresh run now
 * derives 16 and shows 2 schedule events, not 3 — the CAP fix below is unaffected either way).
 * These are the CI guards for the cap/timing fix.
 */
describe("buildSinceLastHereFeed — schedule events survive a long absence (B1373536)", () => {
  const MONTH_AGO = NOW - 30 * DAY;

  /** The probe's scene, as a fixture: a month away, enough plan/comp activity to overflow the
   * 12-row cap on its own, plus two slipped milestones. (Task 3's health-only flip to "green" is
   * left in the fixture as a harmless no-op — FEED-2 means it no longer produces a row at all.) */
  function monthAwayArgs(extra = {}) {
    const sites = Array.from({ length: 10 }, (_, i) => ({
      id: "s" + i, group_id: "g" + i, site: "Plan " + i, county: "harris", status: "pursuit",
      created_at: new Date(MONTH_AGO + (i + 1) * 2 * DAY).toISOString(),
      updated_at: new Date(MONTH_AGO + (i + 1) * 2 * DAY).toISOString(),
    }));
    const comps = Array.from({ length: 4 }, (_, i) => ({
      id: "c" + i, compType: "lease", title: "Comp " + i, leaseRate: 0.65,
      leaseRatePeriod: "monthly", leaseRateExpense: "nnn", leaseSizeSf: 600000,
      createdAt: new Date(MONTH_AGO + (i + 1) * 5 * DAY).toISOString(),
    }));
    return baseArgs({
      lastVisitAt: MONTH_AGO,
      sites,
      comps,
      buildingCountBySite: {},
      sqftBySite: {},
      scheduleProjects: {
        p1: {
          id: "p1", name: "Bain Industrial", linkedSiteId: "s1",
          tasks: [
            { id: 1, name: "Site civil permit", end: "2026-10-01", health: "amber" },
            { id: 2, name: "Foundation start", end: "2026-11-15", health: "amber" },
            { id: 3, name: "TCO", end: "2027-02-01", health: "green" },
          ],
        },
      },
      prevSnapshot: {
        plans: {},
        tasks: {
          p1: {
            1: { end: "2026-09-10", health: "amber", name: "Site civil permit" },
            2: { end: "2026-10-20", health: "amber", name: "Foundation start" },
            3: { end: "2027-02-01", health: "amber", name: "TCO" },
          },
        },
      },
      ...extra,
    });
  }

  it("derives more events than it can show — the precondition the defect needed", () => {
    const feed = buildSinceLastHereFeed(monthAwayArgs());
    expect(feed.totalCount).toBeGreaterThan(feed.rows.length);
    expect(feed.overflowCount).toBeGreaterThan(0);
  });

  it("EVERY schedule event survives the cap (was 0 of 2)", () => {
    const feed = buildSinceLastHereFeed(monthAwayArgs());
    const scheduleRows = feed.rows.filter((r) => r.kind === "schedule-slip");
    expect(scheduleRows).toHaveLength(2);
  });

  it("the cap can never delete a whole event kind", () => {
    const feed = buildSinceLastHereFeed(monthAwayArgs());
    const derivedKinds = new Set(["plan-created", "comp-added", "schedule-slip"]);
    const shownKinds = new Set(feed.rows.map((r) => r.kind));
    for (const k of derivedKinds) expect(shownKinds.has(k)).toBe(true);
  });

  it("still reads newest-first, and still respects the cap", () => {
    const feed = buildSinceLastHereFeed(monthAwayArgs());
    expect(feed.rows.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < feed.rows.length; i++) {
      expect(feed.rows[i - 1].ts).toBeGreaterThanOrEqual(feed.rows[i].ts);
    }
  });

  it("uses the measured last schedule WRITE as the stamp when one is available", () => {
    const writeAt = NOW - 3 * DAY;
    const feed = buildSinceLastHereFeed(monthAwayArgs({ scheduleLastWriteAt: writeAt }));
    const row = feed.rows.find((r) => r.kind === "schedule-slip");
    expect(row.ts).toBe(writeAt);
    expect(row.tsLatest).toBe(writeAt);
    expect(row.tsEarliest).toBe(MONTH_AGO);
    expect(row.tsApprox).toBe(true);
  });

  it("a write time from BEFORE the last visit cannot drag the stamp back below the window", () => {
    // A stale/pruned history ring: the newest recorded write predates the visit it is being
    // compared against, so it cannot be the moment of a change detected against that visit.
    const feed = buildSinceLastHereFeed(monthAwayArgs({ scheduleLastWriteAt: MONTH_AGO - 5 * DAY }));
    const row = feed.rows.find((r) => r.kind === "schedule-slip");
    expect(row.ts).toBeGreaterThanOrEqual(MONTH_AGO);
  });

  it("an approximate row never suppresses ITSELF against the own-action debounce", () => {
    // The debounce hides what the account did in the last 30 seconds. That is a claim about a
    // KNOWN time; an approximate row has none, so it must never be silently dropped by it.
    const feed = buildSinceLastHereFeed(monthAwayArgs({ scheduleLastWriteAt: NOW - 1000 }));
    expect(feed.rows.some((r) => r.kind === "schedule-slip")).toBe(true);
  });

  it("no event kind other than schedule-slip is stamped approximately", () => {
    const feed = buildSinceLastHereFeed(monthAwayArgs());
    for (const r of feed.rows) {
      if (r.kind === "schedule-slip") continue;
      expect(r.tsApprox).toBeUndefined();
    }
  });
});
