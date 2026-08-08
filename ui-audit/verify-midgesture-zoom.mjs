#!/usr/bin/env node
/* verify-midgesture-zoom — THE MISSING INSTRUMENT (B1449, step 1 of the plan, built FIRST).
 *
 * ⛔ WHAT THIS REPO COULD NOT SEE BEFORE, and why that blindness was itself the defect.
 * At rest `renderView.ppf === view.ppf`, so a correct anchored zoom and a broken one render
 * IDENTICALLY. Every unit test, every e2e spec and every pixel harness here passes either way.
 * That is why B1449 kept being called "dangerous" — and the honest reading (owner, 2026-08-08:
 * *"if it is dangerous, then we should probably be fixing it in the first place because why is it
 * dangerous?"*) is that "nothing can observe whether it is correct" is a hole to close, not a
 * reason to stay away. /CLAUDE.md → DANGEROUS-MEANS-UNOBSERVABLE.
 *
 * WHAT IT DRIVES. A real wheel gesture on the committed reference plan, captured MID-GESTURE —
 * before the settle timer re-bakes the frame — and again once it settles. Three questions:
 *
 *   1. DID THE ANCHOR ARM? (`data-render-ppf` ≠ `data-view-ppf`, `data-pan-k` ≠ 1.) A run where it
 *      did not proves nothing, and is reported as a FAILURE rather than a pass — the exact way a
 *      guard of this shape rots green.
 *   2. IS THE MID-GESTURE GEOMETRY EXACT? Every drawn node must sit where the settled frame put it,
 *      scaled by k about the wheel's own screen anchor. Not a pixel diff, deliberately: mid-gesture
 *      the strokes, type and LOD tier are the anchor's — that is the accepted trade-off — so a
 *      pixel comparison would fail on a CORRECT build. Geometry is what must be exact.
 *   3. DOES IT JUMP WHEN IT SETTLES? The anchored frame and the re-baked frame must be the same
 *      picture geometrically (VIEWPORT-STABLE).
 *
 * ⛔ AND IT IS PROVEN TO GO RED, which is the part that makes it worth having. Two mutations, both
 * driven from the page so no mutant build has to be kept alive:
 *   --mutate=double-scale  a MutationObserver rewrites the group's `scale(k)` to `scale(k²)` — the
 *                          exact bug B1449 named. Question 2 must fail, diagnosed `double-scaled`.
 *   --mutate=no-anchor     turns the Smooth zoom setting off. Question 1 must fail, i.e. the guard
 *                          refuses to pass a build where the anchor never arms.
 * `--selftest` runs the clean pass and BOTH mutations and fails unless the clean one is green and
 * both mutants are red. That is the run to trust.
 *
 *   node ui-audit/verify-midgesture-zoom.mjs --build
 *   node ui-audit/verify-midgesture-zoom.mjs --selftest --build
 *   node ui-audit/verify-midgesture-zoom.mjs --json
 *   node ui-audit/verify-midgesture-zoom.mjs --shots        # before/mid/after crops for the PR
 *
 * Exits non-zero on a violation. This one IS a gate.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { runVerdict } from "./lib/midGestureZoom.mjs";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const DO_BUILD = process.argv.includes("--build");
const SELFTEST = process.argv.includes("--selftest");
const SHOTS = process.argv.includes("--shots");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = Number(argOf("--port", 4193));
const BASE = `http://localhost:${PORT}/`;
const OUTDIR = path.resolve(argOf("--out", "ui-audit/out/midgesture-zoom"));
const NOTCHES = Number(argOf("--notches", 3));      // wheel detents in the burst; 3 → k ≈ 1.405
const DIST = path.resolve("dist");

/* The gesture has to be captured BEFORE the settle timer re-bakes the frame. ZOOM_SETTLE_MS is
 * 220 ms; the burst plus the read has to fit inside that with room for a slow CI frame. */
const CAPTURE_BUDGET_MS = 120;

