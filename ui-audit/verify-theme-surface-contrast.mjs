/* Theme-surface contrast sweep (B1998016) — "white input with white text" bug class.
 *
 * Extends contrast-sweep.mjs (text nodes only) to FORM CONTROLS: an <input>/<select>/<textarea>
 * has no direct text node, so the old sweep never saw a control whose typed value was near-white on
 * the browser's default white fill (Settings > Profile in dark mode, iOS Safari). For every visible
 * text-bearing element AND every visible control it computes the WCAG ratio of the computed text
 * colour against the effective background (first ancestor with a >=50%-opaque fill) and fails under
 * 4.5:1 (3:1 for large/bold text). Also asserts the form control's own `color-scheme` follows theme.
 *

 * DRAWINGS-LOADED states (real PDFs in Review + the Stitcher, popups, parcel card) run after the sweep; a state that
 * cannot be driven FAILS the run. Flags: --drawings-only, --no-drawings, --report, --shots.
 * Runs both themes × phone + desktop viewports × signed-out states (sign-in form, every workspace,
 * settings popover, project menu) AND a signed-in fixture (Settings: Profile/Team/Account/Interface)
 * using ui-audit/lib/authRemount.mjs (no real account; hermetic).
 *
 * Run: VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npm run build
 *      node ui-audit/verify-theme-surface-contrast.mjs [--shots]     (serves dist/ itself)
 * `--report` prints failures but exits 0 (used to capture the BEFORE list).
 */
