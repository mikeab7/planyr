/* verify-cursors-shared.mjs — NEW-6/NEW-7 (B2383552) cursor convention, shared-UI slice.
 * Reads getComputedStyle(elementFromPoint(centre)).cursor — the cursor the browser would paint — at named states on the
 * unauthenticated #/design gallery (every primitive lives there) plus injected probes for what the gallery cannot hold.
 *   node ui-audit/verify-cursors-shared.mjs [http://localhost:4173/ | https://planyr.io]
 * A https base signs in as the test account first (E2E_LOGIN_KEY) and reads /version.json in the SAME call as the verdict.
 * KNOWN-GOOD ARMS (expected independently of the code under test): an enabled IconButton reads pointer and the page body
 * reads default — if either is wrong the run is VOID, not scored (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:4173/";
import { existsSync } from "fs";
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(existsSync);
let browser, page, close = async () => {}, build = null;

if (/^https:\/\/planyr\.io/.test(BASE) && process.env.E2E_LOGIN_KEY) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE.replace(/\/$/, "") });
  page = s.page; close = s.close; build = s.build;
} else {
  browser = await chromium.launch({ executablePath: EXEC });
  page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  close = () => browser.close();
}

const results = [];
const check = (name, got, want) => { const ok = got === want; results.push({ name, got, want, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${got} (want ${want})`); };

try {
  await page.goto(BASE.replace(/\/?$/, "/") + "#/design", { waitUntil: "load" });
  await page.waitForSelector('button', { timeout: 20000 });
  await page.evaluate(() => document.fonts?.ready);
  await assertMeasurable(page, "verify-cursors-shared");

  if (!build) {
    try { build = await page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null)); } catch { /* none locally */ }
  }
  // Probes we control, appended to the page: the inline-pointer-on-a-disabled-control case the audit found most often.
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "cur-probes";
    box.style.cssText = "position:fixed;left:8px;top:8px;z-index:2147483647;display:flex;gap:8px;background:#fff;padding:6px";
    const mk = (id, html) => { const w = document.createElement("span"); w.id = id; w.innerHTML = html; box.appendChild(w); };
    mk("p-dis-inline", '<button disabled style="cursor:pointer;width:60px;height:24px">dis</button>');
    mk("p-busy", '<button disabled aria-busy="true" style="cursor:pointer;width:60px;height:24px">busy</button>');
    mk("p-enabled", '<button style="cursor:pointer;width:60px;height:24px">on</button>');
    mk("p-link", '<a href="#x" style="display:inline-block;width:40px;height:24px">lnk</a>');
    mk("p-check", '<input type="checkbox" style="width:20px;height:20px">');
    mk("p-check-dis", '<input type="checkbox" disabled style="width:20px;height:20px">');
    mk("p-select", '<select style="width:60px;height:24px"><option>a</option></select>');
    mk("p-range", '<input type="range" style="width:80px;height:20px">');
    mk("p-text", '<span style="display:inline-block;width:40px;height:24px">txt</span>');
    document.body.appendChild(box);
  });
  const cursorAt = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return "MISSING";
    el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return hit ? getComputedStyle(hit).cursor : "NOHIT";
  }, sel);

  // Known-good arms.
  const goodBtn = await cursorAt("#p-link a"); // UA default for a link: pointer, independent of app code
  const goodBody = await page.evaluate(() => getComputedStyle(document.body).cursor);
  if (goodBtn !== "pointer" || goodBody !== "auto" && goodBody !== "default") {
    console.error(`VOID: known-good arms disagree (link=${goodBtn}, body=${goodBody}) — the instrument cannot see cursors`);
    process.exit(2);
  }
  check("link (known-good)", goodBtn, "pointer");
  check("enabled button with inline pointer", await cursorAt("#p-enabled button"), "pointer");
  check("inline pointer on a DISABLED button does not survive", await cursorAt("#p-dis-inline button"), "default");
  check("disabled + aria-busy button shows progress", await cursorAt("#p-busy button"), "progress");
  check("enabled checkbox", await cursorAt("#p-check input"), "pointer");
  check("disabled checkbox", await cursorAt("#p-check-dis input"), "default");
  check("enabled select", await cursorAt("#p-select select"), "pointer");
  check("enabled range", await cursorAt("#p-range input"), "pointer");
  check("plain text", await cursorAt("#p-text span"), "auto");

  // Real primitives on the gallery. Hide the probe bar so it never covers a specimen.
  await page.evaluate(() => { document.getElementById("cur-probes").style.display = "none"; });
  const specimens = await page.evaluate(() => [...document.querySelectorAll("button")].map((b, i) => ({ i, dis: b.disabled, label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24) })));
  const cursorOfButton = async (pred) => {
    const idx = specimens.find(pred)?.i; if (idx == null) return "NOSPECIMEN";
    return page.evaluate((i) => { const b = document.querySelectorAll("button")[i]; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit ? getComputedStyle(hit).cursor : "NOHIT"; }, idx);
  };
  check("IconButton disabled specimen", await cursorOfButton((s) => s.label === "Disabled specimen"), "default");
  check("ToggleChip disabled specimen", await cursorOfButton((s) => s.dis && s.label === "Off"), "default");
  check("IconButton enabled specimen", await cursorOfButton((s) => !s.dis && s.label === "★"), "pointer");
  check("ToggleChip enabled specimen", await cursorOfButton((s) => !s.dis && s.label === "Off"), "pointer");
  await page.evaluate(() => { const d = [...document.querySelectorAll("div")].find((n) => n.textContent === "Body content goes here." && !n.children.length); if (d) d.id = "p-body"; });
  check("gallery click-to-collapse body", await cursorAt("#p-body"), "pointer");
} catch (e) { console.error("ERROR", e.message); results.push({ ok: false }); }
const failed = results.filter((r) => !r.ok).length;
console.log(`\nbuild: ${JSON.stringify(build)}\n${failed ? `FAIL ${failed}` : "PASS"} (${results.length} checks)`);
await close();
process.exit(failed ? 1 : 0);