if (DO_BUILD) {
  execFileSync("npx", ["vite", "build"], { stdio: JSON_OUT ? "ignore" : "inherit" });
}
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`⛔ No build at ${DIST}. Run with --build.`);
  process.exit(2);
}

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch { /* already gone */ } });
const up = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try { const r = await fetch(BASE); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})();
if (!up) { server.kill(); console.error(`⛔ preview server never came up on ${BASE}`); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* The MutationObserver mutant. It rewrites the anchored group's own transform, so it reproduces a
 * build whose scale term is wrong WITHOUT keeping a second bundle alive — and it is honest about
 * what it changes: only the `scale(...)` factor, never the translate. */
const DOUBLE_SCALE = () => {
  window.__mgPatches = 0;
  /* ⛔ REMEMBER OUR OWN WRITE. Without this the observer squares its own output every time it fires
     — k → k² → k⁴ — and the first run reached 6.3e37, which pushes every node off screen so the
     harness measures NOTHING and reports "observed nothing" instead of "double-scaled". A mutant
     that fails for the wrong reason is not a proof that the guard works. */
  const mine = new WeakMap();
  const patch = (g) => {
    const t = g.getAttribute("transform") || "";
    if (mine.get(g) === t) return;                 // our own write, already squared once
    const m = /^translate\(([^)]*)\)\s*scale\(([-\d.eE]+)\)$/.exec(t);
    if (!m) return;
    const k = Number(m[2]);
    if (!(k > 0) || k === 1) return;
    const want = `translate(${m[1]}) scale(${k * k})`;
    if (t === want) return;
    mine.set(g, want);
    g.setAttribute("transform", want);
    window.__mgPatches++;
  };
  const scan = () => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    if (!svg) return;
    // Any group whose transform is EXACTLY the anchored form — `patch` re-checks the shape, so a
    // rotate/translate group elsewhere in the tree is never touched.
    for (const g of svg.querySelectorAll("g[transform]")) patch(g);
  };
  /* Observing the DOCUMENT can miss the write: React sets the attribute and the callback is a
     microtask, but the mutant also has to survive being installed before <html> exists. Arm both
     ways and record whether it ever fired — a mutant that silently did nothing would read as "the
     harness cannot see the bug", which is a different and much worse conclusion than the truth. */
  const start = () => {
    try {
      new MutationObserver(scan).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["transform"], childList: true });
      scan();
    } catch (e) { window.__mgError = String(e && e.message || e); }
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });
  window.__midGestureMutation = "double-scale";
};

async function runOnce(mutate) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(perfScenarioSeed());
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  if (mutate === "no-anchor") await ctx.addInitScript(() => { try { localStorage.setItem("planarfit:smoothZoom", "0"); } catch { /* private mode */ } });
  if (mutate === "double-scale") await ctx.addInitScript(DOUBLE_SCALE);
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
  await page.waitForTimeout(3000);

  /* The nodes we track. `data-el-id` is the drawn model — the thing a zoom is FOR — and it is a
   * stable contract already relied on by the e2e suite. Everything inside the anchored group moves
   * together or the weld B1122 protects is broken, so a broad sample is the point.
   *
   * ⛔ `[data-feature^="el:"]` IS LOAD-BEARING, NOT DECORATION, and finding that out is the first
   * thing this harness caught. `data-el-id` alone is NOT unique: the rect outline-cut node
   * (`data-testid="rect-outline-cut"`) carries its element's id too and renders CONDITIONALLY, so a
   * naive id→rect map silently compared the element's own group in one snapshot against the
   * outline-cut node in the other, and reported a 5.6 px "failure" in a build that was exact to
   * four decimal places. An instrument that can do that is the thing on trial, not the app
   * (/CLAUDE.md → STANDING RULE #2, clause 1). Only the element's OWN outermost group carries
   * `data-feature="el:<id>"`. First-wins dedupe below is the belt to that braces. */
  const NODE_SEL = '[data-el-id][data-feature^="el:"]';
  const readRects = () => page.evaluate((sel) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const out = [];
    const seen = new Set();
    for (const n of svg.querySelectorAll(sel)) {
      const id = n.getAttribute("data-el-id");
      if (seen.has(id)) continue;              // one node per element, always the same one
      const r = n.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      seen.add(id);
      out.push({ id, rect: { x: r.x, y: r.y, w: r.width, h: r.height } });
    }
    return {
      nodes: out,
      viewPpf: Number(svg.getAttribute("data-view-ppf")),
      renderPpf: Number(svg.getAttribute("data-render-ppf")),
      k: Number(svg.getAttribute("data-pan-k")),
      groupTransform: (svg.querySelector("g[transform]") || {}).getAttribute?.("transform") || null,
      mutantPatches: window.__mgPatches ?? null,
      mutantError: window.__mgError ?? null,
    };
  }, NODE_SEL);

  const rest = await readRects();
  if (!rest.nodes.length) {
    await ctx.close();
    return { mutate, ok: false, problems: [`no ${NODE_SEL} nodes on the canvas — the fixture did not seed, so this run observed nothing`] };
  }
  if (SHOTS) { fs.mkdirSync(OUTDIR, { recursive: true }); await page.screenshot({ path: path.join(OUTDIR, `${mutate || "clean"}-1-before.png`) }); }

  /* The gesture. A real `wheel` on the canvas wrapper, at a point well off centre so a scale about
   * it displaces every node by a different amount — a centre anchor would let a pure-translate bug
   * hide inside a symmetric error. */
  const anchor = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
    return { x: r.x + r.width * 0.28, y: r.y + r.height * 0.34 };
  });

  const t0 = Date.now();
  await page.evaluate(({ a, n }) => {
    const el = document.elementFromPoint(a.x, a.y) || document.querySelector('[data-testid="planner-canvas"]');
    for (let i = 0; i < n; i++) {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, deltaMode: 0, clientX: a.x, clientY: a.y, bubbles: true, cancelable: true }));
    }
  }, { a: anchor, n: NOTCHES });
  // One frame for the rAF-coalesced flush + React commit, then read while the anchor is still armed.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const mid = await readRects();
  const captureMs = Date.now() - t0;
  if (SHOTS) await page.screenshot({ path: path.join(OUTDIR, `${mutate || "clean"}-2-mid.png`) });

  // …then let it settle and read again.
  await page.waitForTimeout(700);
  const settled = await readRects();
  if (SHOTS) await page.screenshot({ path: path.join(OUTDIR, `${mutate || "clean"}-3-settled.png`) });
  await ctx.close();

  const byId = (snap) => new Map(snap.nodes.map((n) => [n.id, n.rect]));
  const midById = byId(mid), restById = byId(rest), setById = byId(settled);
  const nodes = rest.nodes.map((n) => ({ id: n.id, rest: n.rect, mid: midById.get(n.id) })).filter((n) => n.mid);
  const settlePairs = mid.nodes.map((n) => ({ id: n.id, mid: n.rect, settled: setById.get(n.id) })).filter((s) => s.settled);

  const v = runVerdict({
    nodes, k: mid.k, anchor,
    arm: { viewPpf: mid.viewPpf, renderPpf: mid.renderPpf, k: mid.k },
    settle: settlePairs,
  });
  if (captureMs > CAPTURE_BUDGET_MS) {
    v.problems.push(`the mid-gesture read took ${captureMs} ms against a ${CAPTURE_BUDGET_MS} ms budget — it may have raced the settle timer, so this run is INCONCLUSIVE rather than green`);
    v.ok = false;
  }
  return {
    mutate: mutate || null, ...v, captureMs,
    restPpf: rest.renderPpf, midViewPpf: mid.viewPpf, midRenderPpf: mid.renderPpf,
    settledK: settled.k, settledRenderPpf: settled.renderPpf, settledViewPpf: settled.viewPpf,
    nodeTotal: restById.size,
    groupTransform: mid.groupTransform, mutantPatches: mid.mutantPatches, mutantError: mid.mutantError,
  };
}

