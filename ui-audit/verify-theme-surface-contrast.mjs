/* Theme-surface contrast sweep (B1998016) — "white input with white text" bug class.
 *
 * Extends contrast-sweep.mjs (text nodes only) to FORM CONTROLS: an <input>/<select>/<textarea>
 * has no direct text node, so the old sweep never saw a control whose typed value was near-white on
 * the browser's default white fill (Settings > Profile in dark mode, iOS Safari). For every visible
 * text-bearing element AND every visible control it computes the WCAG ratio of the computed text
 * colour against the effective background (first ancestor with a >=50%-opaque fill) and fails under
 * 4.5:1 (3:1 for large/bold text). Also asserts the form control's own `color-scheme` follows theme.
 *
 * Runs both themes × phone + desktop viewports × signed-out states (sign-in form, every workspace,
 * settings popover, project menu) AND a signed-in fixture (Settings: Profile/Team/Account/Interface)
 * using ui-audit/lib/authRemount.mjs (no real account; hermetic).
 *
 * Run: VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npm run build
 *      node ui-audit/verify-theme-surface-contrast.mjs [--shots]     (serves dist/ itself)
 * `--report` prints failures but exits 0 (used to capture the BEFORE list).
 */
import { chromium } from "playwright";
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

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
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
    let fg = parse(cs.color); if (!fg) continue;
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

const schemeBad = [];
for (const theme of ["dark", "light"]) for (const vp of ["phone", "desktop"]) for (const signedIn of [false, true]) {
  const st = await run(theme, vp, signedIn);
  if (st.some((s) => s.scheme && s.scheme !== theme && !s.skipped)) schemeBad.push(`${signedIn ? "in" : "out"}/${theme}/${vp}: color-scheme=${st.find((s) => s.scheme)?.scheme}`);
}
await browser.close(); server.close();

const uniq = []; const seen = new Set();
for (const f of all.sort((a, b) => a.ratio - b.ratio)) {
  const k = f.theme + "|" + f.path + "|" + f.text; if (seen.has(k)) continue; seen.add(k); uniq.push(f);
}
if (schemeBad.length) console.log(`✗ <html> color-scheme does not follow the theme:\n  ${schemeBad.join("\n  ")}`);
if (!uniq.length && !schemeBad.length) console.log("✓ No low-contrast text or form control in any state, either theme, phone or desktop.");
else if (uniq.length) {
  console.log(`✗ ${uniq.length} low-contrast element(s):\n`);
  for (const f of uniq) {
    console.log(`  [${f.tag}/${f.state}] ${String(f.ratio).padStart(5)} (need ≥${f.floor})  "${f.text}"`);
    console.log(`        ${f.px}px/${f.wt}  text ${hex(f.fg)} on ${hex(f.bg)}  ·  ${f.path}`);
  }
}
process.exit(REPORT_ONLY || (!uniq.length && !schemeBad.length) ? 0 : 1);
