/* NEW-1 — the performance-budget POLICY, enforced rather than described.
 *
 * The rule the repo already had ("ratchet the ceiling down toward the target as optimizations
 * land — never up to accommodate a regression") was a paragraph in a markdown file governing a
 * hand-edited number in a JSON file. Nothing checked it, and in practice the three bundle
 * ceilings ended up pinned to within a rounding error of measured — 1.1 KB (0.06%) of headroom
 * on largestChunkBytes — so three consecutive pull requests (#858 ×4, #859 ×2, #860) went red on
 * 0.8–0.9% growth that was not a regression at all.
 *
 * These tests give the policy teeth:
 *   (a) byte ceilings are DERIVED from a baseline + one committed headroom band, so nobody can
 *       hand-pin one back to zero-headroom;
 *   (b) growth inside the band annotates and PASSES, growth beyond it FAILS — the exact
 *       behaviour the brief asks for, asserted on both sides of the line;
 *   (c) every baseline matches the `to` of its own latest ratchet-log entry, so a baseline moved
 *       by hand — with no reason on the record — goes red here;
 *   (d) the ratchet script itself refuses to run without an item and a real reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { classify, ceilingFor, headroomFor, isBanded, METRIC_KEYS, DEFAULT_HEADROOM } from "../ui-audit/lib/perfBudgetPolicy.mjs";
import { stemOf, bucketOf, packageOf, diffSnapshots } from "../ui-audit/lib/bundleMetrics.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const budgets = JSON.parse(readFileSync(join(REPO, "ui-audit", "perf-budgets.json"), "utf8"));
const bundle = budgets.bundle;
const headroom = bundle.headroom;

/* Metrics whose ceiling is derived. siteRouteChunks is deliberately NOT one of them. */
const banded = METRIC_KEYS(bundle).filter((k) => isBanded(bundle[k]));

describe("the headroom band is committed once, in one place", () => {
  it("bundle.headroom exists and is the band the brief specifies: max(2%, 32 KB)", () => {
    expect(headroom).toBeTruthy();
    expect(headroom.pctOfBaseline).toBe(0.02);
    expect(headroom.minBytes).toBe(32768);
  });

  it("the library's fallback matches the committed band, so a missing key cannot silently narrow it", () => {
    expect(DEFAULT_HEADROOM.pctOfBaseline).toBe(headroom.pctOfBaseline);
    expect(DEFAULT_HEADROOM.minBytes).toBe(headroom.minBytes);
  });

  it("the band is the LARGER of the two, not the percentage alone", () => {
    expect(headroomFor(100_000, headroom)).toBe(32768);      // 2% would be 2000 — too small for one honest feature
    expect(headroomFor(5_000_000, headroom)).toBe(100_000);  // 2% wins once the metric is big
  });
});

describe("byte ceilings are derived, never hand-pinned", () => {
  it("every byte metric carries a baseline and NO literal ceiling", () => {
    expect(banded.length).toBeGreaterThanOrEqual(3);
    for (const k of banded) {
      expect(bundle[k].baseline, `${k}.baseline`).toBeTypeOf("number");
      expect(bundle[k].ceiling, `${k} must not hand-pin a ceiling — it is derived from baseline + the band`).toBeUndefined();
    }
  });

  it("the three metrics the gate has actually failed on are all banded", () => {
    for (const k of ["siteRouteJsBytes", "totalJsBytes", "largestChunkBytes"]) {
      expect(banded, `${k} must be banded — totalJsBytes in particular was 3 KB from breaching`).toContain(k);
    }
  });

  it("the derived ceiling is exactly baseline + the band", () => {
    for (const k of banded) {
      const spec = bundle[k];
      expect(ceilingFor(spec, headroom)).toBe(spec.baseline + headroomFor(spec.baseline, headroom));
    }
  });

  it("a count metric keeps a hard ceiling and gets no band — 'four chunks plus two percent' is not a sentence", () => {
    expect(isBanded(bundle.siteRouteChunks)).toBe(false);
    expect(bundle.siteRouteChunks.ceiling).toBeTypeOf("number");
    expect(ceilingFor(bundle.siteRouteChunks, headroom)).toBe(bundle.siteRouteChunks.ceiling);
  });
});