const report = (r) => {
  const tag = r.mutate ? `mutant:${r.mutate}` : "clean";
  console.log(`\n── ${tag} ──`);
  console.log(`  anchored: ${r.armed ? "yes" : "NO"} · k=${Number(r.k).toFixed(4)} · render ppf ${r.midRenderPpf} vs live ${r.midViewPpf}`);
  console.log(`  nodes checked: ${r.checkedCount ?? 0}/${r.nodeTotal ?? 0} · failed ${r.failedCount ?? 0} · worst ${Number(r.worstPx || 0).toFixed(2)} px · mechanism ${r.mechanism} (observed ${r.observedScale?.toFixed?.(4) ?? "—"})`);
  console.log(`  settle: k=${r.settledK} · jumped ${r.settleJumped ?? 0} · captured in ${r.captureMs} ms`);
  console.log(`  group transform mid-gesture: ${r.groupTransform}${r.mutantPatches != null ? ` · mutant patches ${r.mutantPatches}` : ""}${r.mutantError ? ` · mutant error ${r.mutantError}` : ""}`);
  for (const p of r.problems || []) console.log(`  ⛔ ${p}`);
  for (const f of r.failures || []) console.log(`     · ${f.id} off by (${f.err.x.toFixed(2)}, ${f.err.y.toFixed(2)}, w${f.err.w.toFixed(2)}, h${f.err.h.toFixed(2)}) observed ${f.observed?.toFixed?.(4)}`);
  for (const j of r.jumps || []) console.log(`     ↯ ${j.id} moved (${(j.settled.x - j.mid.x).toFixed(2)}, ${(j.settled.y - j.mid.y).toFixed(2)}, w${(j.settled.w - j.mid.w).toFixed(2)}, h${(j.settled.h - j.mid.h).toFixed(2)})`);
  if (!r.problems?.length) console.log("  ✅ mid-gesture geometry is exactly the settled geometry, scaled about the cursor");
};

const clean = await runOnce(null);
let exit = clean.ok ? 0 : 1;
const results = { clean };

if (SELFTEST) {
  for (const m of ["double-scale", "no-anchor"]) results[m] = await runOnce(m);
}
await browser.close();
server.kill();

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of Object.values(results)) report(r);
}

if (SELFTEST) {
  const bad = [];
  if (!clean.ok) bad.push("the CLEAN run is red — fix that before reading the mutants");
  for (const m of ["double-scale", "no-anchor"]) {
    if (results[m]?.ok) bad.push(`the ${m} MUTANT passed — this harness cannot see the bug it exists to catch, so a green run from it means nothing`);
  }
  if (results["double-scale"] && !results["double-scale"].ok && results["double-scale"].mechanism !== "double-scaled") {
    bad.push(`the double-scale mutant failed but was diagnosed "${results["double-scale"].mechanism}" rather than "double-scaled" — the diagnosis is wrong even though the verdict is right`);
  }
  if (bad.length) { console.log("\n⛔ SELFTEST FAILED"); for (const b of bad) console.log(`   ${b}`); exit = 1; }
  else console.log("\n✅ SELFTEST PASSED — clean green, both mutants red, double-scale correctly diagnosed");
}
process.exit(exit);
