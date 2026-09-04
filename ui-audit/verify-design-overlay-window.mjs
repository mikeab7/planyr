/* verify-design-overlay-window.mjs — B1154242 (NEW-3), extending the B1154241 (NEW-2) admin
 * overlay check to the `#/design` gallery, which shares the exact copy-pasted overlay shape
 * (Shell.jsx's `isDesignHash` wrapper, `position:absolute; inset:0; zIndex:1`, PR #1251).
 *
 * ── WHAT WAS MEASURED, NOT ASSUMED ────────────────────────────────────────────────────────
 * Unlike `#/admin`, `#/design` is not access-gated: once its lazy chunk (`DesignGallery-*.js`)
 * loads, `DesignGallery` renders via `createPortal(..., document.body)` — a real DOM escape
 * from this wrapper, done originally to dodge z-index stacking (see that component's own
 * header) — so it is never a DOM descendant of the wrapper and never inherits its
 * `pointer-events`. So the exposure here is narrower than #/admin's: only the
 * `<Suspense fallback={null}>` GAP while the chunk is still loading. Measured by intercepting
 * the chunk request and holding it open for a few seconds: with the wrapper's
 * `pointerEvents: "none"` REMOVED, that window is genuinely inert (bare `<div>` hit, 0-byte
 * `main.innerHTML` delta on click) — exactly the #/admin defect, just time-bounded rather than
 * permanent. B1154242 added `pointerEvents: "none"` to the wrapper (Shell.jsx) — ONE line, not
 * two, because the portal already escapes it; verified separately that DesignGallery stays
 * fully click-interactive after mount (a real click on its "Dark" toggle chip still flips
 * `data-theme`), so the fix costs nothing on the working half.
 *
 * ── THE MUTATION PROOF, THE STANDARD NAMED IN B613762/B646272 ────────────────────────────────
 * `--mutate` temporarily removes the real `pointerEvents: "none"` source line from Shell.jsx's
 * `isDesignHash` wrapper, rebuilds, re-measures, and restores the source in a `finally` — so
 * this script can prove it goes red on the exact defect it guards, not just green on the fix.
 *
 * Run (fix in place):        node ui-audit/verify-design-overlay-window.mjs
 * Run (mutation proof, red): node ui-audit/verify-design-overlay-window.mjs --mutate
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
const HOLD_MS = 3000;

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

function describeAt(el) {
  if (!el) return "null";
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className ? `.${el.className.split(" ")[0]}` : "";
  return `${el.tagName}${id}${cls}`;
}

async function measure(base) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, bypassCSP: true });
  await ctx.addInitScript(`(() => { try { window.__PLANYR_E2E = true; } catch (e) {} })();`);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  let releaseChunk;
  const chunkHeld = new Promise((res) => { releaseChunk = res; });
  let interceptedAt = null;
  await page.route(/DesignGallery-.*\.js$/, async (route) => {
    interceptedAt = Date.now();
    await chunkHeld;
    await route.continue();
  });

  const navPromise = page.goto(`${base}#/design`, { waitUntil: "load" });
  await page.waitForTimeout(400);
  await assertMeasurable(page, "verify-design-overlay-window");
  if (!interceptedAt) await page.waitForTimeout(600);

  const mainBox = await page.evaluate(() => {
    const m = document.querySelector("main");
    const r = m.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const cx = mainBox.x + mainBox.w / 2, cy = mainBox.y + mainBox.h / 2;

  const duringHoldHit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tag: el.tagName, id: el.id || "", cls: (el.className || "").toString().split(" ")[0] || "" } : null;
  }, [cx, cy]);
  const duringHoldDesc = duringHoldHit ? `${duringHoldHit.tag}${duringHoldHit.id ? "#" + duringHoldHit.id : ""}${duringHoldHit.cls ? "." + duringHoldHit.cls : ""}` : "null";

  const beforeClick = await page.evaluate(() => document.querySelector("main").innerHTML.length);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  const afterClick = await page.evaluate(() => document.querySelector("main").innerHTML.length);
  const deltaDuringHold = afterClick - beforeClick;

  // Release the chunk and confirm DesignGallery itself still mounts and stays interactive —
  // the fix must never break the working post-mount half.
  releaseChunk();
  await navPromise;
  await page.waitForSelector('[data-testid="design-gallery"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const themeBefore = await page.evaluate(() => document.querySelector('[data-testid="design-gallery"]')?.getAttribute("data-theme") || null);
  let themeAfter = themeBefore;
  try {
    await page.getByText("Dark", { exact: true }).click({ timeout: 3000 });
    await page.waitForTimeout(200);
    themeAfter = await page.evaluate(() => document.querySelector('[data-testid="design-gallery"]')?.getAttribute("data-theme") || null);
  } catch {}
  const postMountInteractive = themeBefore != null && themeAfter === "dark" && themeAfter !== themeBefore;

  await browser.close();
  return { interceptedAt: !!interceptedAt, duringHoldDesc, deltaDuringHold, postMountInteractive, errors };
}

function reportAndVerdict(label, r) {
  console.log(`\n── ${label} ──`);
  console.log(`chunk request intercepted: ${r.interceptedAt ? "yes" : "NO — probe void"}`);
  console.log(`DURING ~${HOLD_MS}ms hold — elementFromPoint(main centre): ${r.duringHoldDesc}, main.innerHTML click delta: ${r.deltaDuringHold}`);
  console.log(`AFTER load — DesignGallery still click-interactive (Dark toggle flips data-theme): ${r.postMountInteractive}`);
  if (r.errors.length) console.log("console errors:", r.errors);

  if (!r.interceptedAt) { console.log("VERDICT: INCONCLUSIVE — chunk request never intercepted."); return "INCONCLUSIVE"; }
  const inertDuringHold = r.duringHoldDesc === "DIV" && r.deltaDuringHold === 0;
  const verdict = (!inertDuringHold && r.postMountInteractive) ? "PASS" : "FAIL";
  console.log(`VERDICT: ${verdict} — ${verdict === "PASS"
    ? "the chunk-load window is not inert (presses reach the live workspace) AND DesignGallery stays fully interactive once mounted."
    : inertDuringHold
      ? "the chunk-load window IS inert — the overlay is swallowing presses meant for the workspace underneath."
      : "DesignGallery lost post-mount interactivity — the fix broke the working half."}`);
  return verdict;
}

async function withMutationOff(fn) {
  const src = readFileSync(SHELL_PATH, "utf8");
  const needle = 'zIndex: 1, pointerEvents: "none" }}>\n            <Suspense fallback={null}>\n              {/* Not `onExit={goDashboard}`';
  const replacement = 'zIndex: 1 }}>\n            <Suspense fallback={null}>\n              {/* Not `onExit={goDashboard}`';
  if (!src.includes(needle)) throw new Error("mutation needle not found in Shell.jsx — has the #/design fix's exact text changed?");
  writeFileSync(SHELL_PATH, src.replace(needle, replacement), "utf8");
  try {
    console.log("Rebuilding with #/design wrapper's pointerEvents:'none' REMOVED (defect reintroduced)...");
    execFileSync("npm", ["run", "build"], { stdio: "inherit", env: { ...process.env, VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "", VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "" } });
    await fn();
  } finally {
    writeFileSync(SHELL_PATH, src, "utf8");
    console.log("Restored Shell.jsx to its committed state.");
  }
}

const BASE = process.env.BASE_URL || "http://localhost:4173/";

if (!MUTATE) {
  await waitForServer(BASE, 15000);
  const verdict = reportAndVerdict("FIX IN PLACE (expect PASS)", await measure(BASE));
  if (verdict !== "PASS") { console.error("\n❌ Design overlay window check FAILED with the fix in place."); process.exit(1); }
  console.log("\n✅ Design overlay window check PASSED.");
  process.exit(0);
} else {
  let previewProc;
  try {
    await withMutationOff(async () => {
      previewProc = spawn("npm", ["run", "preview", "--", "--port", "4175"], { stdio: "ignore", detached: true });
      await waitForServer("http://localhost:4175/", 15000);
      const verdict = reportAndVerdict("MUTATION — pointerEvents:'none' REMOVED (expect FAIL)", await measure("http://localhost:4175/"));
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
