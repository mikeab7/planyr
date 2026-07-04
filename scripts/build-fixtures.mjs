#!/usr/bin/env node
/*
 * build-fixtures.mjs — deterministic generator for the versioned e2e/vitest FIXTURE SET (B278/B280
 * amendment). Produces synthetic stand-ins for the recurring LIVE-VERIFY repro cases — a DENSE Gantt
 * project (Pappadoupolos-scale, exercised at ~33% zoom in the browser spec), a detention/pond
 * regression with known geometry → known volume, a DENSE Site Planner test-fit, and a two-writer
 * concurrency race — plus a committed `*.golden.json` per fixture holding the numbers the real engines
 * compute from it. NO real client data: everything is synthetic, seeded, and scrubbed to `E2E …`.
 *
 * HOUSE RULES: dependency-free (Node + the repo's own ESM engines). Fully DETERMINISTIC — a fixed PRNG
 * seed and fixed dates (no Math.random / no `new Date()` in generated content), so `--check` can
 * regenerate and byte-compare. The golden is ENGINE-computed (not hand-derived), so a fixture that
 * silently changes behaviour under an engine/schema bump fails the drift check until fixture+golden are
 * regenerated in the same commit — the same guardrail the scheduler mirror already enforces.
 *
 *   node scripts/build-fixtures.mjs            → (re)write every fixture + golden
 *   node scripts/build-fixtures.mjs --check    → regenerate in memory, fail (exit 1) on any drift
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { pondContours, pondStorageVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { createSiteModel, mergeSiteContent, contentCount, SITE_MODEL_VERSION } from "../src/workspaces/site-planner/lib/siteModel.js";
import { interpretCas, interpretInsert, isMissingVersionColumn } from "../src/shared/cloud/optimisticUpsert.js";
import * as E from "../ui-audit/stress/scheduler-engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const FIX = join(REPO, "e2e", "fixtures");
const FIXTURE_VERSION = 1;

// Deterministic PRNG (mulberry32) — no Math.random, so regeneration is byte-stable.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const rint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// ---------------------------------------------------------------------------------------------
// 1. Detention / pond regression — deterministic geometry → deterministic volume.
// ---------------------------------------------------------------------------------------------
function ring(W, H) { return [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]; }
function pondFixture() {
  return {
    fixtureVersion: FIXTURE_VERSION,
    generator: "scripts/build-fixtures.mjs",
    engine: "pondGeom.js",
    note: "Synthetic detention-basin regression (no real project). Known geometry → engine-captured volume.",
    cases: [
      { name: "feasible-400x300-d8-s3", W: 400, H: 300, det: { depth: 8, freeboard: 1, slope: 3, contourInterval: 1, tobElev: 96 } },
      { name: "infeasible-200x40-d8-s4", W: 200, H: 40, det: { depth: 8, freeboard: 1, slope: 4, contourInterval: 1 } },
      { name: "interval-zero-clamp-400x400", W: 400, H: 400, det: { depth: 8, freeboard: 2, slope: 2, contourInterval: 0 } },
    ],
  };
}
function pondGolden(fx) {
  return {
    fixtureVersion: fx.fixtureVersion,
    cases: fx.cases.map((c) => {
      const r = pondContours(ring(c.W, c.H), c.det);
      return {
        name: c.name,
        feasible: r.feasible,
        maxDepth: round(r.maxDepth, 4),
        levelCount: r.levels.length,
        hasBottom: r.levels.some((l) => l.isBottom),
        hasWater: r.levels.some((l) => l.isWater),
        areas: r.levels.map((l) => round(l.area, 2)),
        storageVolumeCuFt: round(pondStorageVolume(r.levels), 2),
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Dense Gantt project — ~120 tasks under 8 phases, ~150 deps, edge rows. Seeded.
// ---------------------------------------------------------------------------------------------
const PHASES = ["Entitlements", "Civil Design", "Utilities", "Grading", "Building Shell", "Sitework / Paving", "MEP", "Closeout"];
function ganttFixture() {
  const r = rng(0x51ce);
  const tasks = [];
  let id = 0;
  const nextId = () => ++id;
  const start0 = "2026-01-05"; // a Monday; fixed, no new Date()
  const phaseIds = [];
  let cursor = start0;
  for (let p = 0; p < PHASES.length; p++) {
    const parentId = nextId();
    phaseIds.push(parentId);
    tasks.push({ id: parentId, name: `E2E ${PHASES[p]}`, parentId: null, start: "", end: "", duration: 0, predecessors: [] });
    const leafCount = rint(r, 12, 16);
    let prevLeaf = null;
    let phaseStart = cursor;
    for (let i = 0; i < leafCount; i++) {
      const lid = nextId();
      const dur = rint(r, 2, 10);
      const preds = [];
      if (prevLeaf != null && r() < 0.75) preds.push({ id: prevLeaf, type: pick(r, ["FS", "FS", "SS", "FF"]), lag: rint(r, -1, 2) });
      if (p > 0 && r() < 0.25) preds.push({ id: phaseIds[p - 1], type: "FS", lag: 0 }); // cross-phase fan-in
      const t = { id: lid, name: `E2E ${PHASES[p]} · task ${i + 1}`, parentId, start: preds.length ? "" : phaseStart, duration: dur, predecessors: preds };
      if (i === Math.floor(leafCount / 2) && p % 3 === 0) t.duration = 0; // a milestone
      tasks.push(t);
      prevLeaf = lid;
    }
    cursor = E.addBD(phaseStart, 30);
  }
  // deliberate edge rows for the known repro classes
  const unsched = nextId();
  tasks.push({ id: unsched, name: "E2E Unscheduled (blank start)", parentId: phaseIds[0], start: "", end: "", duration: 3, predecessors: [] });
  const back = nextId();
  tasks.push({ id: back, name: "E2E Backward link", parentId: phaseIds[1], start: "2026-01-06", duration: 2, predecessors: [{ id: back - 40 > 0 ? back - 40 : phaseIds[1] + 1, type: "SF", lag: 0 }] });

  return {
    fixtureVersion: FIXTURE_VERSION,
    generator: "scripts/build-fixtures.mjs",
    engine: "ui-audit/stress/scheduler-engine.mjs (mirror of public/sequence/index.html)",
    note: "Synthetic dense schedule (no real project). Load into public/sequence/index.html via loadPipeline for the ~33% zoom browser spec.",
    project: { id: "e2e-fixture-schedule", name: "E2E Dense Program", tasks },
    settings: { workingWeek: [1, 2, 3, 4, 5], barLabels: true },
  };
}
function ganttGolden(fx) {
  const tasks = fx.project.tasks;
  const recomputed = E.rollupParentDates(E.cascadeDates(tasks));
  const byId = new Map(recomputed.map((t) => [t.id, t]));
  const phaseRollup = tasks.filter((t) => t.parentId == null).map((p) => {
    const t = byId.get(p.id) || {};
    return { id: p.id, name: p.name, start: t.start || "", end: t.end || "" };
  });
  return {
    fixtureVersion: fx.fixtureVersion,
    taskCount: tasks.length,
    leafCount: tasks.filter((t) => t.parentId != null).length,
    phaseCount: tasks.filter((t) => t.parentId == null).length,
    milestoneCount: tasks.filter((t) => t.duration === 0 && t.parentId != null).length,
    unscheduledCount: tasks.filter((t) => t.parentId != null && !t.start && (!t.predecessors || t.predecessors.length === 0)).length,
    predLinkCount: tasks.reduce((n, t) => n + (t.predecessors ? t.predecessors.length : 0), 0),
    phaseRollup,
    exportName: E.scheduleExportName([{ name: fx.project.name, tasks }], new Date("2026-07-04T12:00:00Z")),
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Dense Site Planner test-fit — createSiteModel with a building + bonded children + parking +
//    truck courts + bump-outs + markups + a couple of tombstones. Seeded, deterministic.
// ---------------------------------------------------------------------------------------------
function siteFixture() {
  const r = rng(0x517e);
  const els = [];
  let n = 0;
  const eid = (k) => `e2e-${k}-${++n}`;
  // one big building + 2 smaller, each with 2 dog-ear bump-outs
  const buildings = [{ w: 600, h: 300 }, { w: 240, h: 160 }, { w: 200, h: 120 }];
  const buildingIds = [];
  buildings.forEach((b, bi) => {
    const id = eid("bldg");
    buildingIds.push(id);
    els.push({ id, type: "building", x: 100 + bi * 700, y: 100, w: b.w, h: b.h, rot: 0 });
    for (let d = 0; d < 2; d++) els.push({ id: eid("dogear"), type: "building", dogEar: true, attachedTo: id, x: 100 + bi * 700 + d * 120, y: 100 - 40, w: 90, h: 40, rot: 0 });
    els.push({ id: eid("court"), type: "truckCourt", forCourt: id, x: 100 + bi * 700, y: 100 + b.h, w: b.w, h: 185 });
    els.push({ id: eid("parking"), type: "parking", forTrailer: id, x: 100 + bi * 700, y: 100 + b.h + 185, w: b.w, h: 60, stalls: rint(r, 30, 60) });
  });
  for (let i = 0; i < 6; i++) els.push({ id: eid("setback"), type: "line", x: rint(r, 0, 1300), y: rint(r, 0, 1300), w: 0, h: 0 });
  const markups = [
    { id: eid("mk"), kind: "polyline", pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
    { id: eid("mk"), kind: "easement", pts: [{ x: 10, y: 10 }, { x: 200, y: 10 }] },
  ];
  const measures = [{ id: eid("meas"), type: "distance", pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }];
  const callouts = [{ id: eid("call"), text: "E2E note", x: 50, y: 50 }];
  return {
    fixtureVersion: FIXTURE_VERSION,
    generator: "scripts/build-fixtures.mjs",
    engine: `siteModel.js (SITE_MODEL_VERSION ${SITE_MODEL_VERSION})`,
    note: "Synthetic dense industrial test-fit (no real parcel/address). Seeds e2e-fixture-testfit.",
    site: createSiteModel({
      id: "e2e-fixture-testfit",
      name: "E2E Dense Test-Fit",
      status: "active",
      county: "Harris",
      updatedAt: 1783000000000, // fixed epoch — keep the fixture byte-deterministic (no Date.now())
      parcels: [{ id: "e2e-parcel-1", ring: ring(1320, 1320), active: true }],
      els,
      markups,
      measures,
      callouts,
      deletedIds: ["e2e-ghost-1", "e2e-ghost-2"],
    }),
    // the "other copy" a stale tab/device might still hold — includes the ghosts + the first building
    staleOtherCopy: { els: [{ id: "e2e-ghost-1", type: "building", x: 0, y: 0, w: 10, h: 10 }], markups: [], updatedAt: 1 },
    deleteTarget: buildingIds[0],
  };
}
function siteGolden(fx) {
  const site = createSiteModel(fx.site);
  // tombstone-delete: remove the first building + its bonded children, record their ids in deletedIds
  const target = fx.deleteTarget;
  const kill = new Set([target, ...site.els.filter((e) => e.attachedTo === target || e.forCourt === target || e.forTrailer === target).map((e) => e.id)]);
  const afterDelete = createSiteModel({ ...site, els: site.els.filter((e) => !kill.has(e.id)), deletedIds: [...site.deletedIds, ...kill], updatedAt: 2 });
  // merge with a stale "other copy" that STILL holds the killed ids + the ghosts → must not resurrect
  const staleFull = createSiteModel({ ...site, ...fx.staleOtherCopy, updatedAt: 1 });
  const merged = mergeSiteContent(afterDelete, staleFull);
  const mergedIds = new Set(merged.els.map((e) => e.id));
  return {
    fixtureVersion: fx.fixtureVersion,
    schemaVersion: site.schemaVersion,
    contentCount: contentCount(site),
    elCount: site.els.length,
    killedCount: kill.size,
    afterDeleteContentCount: contentCount(afterDelete),
    resurrectedAny: [...kill].some((id) => mergedIds.has(id)) || fx.site.deletedIds.some((g) => mergedIds.has(g)),
    mergedContentCount: contentCount(merged),
  };
}

// ---------------------------------------------------------------------------------------------
// 4. Two-writer concurrency race — pure optimistic-CAS outcomes.
// ---------------------------------------------------------------------------------------------
function twoWriterFixture() {
  return {
    fixtureVersion: FIXTURE_VERSION,
    generator: "scripts/build-fixtures.mjs",
    engine: "optimisticUpsert.js",
    note: "Synthetic two-writer race over one row at version N. writerA lands, writerB (stale) must conflict, un-migrated DB degrades.",
    baseVersion: 7,
    scenarios: [
      { name: "writerA-lands", rows: [{ version: 8 }], error: null },
      { name: "writerB-stale-conflict", rows: [], error: null },
      { name: "insert-collision", kind: "insert", rows: [], error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      { name: "unmigrated-degrade", rows: [], error: { code: "42703", message: 'column "version" does not exist' } },
    ],
  };
}
function twoWriterGolden(fx) {
  return {
    fixtureVersion: fx.fixtureVersion,
    outcomes: fx.scenarios.map((s) => ({
      name: s.name,
      result: s.kind === "insert" ? interpretInsert(s.rows, s.error) : interpretCas(s.rows, s.error),
      missingVersionColumn: isMissingVersionColumn(s.error),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
function round(x, dp) { const f = 10 ** dp; return Math.round((x + Number.EPSILON) * f) / f; }
function stable(o) { return JSON.stringify(o, null, 2) + "\n"; }

const ARTIFACTS = [
  { dir: "ponds", base: "detention-regression", fixture: pondFixture, golden: pondGolden },
  { dir: "schedules", base: "dense-project", fixture: ganttFixture, golden: ganttGolden },
  { dir: "sites", base: "dense-testfit", fixture: siteFixture, golden: siteGolden },
  { dir: "cloud", base: "two-writer", fixture: twoWriterFixture, golden: twoWriterGolden },
];

function buildAll() {
  return ARTIFACTS.map((a) => {
    const fx = a.fixture();
    return {
      fixturePath: join("e2e", "fixtures", a.dir, `${a.base}.fixture.json`),
      goldenPath: join("e2e", "fixtures", a.dir, `${a.base}.golden.json`),
      fixture: stable(fx),
      golden: stable(a.golden(fx)),
    };
  });
}

export function auditFixtures() {
  const built = buildAll();
  const problems = [];
  for (const b of built) {
    for (const [rel, content] of [[b.fixturePath, b.fixture], [b.goldenPath, b.golden]]) {
      const abs = join(REPO, rel);
      if (!existsSync(abs)) { problems.push(`missing: ${rel} — run \`node scripts/build-fixtures.mjs\``); continue; }
      if (readFileSync(abs, "utf8") !== content) problems.push(`drifted: ${rel} — regenerate with \`node scripts/build-fixtures.mjs\``);
    }
  }
  return { ok: problems.length === 0, problems };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes("--check")) {
    const { ok, problems } = auditFixtures();
    if (!ok) { console.error("Fixture drift check FAILED:\n" + problems.map((p) => "  • " + p).join("\n")); process.exit(1); }
    console.log("Fixture drift check passed.");
  } else {
    for (const b of buildAll()) {
      mkdirSync(dirname(join(REPO, b.fixturePath)), { recursive: true });
      writeFileSync(join(REPO, b.fixturePath), b.fixture);
      writeFileSync(join(REPO, b.goldenPath), b.golden);
    }
    console.log(`Wrote ${ARTIFACTS.length} fixtures + goldens under e2e/fixtures/.`);
  }
}
