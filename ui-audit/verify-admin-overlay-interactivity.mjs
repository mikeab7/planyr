/* verify-admin-overlay-interactivity.mjs — B1154241 (NEW-2), companion to the B1154240 (NEW-1)
 * pointer-events fix.
 *
 * ── WHY THIS CHECK EXISTS: EVERY PRIOR ASSERTION HERE TESTS ABSENCE, NOT USABILITY ──────────
 * `test/adminGate.test.js` uses `react-dom/server` snapshots, which can only observe that no
 * admin markup rendered — true on the broken build, where AdminGate correctly returns null.
 * The earlier V380448 headless pass asserted zero `[data-testid="admin-app"]` nodes, no console
 * errors, hash intact — also true on the broken build. Nothing checked-in ever asked "can a
 * press reach the workspace underneath" — which is exactly the property B1154240 fixed and the
 * property this file exists to guard, following the CHROME-NEVER-EATS-A-PRESS precedent set by
 * B613762/B646272 (a check with no mutation proof is not a check).
 *
 * ── THE MEASUREMENT ───────────────────────────────────────────────────────────────────────
 * At `#/admin`, signed out (so AdminGate renders null — the exact "swallows everything" case),
 * `document.elementFromPoint` at several interior points of `main` must resolve to the real
 * workspace underneath (the Leaflet map container), never to the empty gate wrapper. The
 * control route `#/totally-bogus-slug` — also an unresolved hash, also falls back to the
 * ordinary dashboard — must read identically; the two routes are asserted equal so the check
 * cannot be fooled by something that merely LOOKS interactive.
 *
 * ── THE MUTATION PROOF, THE STANDARD NAMED IN B613762/B646272 ────────────────────────────────
 * `--mutate` temporarily re-adds `pointerEvents: 'auto'` behaviour by monkey-patching nothing —
 * instead it toggles a real source line (the `pointerEvents: "none"` on the Shell.jsx wrapper)
 * off, rebuilds, measures, and restores the source, so the same script that proves the fix
 * green also proves it can go red on the exact defect it is guarding against. Never leaves the
 * source mutated: the restore runs in a `finally`.
 *
 * Run (fix in place):        node ui-audit/verify-admin-overlay-interactivity.mjs
 * Run (mutation proof, red): node ui-audit/verify-admin-overlay-interactivity.mjs --mutate
 * (vite preview must be on :4173 for a plain run; --mutate rebuilds itself around a fresh preview)
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { execFileSync, spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MUTATE = process.argv.includes("--mutate");
const SHELL_PATH = new URL("../src/app/Shell.jsx", import.meta.url);

async function waitForServer(base, timeoutMs) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(base);
      if (res.ok || res.status < 500) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`server never came up at ${base}`);
    await sleep(300);
  }
}

async function measure(base) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(`(() => { try { window.__PLANYR_E2E = true; } catch (e) {} })();`);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  async function probeHash(hash) {
    await page.goto(`${base}#${hash}`, { waitUntil: "load" });
    await assertMeasurable(page, "verify-admin-overlay-interactivity");
    await page.waitForTimeout(1500); // let AdminGate's async is_admin() path settle if it fires at all
    const box = await page.evaluate(() => {
      const m = document.querySelector("main");
      const r = m.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const points = [
      [box.x + box.w * 0.5, box.y + box.h * 0.5],
      [box.x + box.w * 0.25, box.y + box.h * 0.3],
      [box.x + box.w * 0.75, box.y + box.h * 0.3],
      [box.x + box.w * 0.5, box.y + box.h * 0.75],
    ];
    const hits = [];
    for (const [x, y] of points) {
      const desc = await page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        if (!el) return "null";
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" && el.className ? `.${el.className.split(" ")[0]}` : "";
        return `${el.tagName}${id}${cls}`;
      }, [x, y]);
      hits.push(desc);
    }
    // innerHTML mutation across an idle window + a click at centre — the direct evidence a
    // press reaches something live underneath, not just a plausible-looking element name.
    const before = await page.evaluate(() => document.querySelector("main").innerHTML.length);
    await page.waitForTimeout(300);
    const idleAfter = await page.evaluate(() => document.querySelector("main").innerHTML.length);
    await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
    await page.waitForTimeout(300);
    const clickAfter = await page.evaluate(() => document.querySelector("main").innerHTML.length);
    return { hits, deltaIdle: idleAfter - before, deltaClick: clickAfter - idleAfter };
  }

  const adminResult = await probeHash("/admin");
  const controlResult = await probeHash("/totally-bogus-slug");
  await browser.close();
  return { adminResult, controlResult, errors };
}

function reportAndVerdict(label, { adminResult, controlResult, errors }) {
  console.log(`\n── ${label} ──`);
  console.log("#/admin hits:            ", adminResult.hits.join(" | "));
  console.log("#/totally-bogus-slug hits:", controlResult.hits.join(" | "));
  console.log(`#/admin main.innerHTML delta — idle: ${adminResult.deltaIdle}, click: ${adminResult.deltaClick}`);
  console.log(`control main.innerHTML delta — idle: ${controlResult.deltaIdle}, click: ${controlResult.deltaClick}`);
  if (errors.length) console.log("console errors:", errors);

  // The gate wrapper is an anonymous, class-less, id-less <div> — it reads as the bare tag
  // "DIV" with no selector suffix. A real workspace element underneath always carries a
  // class (Leaflet's own container, a React component's styled div, etc).
  const bareGateShape = adminResult.hits.filter((h) => h === "DIV");
  const matchesControl = adminResult.hits.join("|") === controlResult.hits.join("|");
  const sawMutation = adminResult.deltaClick !== 0 || adminResult.deltaIdle !== 0;
  const looksInteractive = matchesControl && bareGateShape.length === 0;
  const verdict = looksInteractive ? "PASS" : "FAIL";
  console.log(`VERDICT: ${verdict} — ${looksInteractive
    ? "#/admin's interior points resolve identically to the control route (the live workspace, not the gate wrapper)."
    : `#/admin's interior points do NOT match the control route (bare-div hits: ${bareGateShape.length}) — something is winning the hit test that shouldn't be.`}`);
  if (!looksInteractive && !sawMutation) console.log("(consistent with the reported defect: zero DOM mutation on click — the press never reached anything live.)");
  return verdict;
}

async function withMutationOff(fn) {
  const src = readFileSync(SHELL_PATH, "utf8");
  const needle = 'position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>\n            <Suspense fallback={null}>\n              <AdminGate';
  const replacement = 'position: "absolute", inset: 0, zIndex: 1 }}>\n            <Suspense fallback={null}>\n              <AdminGate';
  if (!src.includes(needle)) throw new Error("mutation needle not found in Shell.jsx — has the fix's exact text changed?");
  const mutated = src.replace(needle, replacement);
  writeFileSync(SHELL_PATH, mutated, "utf8");
  try {
    console.log("Rebuilding with pointerEvents:'none' REMOVED (defect reintroduced)...");
    execFileSync("npm", ["run", "build"], { stdio: "inherit", env: { ...process.env, VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "", VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "" } });
    await fn();
  } finally {
    writeFileSync(SHELL_PATH, src, "utf8");
    console.log("Restored Shell.jsx to its committed state.");
  }
}

async function runOnce(base, label) {
  const result = await measure(base);
  return reportAndVerdict(label, result);
}

const BASE = process.env.BASE_URL || "http://localhost:4173/";

if (!MUTATE) {
  await waitForServer(BASE, 15000);
  const verdict = await runOnce(BASE, "FIX IN PLACE (expect PASS)");
  if (verdict !== "PASS") { console.error("\n❌ Admin overlay interactivity check FAILED with the fix in place."); process.exit(1); }
  console.log("\n✅ Admin overlay interactivity check PASSED.");
  process.exit(0);
} else {
  let previewProc;
  try {
    await withMutationOff(async () => {
      previewProc = spawn("npm", ["run", "preview", "--", "--port", "4174"], { stdio: "ignore", detached: true });
      await waitForServer("http://localhost:4174/", 15000);
      const verdict = await runOnce("http://localhost:4174/", "MUTATION — pointerEvents:'none' REMOVED (expect FAIL)");
      if (verdict !== "FAIL") {
        console.error("\n❌ MUTATION PROOF FAILED — removing the fix did not turn this check red. The check has no teeth.");
        process.exitCode = 1;
      } else {
        console.log("\n✅ Mutation proof: removing the fix correctly turns this check red.");
      }
    });
  } finally {
    if (previewProc) { try { process.kill(-previewProc.pid); } catch {} }
  }
}