import { chromium } from "playwright";
import { buildSync } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { AUTH_FIXTURE, authSessionSeed, detectSupabase, supabaseRouteHandler } from "./lib/authRemount.mjs";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const OUT = fileURLToPath(new URL("./screens/", import.meta.url));
const SHOTS = process.argv.includes("--shots");
const REPORT_ONLY = process.argv.includes("--report");
if (SHOTS) mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, "index.html"))) { console.error("no dist/ — run npm run build first"); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0].split("#")[0];
  let p = join(DIST, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) p = join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const SB = detectSupabase(DIST);

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const demoSite = { id: "d", groupId: "d", site: "Katy Logistics Park", name: "Plan 1", status: "active", origin: null, county: null, parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const seed = (theme, signedIn) => `(() => { try {
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
  var s = JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })});
  localStorage.setItem('planarfit:sites:v1', s);
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
  ${signedIn ? `localStorage.setItem('planarfit:sites:cloud:${AUTH_FIXTURE.uid}', s);` : ""}
} catch (e) {} })();`;

const PROBE = `(() => {
  const lum = (r,g,b) => { const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = (s) => { const m=(s||'').match(/rgba?\\(([^)]+)\\)/); if(!m) return null; const p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p[3]==null?1:p[3]}; };
  const over = (fg,bg) => ({ r: Math.round(fg.r*fg.a+bg.r*(1-fg.a)), g: Math.round(fg.g*fg.a+bg.g*(1-fg.a)), b: Math.round(fg.b*fg.a+bg.b*(1-fg.a)), a:1 });
  const bgOf = (el) => { let e=el; while(e){ const cs=getComputedStyle(e); const c=parse(cs.backgroundColor); if(c&&c.a>=0.5) return c; if(cs.backgroundImage && cs.backgroundImage!=='none') return null; e=e.parentElement; } return null; };
  const ratio = (fg,bg) => { const a=lum(fg.r,fg.g,fg.b),b=lum(bg.r,bg.g,bg.b); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); };
  const pathOf = (el) => { const seg=[]; let e=el, n=0; while(e && e.nodeType===1 && n<4){ let s=e.tagName.toLowerCase(); if(e.id) s+='#'+e.id; else if(typeof e.className==='string'&&e.className.trim()) s+='.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'); seg.unshift(s); e=e.parentElement; n++; } return seg.join(' > '); };
  const hasDirectText = (el) => { for (const n of el.childNodes) if (n.nodeType===3 && n.textContent.trim().length) return true; return false; };
  const isControl = (el) => { const t=el.tagName; if(t==='SELECT'||t==='TEXTAREA') return true; if(t!=='INPUT') return false; return !['checkbox','radio','range','color','file','hidden','button','submit','reset','image'].includes((el.type||'text').toLowerCase()); };
  const out = []; const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const tag = el.tagName.toLowerCase();
    const ctl = isControl(el);
    if (!ctl && !hasDirectText(el)) continue;
    if (['script','style','svg','path','noscript','option'].includes(tag)) continue;
    if (el.closest('.leaflet-container, canvas, [data-paper], [data-theme-exempt]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility==='hidden' || cs.display==='none' || +cs.opacity===0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width<2 || rect.height<2) continue;
    if (rect.bottom<0 || rect.right<0 || rect.top>innerHeight || rect.left>innerWidth) continue;
    // SVG text paints with fill, not the CSS color property (inherited and unused) — measure what is painted.
    // A haloed label (paint-order stroke in a contrasting colour) carries its own backing — its fill vs the mat behind is not the pair a viewer reads.
    if (el instanceof SVGElement && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) continue;
    let fg = parse(el instanceof SVGElement ? cs.fill : cs.color); if (!fg) continue;
    const bg = bgOf(el); if (!bg) continue;
    if (fg.a<1) fg = over(fg, bg);
    const r = ratio(fg, bg);
    const px = parseFloat(cs.fontSize) || 16, wt = parseInt(cs.fontWeight) || 400;
    const large = px>=24 || (px>=18.66 && wt>=700);
    const floor = large ? 3.0 : 4.5;
    const text = ctl ? ('[' + tag + (el.type?':'+el.type:'') + '] ' + (el.value || el.placeholder || el.getAttribute('aria-label') || '')).slice(0,44) : (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40);
    if (!text) continue;
    if (r >= floor - 0.05) continue;
    const key = pathOf(el)+'|'+text; if (seen.has(key)) continue; seen.add(key);
    out.push({ ratio:+r.toFixed(2), floor, px:+px.toFixed(1), wt, text, ctl, path: pathOf(el), fg:[fg.r,fg.g,fg.b], bg:[bg.r,bg.g,bg.b] });
  }
  return out.sort((a,b)=>a.ratio-b.ratio);
})()`;

const EXEC = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors"] });
const hex = ([r, g, b]) => "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
const all = [];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

async function run(theme, vpName, signedIn) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName], deviceScaleFactor: 1, hasTouch: vpName === "phone", isMobile: vpName === "phone" });
  await ctx.route("**", supabaseRouteHandler({ base: BASE, supabaseUrl: SB.url, liveSites: [] }));
  await ctx.addInitScript(seed(theme, signedIn));
  if (signedIn) await ctx.addInitScript(authSessionSeed({ ref: SB.ref, url: SB.url }));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-theme-surface-contrast");
  const tag = `${signedIn ? "in" : "out"}/${theme}/${vpName}`;
  const states = [];
  const grab = async (label) => {
    await page.waitForTimeout(500);
    const res = await page.evaluate(PROBE);
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    states.push({ label, res, scheme });
    if (SHOTS) await page.screenshot({ path: OUT + `theme-${tag.replace(/\//g, "-")}-${label}.png` });
  };
  const go = async (hash) => { await page.goto(BASE + hash, { waitUntil: "load" }); await page.waitForTimeout(1500); };
  const tryDo = async (label, fn) => { try { await fn(); await grab(label); } catch (e) { states.push({ label, res: [], skipped: String(e.message).split("\n")[0] }); } };

  await go("");
  await tryDo("planner", async () => {});
  if (!signedIn) {
    await tryDo("signin-form", async () => { await page.click('[data-testid="account-signed-out"]', { timeout: 3000 }); await page.waitForTimeout(400); });
    await go("");
    await tryDo("signup-form", async () => { await page.click('[data-testid="account-signed-out"]', { timeout: 3000 }); await page.getByText(/create (an )?account|sign up/i).first().click({ timeout: 2000 }); });
    await go("");
    await tryDo("settings-popover", async () => { await page.click('button[aria-label="Settings"]', { timeout: 3000 }); });
  } else {
    for (const [i, name] of [[0, "Profile"], [1, "Team"], [2, "Account"], [3, "Interface"]]) {
      await go("");
      await tryDo("settings-" + name.toLowerCase(), async () => {
        await page.click('button[title^="Signed in as"]', { timeout: 4000 });
        await page.getByRole("button", { name: i === 3 ? /^Settings/ : /^Profile/ }).first().click({ timeout: 2000 });
        await page.waitForTimeout(500);
        if (i > 0) await page.getByRole("button", { name: name === "Account" ? /Account & security/ : new RegExp("^" + name) }).first().click({ timeout: 2000 });
      });
    }
  }
  for (const [label, hash] of [["review", "#/markup"], ["library", "#/library"], ["schedule", "#/schedule"], ["notes", "#/notes"], ["spreadsheet", "#/spreadsheet"]]) {
    await go(hash);
    await tryDo(label, async () => {});
  }
  await go("#/site");
  await tryDo("project-menu", async () => { await page.click('[data-testid="project-crumb"]', { timeout: 2500 }); });
  await go("#/");
  await tryDo("finder", async () => {});
  await tryDo("finder-projectmenu", async () => { await page.click('[data-testid="project-crumb"]', { timeout: 2000 }); });
  await ctx.close();
  console.log(`  ${tag}: ${states.filter((s) => !s.skipped).length} states probed${states.some((s) => s.skipped) ? " · skipped: " + states.filter((s) => s.skipped).map((s) => s.label + " (" + s.skipped.slice(0, 70) + ")").join("; ") : ""}`);
  for (const s of states) for (const f of s.res) all.push({ tag, theme, state: s.label, ...f });
  return states;
}