describe("growth inside the band annotates; growth beyond it fails", () => {
  const spec = { baseline: 1_000_000, target: 900_000, unit: "bytes" };
  const band = headroomFor(spec.baseline, headroom); // 32768 (the floor wins at this size)

  it("at or under target — a plain pass", () => {
    expect(classify(890_000, spec, headroom).status).toBe("pass");
  });

  it("over target but at the baseline — ABOVE TARGET, tracked, passing", () => {
    expect(classify(1_000_000, spec, headroom).status).toBe("aboveTarget");
  });

  it("one byte over the baseline — ABOVE BASELINE, loud, still passing", () => {
    const r = classify(spec.baseline + 1, spec, headroom);
    expect(r.status).toBe("aboveBaseline");
    expect(r.overBaseline).toBe(1);
    expect(r.bandLeft).toBe(band - 1);
  });

  it("the 0.9% growth that failed PR #860 now passes, because that is a headroom problem not a regression", () => {
    const r = classify(Math.round(spec.baseline * 1.009), spec, headroom);
    expect(r.status).toBe("aboveBaseline");
  });

  it("exactly at the derived ceiling still passes — the ceiling is inclusive", () => {
    expect(classify(spec.baseline + band, spec, headroom).status).toBe("aboveBaseline");
  });

  it("one byte past the ceiling FAILS — a real regression is still red", () => {
    const r = classify(spec.baseline + band + 1, spec, headroom);
    expect(r.status).toBe("breach");
    expect(r.delta).toBe(1);
  });

  it("a count metric fails on the count itself, with no band applied", () => {
    const chunks = { ceiling: 6, target: 6, unit: "chunks" };
    expect(classify(6, chunks, headroom).status).toBe("pass");
    expect(classify(7, chunks, headroom).status).toBe("breach");
  });
});

describe("the ratchet log is the record, and every baseline must match it", () => {
  const entries = bundle.ratchetLog?.entries || [];

  it("the log exists and is non-empty", () => {
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every entry states metric, from, to, direction, item, date and a real reason", () => {
    for (const [i, e] of entries.entries()) {
      const at = `entry ${i} (${e.metric})`;
      expect(e.metric, at).toMatch(/^bundle\./);
      expect(e.from, at).toBeTypeOf("number");
      expect(e.to, at).toBeTypeOf("number");
      expect(["ratchet", "raise"], at).toContain(e.direction);
      expect(String(e.item || ""), `${at} — a baseline move with no owning item is the side effect this step exists to prevent`).not.toBe("");
      expect(String(e.date || ""), at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(e.reason || "").length, `${at} — the reason must explain what optimization landed`).toBeGreaterThanOrEqual(24);
    }
  });

  it("direction agrees with the numbers — a raise cannot be logged as a ratchet", () => {
    for (const e of entries) {
      expect(e.direction, `${e.metric} ${e.from} -> ${e.to}`).toBe(e.to > e.from ? "raise" : "ratchet");
    }
  });

  /* THE LOAD-BEARING ONE. Hand-edit a baseline without logging why, and this goes red. */
  it("every baseline equals the `to` of its own LATEST log entry", () => {
    for (const k of banded) {
      const path = `bundle.${k}`;
      const mine = entries.filter((e) => e.metric === path);
      expect(mine.length, `${path} has no ratchet-log entry — its baseline has no recorded provenance`).toBeGreaterThan(0);
      const latest = mine[mine.length - 1];
      expect(bundle[k].baseline, `${path}: baseline ${bundle[k].baseline} does not match the latest logged value ${latest.to}. Move it with \`npm run perf:ratchet\`, never by hand.`).toBe(latest.to);
    }
  });
});

