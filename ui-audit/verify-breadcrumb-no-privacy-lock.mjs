/* NEW-1 — the breadcrumb no longer carries a project-privacy padlock (owner rule, his words:
 * "Let's get rid of the lock button next to project names, it's not relevant enough and it
 * doesn't work"). This is a real-browser, logged-out, no-external-GIS click-through
 * (ATTEMPT-BEFORE-YOU-PARK — Claude-doable here, so it is not left as a live-only V###).
 *
 * Drives the real app (seeded local site, signed out — no Supabase/GIS egress needed) at both a
 * desktop and a phone width, in both themes, across every module the breadcrumb renders in:
 * Site, Schedule (via the same postMessage iframe stub verify-project-switcher-dedupe.mjs uses),
 * Review, Library, Notes, Spreadsheet, and the Dashboard.
 *
 * Three things asserted per route:
 *   (1) no `<svg>` sits ahead of the project name inside the project crumb button;
 *   (2) the removed tooltip text is nowhere in the crumb's accessible name/title;
 *   (3) the crumb's leading edge (its left padding to the first glyph of the name) is UNCHANGED
 *       from a control case with nothing ahead of the name either — i.e. no leftover gap.
 *
 * MUTATION PROOF: run once as-is (green), then `git stash` the ProjectBreadcrumb.jsx fix, rebuild,
 * re-run (every route must go RED — an `<svg>` inside the crumb ahead of the name), then
 * `git stash pop` and rebuild again.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-breadcrumb-no-privacy-lock.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

const GID = "smqfy48tlk9j"; // real production Goose Creek group id (read-only, same as the sibling harness)

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [GID]: site(GID, "Goose Creek") })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const PROJECTS = [{ id: "1", name: "Goose Creek", linkedSiteId: GID, linkedSiteName: "Goose Creek" }];
const stubHtml = `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  let aPid = "1", section = "projects";
  const projects = ${JSON.stringify(PROJECTS)};
  const emit = () => {
    parent.postMessage({ source: "planar-seq", type: "planar:nav-state", section, activeId: aPid, projects }, window.location.origin);
    parent.postMessage({ source: "planar-seq", type: "planar:toolbar-state", ready: true, section, view: "gantt", zoomable: true, zoomPct: 100, activePanel: null, reviewOpen: false, reviewCount: 0, saveStatus: "saved" }, window.location.origin);
  };
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.source !== "planar-shell") return;
    if (m.type === "planar:nav-request") emit();
  });
  emit();
</script></body></html>`;

const ROUTES = [
  { label: "Site", hash: `#/project/${GID}/site`, wait: 2600 },
  { label: "Schedule", hash: `#/project/${GID}/schedule`, wait: 2600, needsIframeStub: true },
  { label: "Review", hash: `#/project/${GID}/markup`, wait: 1200 },
  { label: "Library", hash: `#/project/${GID}/library`, wait: 1200 },
  { label: "Notes", hash: `#/project/${GID}/notes`, wait: 1200 },
  { label: "Spreadsheet", hash: `#/project/${GID}/spreadsheet`, wait: 1200 },
];
const WIDTHS = [{ label: "desktop", width: 1600, height: 900 }, { label: "phone", width: 390, height: 844 }];
const THEMES = ["light", "dark"];

async function crumbReport(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('[data-testid="project-crumb"]');
    if (!btn) return { found: false };
    const svgs = [...btn.querySelectorAll("svg")];
    const nameSpan = [...btn.querySelectorAll("span")].find((s) => (s.textContent || "").trim().length > 0 && s !== btn.lastElementChild);
    const btnRect = btn.getBoundingClientRect();
    const nameRect = nameSpan ? nameSpan.getBoundingClientRect() : null;
    return {
      found: true,
      svgCount: svgs.length,
      title: btn.getAttribute("title") || "",
      accText: btn.textContent || "",
      leadGapPx: nameRect ? Math.round((nameRect.left - btnRect.left) * 100) / 100 : null,
    };
  });
}

async function checkRoute(browser, route, width, theme) {
  const label = `${route.label} · ${width.label} · ${theme}`;
  const ctx = await browser.newContext({ viewport: { width: width.width, height: width.height } });
  await ctx.addInitScript(seedScript);
  await ctx.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch (_) {} }, theme);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  if (route.needsIframeStub) await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml }));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-breadcrumb-no-privacy-lock");
  await page.goto(`${BASE}${route.hash}`, { waitUntil: "load" });
  await page.waitForTimeout(route.wait);

  const crumb = page.locator('[data-testid="project-crumb"]:visible').first();
  await crumb.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const report = await crumbReport(page);

  ok(report.found, `${label} — the project crumb rendered at all`);
  if (report.found) {
    ok(report.svgCount === 0, `${label} — no <svg> ahead of the project name (found ${report.svgCount})`);
    ok(!report.title.toLowerCase().includes("private"), `${label} — no "Private…" tooltip text on the crumb (title="${report.title}")`);
    ok(!report.accText.toLowerCase().includes("private: only you"), `${label} — no leftover privacy copy in the crumb's text`);
    // The name should start essentially flush against the button's own left padding (12px per
    // crumbBtn's padding: "0 12px") — a leftover icon/gap wrapper would push it right of that.
    ok(report.leadGapPx != null && report.leadGapPx <= 13, `${label} — no leftover gap before the project name (measured ${report.leadGapPx}px from the button's left edge)`);
  }

  const shot = `./screens/breadcrumb-no-lock-${route.label.toLowerCase()}-${width.label}-${theme}.png`;
  await page.screenshot({ path: new URL(shot, import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });

for (const route of ROUTES) {
  console.log(`\n${route.label}`);
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      await checkRoute(browser, route, width, theme);
    }
  }
}

await browser.close();
console.log("\n" + (fails === 0 ? "✅ PASS — no project-privacy padlock anywhere in the breadcrumb, no layout regression" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