/* ── Drawings loaded (B-follow-up to B1998016) ─────────────────────────────────────────────────
 * The state sweep above never loads a drawing, so Review's popups and the whole Stitcher (sheet
 * list, calibrate popup, Details panel) were never rendered. This drives the REAL UI with a real
 * PDF in both themes. Fixtures: e2e/fixtures/sample.pdf for Review; a generated multi-page civil
 * set (same shape as verify-stitch-bugs.mjs) for the Stitcher so it groups into a plan. */
const SW = 1224, SH = 792;
const SHEETS = [{ title: "COVER SHEET" }, { title: "GRADING PLAN", number: "C-5", rightRef: "C-6" }, { title: "GRADING PLAN", number: "C-6", leftRef: "C-5", rightRef: "C-7" }, { title: "GRADING PLAN", number: "C-7", leftRef: "C-6" }];
function stitchPdf() {
  const N = SHEETS.length, fontNum = 3 + 2 * N, o = [];
  o[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  o[2] = `<< /Type /Pages /Kids [${SHEETS.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${N} >>`;
  SHEETS.forEach((sp, i) => {
    const L = []; const T = (z, x, y, t) => L.push(`BT /F1 ${z} Tf ${x} ${y} Td (${t}) Tj ET`);
    T(20, 990, SH - 130, sp.title);
    if (sp.number) { T(11, 990, SH - 162, `SHEET NO. ${sp.number}`); T(11, 990, SH - 186, `SCALE: 1"=40'`); T(12, 150, SH - 220, "PROPOSED GRADING"); }
    T(11, 990, SH - 210, "PROJECT KATY GRAND");
    if (sp.number === "C-5") T(14, 300, 500, "5/C-7"); // inline detail callout → a clickable hotspot → the fixed detail popover
    if (sp.leftRef) T(13, 110, SH / 2, `MATCH LINE - SEE SHEET ${sp.leftRef}`);
    if (sp.rightRef) T(13, 720, SH / 2, `MATCH LINE - SEE SHEET ${sp.rightRef}`);
    const st = L.join("\n");
    o[3 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SW} ${SH}] /Resources << /Font << /F1 ${fontNum} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${4 + 2 * i} 0 R >>`;
    o[4 + 2 * i] = `<< /Length ${Buffer.byteLength(st, "latin1")} >>\nstream\n${st}\nendstream`;
  });
  o[fontNum] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n"; const off = [];
  for (let i = 1; i < o.length; i++) { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${o.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < o.length; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${o.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const STITCH_PDF = { name: "katy-grand-civil.pdf", mimeType: "application/pdf", buffer: stitchPdf() };
const REVIEW_PDF = fileURLToPath(new URL("../e2e/fixtures/sample.pdf", import.meta.url));

/* Site: the ParcelInfoCard notice strips ("Statewide backup", "Cached copy") only appear after an address
 * search that hits a GIS host, which the sandbox blocks. So the REAL component is bundled with esbuild and
 * mounted into the built app's page — real index.css tokens, real data-theme — with `backup` + `cached` set. */
const CARD_JS = buildSync({
  stdin: {
    contents: `import React from "react"; import { createRoot } from "react-dom/client";
      import ParcelInfoCard from "./src/workspaces/site-planner/components/ParcelInfoCard.jsx";
      window.__mountParcelCard = () => { const d = document.createElement("div"); d.id = "audit-parcel-card"; d.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none"; document.body.appendChild(d);
        createRoot(d).render(React.createElement(ParcelInfoCard, { info: { status: "found", backup: "Harris", cached: { asOf: null }, addr: "1234 Industrial Pkwy", acct: "R0041234", acres: 41.72, attrs: { owner_name: "ACME INDUSTRIAL PARTNERS LP", situs_addr: "1234 INDUSTRIAL PKWY", prop_id: "R0041234", legal_area: 41.72, zoning: "I-2" } }, narrow: innerWidth < 600, onDismiss() {}, onPlan() {} })); };`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "jsx", sourcefile: "audit-entry.jsx",
  },
  bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent",
}).outputFiles[0].text;

/* A drawing-loaded state that a person on that viewport genuinely cannot reach (measured, not assumed) is DECLARED
 * here and printed — never a silent skip. Any other skipped state fails the run: a sweep that quietly probed less
 * than it claims is the vacuous-green failure this harness exists to avoid. */
const PHONE_UNREACHABLE = [];
async function runDrawings(theme, vpName) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName], deviceScaleFactor: 1, hasTouch: vpName === "phone", isMobile: vpName === "phone" });
  await ctx.route("**", supabaseRouteHandler({ base: BASE, supabaseUrl: SB.url, liveSites: [] }));
  await ctx.addInitScript(seed(theme, false));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-theme-surface-contrast");
  const tag = `drawings/${theme}/${vpName}`;
  const states = [];
  const grab = async (label) => {
    await page.waitForTimeout(500);
    const res = await page.evaluate(PROBE);
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    states.push({ label, res, scheme, probed: true });
    if (SHOTS) await page.screenshot({ path: OUT + `theme-${tag.replace(/\//g, "-")}-${label}.png` });
  };
  const tryDo = async (label, fn) => { try { if ((await fn()) === "unreachable") { states.push({ label, res: [], unreachable: true }); return; } await grab(label); } catch (e) { states.push({ label, res: [], skipped: String(e.message).split("\n")[0] }); if (process.env.DBG_SHOTS) await page.screenshot({ path: process.env.DBG_SHOTS + `/skip-${tag.replace(/\//g, "-")}-${label}.png` }).catch(() => {}); } };
  const need = (ok, what) => { if (!ok) throw new Error("precondition: " + what); };
  const go = async (hash) => { await page.goto(BASE + hash, { waitUntil: "load" }); await page.waitForTimeout(1500); };
  /* Two points on the Stitcher canvas that a human could really click — on a phone the tray and Details panel
     cover most of it, so a bbox-fraction lands on a panel. Hit-test with elementFromPoint. */
  const canvasPair = () => page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")); if (!svg) return null;
    const r = svg.getBoundingClientRect(); const ok = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && svg.contains(e); };
    const x0 = Math.max(r.left, 0) + 6, x1 = Math.min(r.right, innerWidth) - 6;
    for (let y = r.top + r.height * 0.5; y < Math.min(r.bottom, innerHeight) - 6; y += 12) {
      let a = null, b = null; for (let x = x0; x <= x1; x += 4) if (ok(x, y)) { if (a == null) a = x; b = x; }
      if (a != null && b - a >= 14) return [{ x: a + 2, y }, { x: b - 2, y }];
    }
    return null;
  });
  const sheetBox = async (sel) => { const b = await page.locator(sel).first().boundingBox(); need(b, sel + " has a box"); return b; };

  // ── Site: parcel info card warning strips ──
  await go("#/");
  await tryDo("site-parcel-card-strip", async () => {
    await page.addScriptTag({ content: CARD_JS });
    await page.evaluate(() => window.__mountParcelCard());
    const strip = page.getByText(/Statewide backup/).first();
    await strip.waitFor({ timeout: 5000 });
    const sb = await strip.boundingBox(); need(sb && sb.width >= 150 && sb.x >= 0 && sb.x + sb.width <= VIEWPORTS[vpName].width, "the warning strip is really on screen at a readable width"); // known-good arm: not a zero-size mount
  });

  // ── Review: real drawing loaded ──
  await go("#/markup");
  await tryDo("review-loaded", async () => {
    await page.setInputFiles('input[type="file"]', REVIEW_PDF, { timeout: 8000 });
    await page.waitForSelector('[data-testid="review-sheet"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="sheet-rail"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (vpName === "phone") { await page.locator('[data-testid="sheet-rail-collapse"]').first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); } // a person collapses the rail to see the sheet
    await page.locator('[data-testid="tool-fitW"]').first().click({ timeout: 3000 }).catch(() => {}); // phone opens tiny; fit to width like a person would
    await page.waitForTimeout(500);
  });
  await tryDo("review-calibrate-popup", async () => {
    await page.getByRole("button", { name: /^Calibrate$/ }).first().click({ timeout: 4000 });
    const b = await sheetBox('[data-testid="review-sheet"]');
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.4);
    await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.4);
    await page.waitForSelector('input[placeholder*="38"]', { timeout: 4000 });
  });
  await page.keyboard.press("Escape");
  await tryDo("review-text-edit", async () => {
    // Placing a Text markup opens the inline editor straight away — that box is the surface.
    await page.getByRole("button", { name: /^Text$/ }).first().click({ timeout: 4000 });
    const b = await sheetBox('[data-testid="review-sheet"]');
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.6);
    await page.waitForSelector('input[placeholder="Text note…"]', { timeout: 4000 });
    await page.keyboard.type("Sample note");
  });
  await tryDo("review-text-reedit", async () => {
    // Commit (blur onto the Select tool), then double-click the placed note to re-open the editor.
    await page.getByRole("button", { name: /^Select$/ }).first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    const nb = await page.locator('[data-testid="markup-overlay"] text', { hasText: "Sample note" }).first().boundingBox(); need(nb, "the placed note has a box");
    const nx = nb.x + nb.width / 2, ny = nb.y + nb.height / 2;
    await page.mouse.click(nx, ny); // select it first — an already-selected text note edits on double-click
    await page.mouse.dblclick(nx, ny);
    await page.waitForSelector('input[placeholder="Text note…"]', { timeout: 4000 });
  });

  // ── Stitcher: multi-page set, sheets placed, popups ──
  await go("#/markup");
  await tryDo("stitch-empty", async () => {
    await page.getByRole("button", { name: /Stitch/ }).first().click({ timeout: 6000 });
    await page.getByText(/Drop a whole set/i).waitFor({ timeout: 8000 });
  });
  await tryDo("stitch-tray", async () => {
    await page.setInputFiles('input[type="file"]', STITCH_PDF, { timeout: 8000 });
    await page.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 });
  });
  await tryDo("stitch-tray-allpages", async () => {
    await page.getByRole("button", { name: /^all pages$/ }).first().click({ timeout: 4000 });
    await page.locator('[data-testid="stitch-tray-row"]', { hasText: /p2$/ }).first().waitFor({ timeout: 6000 });
  });
  await tryDo("stitch-placed-unaligned", async () => {
    // Two raw pages: the first is the world frame, the second arrives un-aligned → "Not aligned" + Align/Remove.
    await page.locator('[data-testid="stitch-tray-row"]', { hasText: /p2$/ }).first().click({ timeout: 6000 });
    await page.waitForSelector('[data-testid="stitch-placed-name"]', { timeout: 20000 });
    await page.locator('[data-testid="stitch-tray-row"]', { hasText: /p3$/ }).first().click({ timeout: 6000 });
    await page.getByText(/Not aligned/).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
  });
  await tryDo("stitch-detail-popover", async () => {
    await page.getByRole("button", { name: /^Pan$/ }).first().click({ timeout: 4000 }).catch(() => {});
    // dispatched in-page: on a phone the panels cover the bubble, and a driver click would hit them instead
    await page.waitForSelector('svg circle[stroke="#1d4ed8"]', { timeout: 6000 });
    await page.evaluate(() => { const g = document.querySelector('svg circle[stroke="#1d4ed8"]').parentNode; g.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: Math.round(innerWidth / 2), clientY: Math.round(innerHeight / 3) })); });
    await page.getByText(/Detail 5/).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(800);
  });
  await page.keyboard.press("Escape");
  await tryDo("stitch-calibrate-popup", async () => {
    await page.getByRole("button", { name: /^Calibrate$/ }).first().click({ timeout: 4000 });
    let pr = await canvasPair();
    if (!pr) { // phone: the tray + Details panel cover the canvas — a person would close Details first
      await page.getByRole("button", { name: /Details/ }).first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); pr = await canvasPair();
    }
    if (!pr && vpName === "phone") { PHONE_UNREACHABLE.push(`${theme}/phone/stitch-calibrate-popup`); return "unreachable"; }
    need(pr, "two clickable points on the Stitcher canvas");
    await page.mouse.click(pr[0].x, pr[0].y);
    await page.mouse.click(pr[1].x, pr[1].y);
    await page.waitForSelector('input[placeholder*="38"]', { timeout: 4000 });
  });
  await page.keyboard.press("Escape");
  await tryDo("stitch-group-placed", async () => {
    // Clear the canvas, then place the auto-stitched group (Composite key + Details + "Calibrated").
    for (let i = 0; i < 6; i++) { const rm = page.getByRole("button", { name: /^Remove$/ }).first(); if (!(await rm.count())) break; await rm.click({ timeout: 3000 }); await page.waitForTimeout(250); }
    await page.getByRole("button", { name: /^grouped$/ }).first().click({ timeout: 4000 });
    await page.locator('[data-testid="stitch-tray-row"]', { hasText: /auto-stitch/ }).first().click({ timeout: 6000 });
    await page.getByText(/Scale set/).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
  });
  await page.keyboard.press("Escape");
  await ctx.close();
  console.log(`  ${tag}: ${states.filter((s) => !s.skipped).length} states probed${states.some((s) => s.skipped) ? " · SKIPPED: " + states.filter((s) => s.skipped).map((s) => s.label + " (" + s.skipped.slice(0, 80) + ")").join("; ") : ""}`);
  for (const s of states) for (const f of s.res) all.push({ tag, theme, state: s.label, ...f });
  return states;
}