describe("the ratchet step refuses to run unnamed", () => {
  const run = (args) => {
    try {
      execFileSync("node", [join(REPO, "scripts", "perf-ratchet.mjs"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, err: "" };
    } catch (e) {
      return { code: e.status, err: `${e.stderr || ""}${e.stdout || ""}` };
    }
  };

  it("no --item is a hard refusal", () => {
    const r = run(["--metric", "bundle.largestChunkBytes", "--reason", "a perfectly long and plausible sounding reason"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/--item is required/);
  });

  it("no --reason is a hard refusal", () => {
    const r = run(["--metric", "bundle.largestChunkBytes", "--item", "B1064"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/--reason is required/);
  });

  it("a token reason ('perf') is a hard refusal — the reason is the whole point", () => {
    const r = run(["--metric", "bundle.largestChunkBytes", "--item", "B1064", "--reason", "perf"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/at least \d+ characters/);
  });

  it("naming nothing at all is a hard refusal", () => {
    const r = run(["--item", "B1064", "--reason", "a perfectly long and plausible sounding reason"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/name what you are ratcheting/);
  });
});

/* ---- NEW-3: the attribution primitives -------------------------------------------------- */
describe("byte attribution names the cause", () => {
  it("buckets a module by where it comes from", () => {
    expect(bucketOf("node_modules/leaflet/dist/leaflet-src.js")).toBe("vendor");
    expect(bucketOf("src/shared/ui/AppHeader.jsx")).toBe("app-shared");
    expect(bucketOf("src/app/Shell.jsx")).toBe("app-shared");
    expect(bucketOf("src/workspaces/site-planner/SitePlanner.jsx")).toBe("app-route");
    expect(bucketOf(" commonjsHelpers.js")).toBe("misc");
  });

  it("names the package a vendor module belongs to, scopes and nesting included", () => {
    expect(packageOf("node_modules/leaflet/dist/leaflet-src.js")).toBe("leaflet");
    expect(packageOf("node_modules/@terraformer/arcgis/dist/t-arcgis.esm.js")).toBe("@terraformer/arcgis");
    expect(packageOf("node_modules/a/node_modules/clipper-lib/clipper.js")).toBe("clipper-lib");
  });

  it("a diff names WHICH modules moved and by how much, biggest mover first", () => {
    const base = { metrics: { totalJsBytes: 1000 }, modules: { "src/a.js": 100, "node_modules/x/i.js": 500 }, packages: { x: 500 }, routeBuckets: {} };
    const head = { metrics: { totalJsBytes: 21_500 }, modules: { "src/a.js": 20_100, "node_modules/x/i.js": 1400 }, packages: { x: 1400 }, routeBuckets: {} };
    const d = diffSnapshots(base, head);
    expect(d.metrics.totalJsBytes.delta).toBe(20_500);
    expect(d.modules[0].id).toBe("src/a.js");
    expect(d.modules[0].delta).toBe(20_000);
    expect(d.packages[0]).toMatchObject({ id: "x", delta: 900 });
  });

  it("a module that did not move is not reported as noise", () => {
    const same = { metrics: { totalJsBytes: 10 }, modules: { "src/a.js": 5000 }, packages: {}, routeBuckets: {} };
    expect(diffSnapshots(same, same).modules).toEqual([]);
  });
});

describe("chunk stems survive a hyphenated chunk name", () => {
  it("strips exactly the 8-character content hash", () => {
    expect(stemOf("assets/SitePlannerApp-CLERexRa.js")).toBe("SitePlannerApp");
    expect(stemOf("assets/pdf.worker.min-cxA_QnXv.js")).toBe("pdf.worker.min");
  });

  it("does NOT eat the tail of a hyphenated name — the allowlist has to stay readable", () => {
    expect(stemOf("assets/map-vendor-BLBG5Rcw.js")).toBe("map-vendor");
    expect(stemOf("assets/cjs-interop-BLBG5Rcw.js")).toBe("cjs-interop");
  });

  it("every stem the Site-route allowlist names is a plausible chunk name, not a truncation", () => {
    for (const stem of bundle.siteRouteAllowlist.allow) expect(stem).toMatch(/^[A-Za-z][A-Za-z0-9._-]*$/);
  });
});

/* ── the RUNTIME ratchet log (NEW-1, 2026-07-31) ───────────────────────────────────────────
 * Same guarantee as the bundle log above, for the metrics that need a browser: a runtime
 * `measured` may only move through `npm run perf:ratchet -- --from-harness <a real run>`, so a
 * hand-typed frame number with no reason on the record goes RED here. These metrics had to
 * learn the lesson twice — once for a hidden-tab sample, once for a scene with the expensive
 * work taken out — which is exactly why the rule now applies to them too.
 */
describe("a runtime measurement moves only through the named ratchet step", () => {
  const entries = budgets.runtime.ratchetLog?.runtimeRatchetEntries || [];

  it("the log exists, and is kept separate from the bundle log", () => {
    expect(Array.isArray(entries)).toBe(true);
    expect(budgets.runtime.ratchetLog.entries, "the two logs must never be confusable").toBeUndefined();
  });

  it("every entry states metric, from, to, direction, scenario, item, date and a real reason", () => {
    for (const [i, e] of entries.entries()) {
      const at = `runtime entry ${i} (${e.metric})`;
      expect(e.metric, at).toMatch(/^runtime\./);
      expect(e.to, at).toBeTypeOf("number");
      expect(["ratchet", "raise", "reseed"], at).toContain(e.direction);
      expect(String(e.scenario || ""), `${at} — a frame number means nothing without the scene it was measured on`).not.toBe("");
      expect(String(e.item || ""), at).not.toBe("");
      expect(String(e.date || ""), at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(e.reason || "").length, `${at} — the reason is the permanent record`).toBeGreaterThan(23);
    }
  });

  it("every harness-seeded metric equals the `to` of its own latest log entry", () => {
    for (const [key, spec] of Object.entries(budgets.runtime)) {
      if (!spec || typeof spec !== "object" || !spec.seededFrom) continue;
      const mine = entries.filter((e) => e.metric === `runtime.${key}`);
      expect(mine.length, `runtime.${key} carries seededFrom but has no ratchet entry — was it hand-edited?`).toBeGreaterThan(0);
      expect(spec.measured, `runtime.${key} does not match its latest logged ratchet`).toBe(mine[mine.length - 1].to);
    }
  });

  it("the frame specs name the scene they were seeded on, not just the instrument", () => {
    for (const k of ["frameMedianMs", "frameP90Ms"]) {
      expect(budgets.runtime[k].seededFrom).toMatch(/perf-harness\.mjs/);
      expect(budgets.runtime[k].seededFrom, `${k} must record WHICH scenario`).toMatch(/goose-creek/);
    }
  });
});