const schemeBad = [];
if (!process.argv.includes("--drawings-only")) for (const theme of ["dark", "light"]) for (const vp of ["phone", "desktop"]) for (const signedIn of [false, true]) {
  const st = await run(theme, vp, signedIn);
  if (st.some((s) => s.scheme && s.scheme !== theme && !s.skipped)) schemeBad.push(`${signedIn ? "in" : "out"}/${theme}/${vp}: color-scheme=${st.find((s) => s.scheme)?.scheme}`);
}
const DRAWING_SKIPS = [];
if (!process.argv.includes("--no-drawings")) for (const theme of (process.env.ONLY_THEME ? [process.env.ONLY_THEME] : ["dark", "light"])) for (const vp of (process.env.ONLY_VP ? [process.env.ONLY_VP] : ["phone", "desktop"])) {
  const st = await runDrawings(theme, vp);
  for (const s of st) if (s.skipped) DRAWING_SKIPS.push(`${theme}/${vp}/${s.label}: ${s.skipped}`);
}
await browser.close(); server.close();

const uniq = []; const seen = new Set();
for (const f of all.sort((a, b) => a.ratio - b.ratio)) {
  const k = f.theme + "|" + f.path + "|" + f.text; if (seen.has(k)) continue; seen.add(k); uniq.push(f);
}
if (PHONE_UNREACHABLE.length) console.log(`ℹ declared unreachable on a phone (Stitcher canvas fully covered by the sheet tray + Details panel — same popup is exercised on desktop): ${[...new Set(PHONE_UNREACHABLE)].join(", ")}`);
if (DRAWING_SKIPS.length) console.log(`✗ ${DRAWING_SKIPS.length} drawing-loaded state(s) could not be driven — the sweep probed less than it claims:\n  ${DRAWING_SKIPS.join("\n  ")}`);
if (schemeBad.length) console.log(`✗ <html> color-scheme does not follow the theme:\n  ${schemeBad.join("\n  ")}`);
if (!uniq.length && !schemeBad.length && !DRAWING_SKIPS.length) console.log("✓ No low-contrast text or form control in any state, either theme, phone or desktop.");
else if (uniq.length) {
  console.log(`✗ ${uniq.length} low-contrast element(s):\n`);
  for (const f of uniq) {
    console.log(`  [${f.tag}/${f.state}] ${String(f.ratio).padStart(5)} (need ≥${f.floor})  "${f.text}"`);
    console.log(`        ${f.px}px/${f.wt}  text ${hex(f.fg)} on ${hex(f.bg)}  ·  ${f.path}`);
  }
}
process.exit(REPORT_ONLY || (!uniq.length && !schemeBad.length && !DRAWING_SKIPS.length) ? 0 : 1);
