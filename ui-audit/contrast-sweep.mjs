/* Whole-app runtime contrast sweep (owner-reported invisible project name, 2026-06-21).
 *
 * The static token audit (contrast-audit.mjs) only checks the token PAIRS defined in
 * index.css — it is blind to a component that hardcodes a color or passes one into a
 * style helper (the bug that hid the Site Planner's site-name button: white text passed
 * into hdrTab(), rendered on the now-light chrome). This harness instead walks the REAL
 * rendered DOM and, for EVERY visible text node, reads its computed color and the
 * effective (first opaque ancestor) background, composites any alpha, and asserts WCAG AA
 *   • normal text       ≥ 4.5
 *   • large / bold text ≥ 3.0   (≥24px, or ≥18.66px when bold)
 * in BOTH themes, across all three workspaces + a few opened menus. Exit 1 on any failure.
 *
 * Run:  VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npm run build
 *       npx vite preview --port 4173 &   then   node ui-audit/contrast-sweep.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Seed a demo site through the logged-out path so the Site Planner boots INTO a loaded
// plan — that is the only state where the header's site-name / plan-name buttons render.
const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const demoSite = { id: "d", groupId: "d", site: "Katy Logistics Park", name: "Plan 1", status: "active", origin: null, county: null, parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

const seed = (theme) => `(() => { try {
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

// In-page: walk every visible text-bearing element and measure text↔background contrast.
const PROBE = `(() => {
  const lum = (r,g,b) => { const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = (s) => { const m=(s||'').match(/rgba?\\(([^)]+)\\)/); if(!m) return null; const p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p[3]==null?1:p[3]}; };
  const over = (fg,bg) => ({ r: Math.round(fg.r*fg.a+bg.r*(1-fg.a)), g: Math.round(fg.g*fg.a+bg.g*(1-fg.a)), b: Math.round(fg.b*fg.a+bg.b*(1-fg.a)), a:1 });
  const bgOf = (el) => { let e=el; while(e){ const cs=getComputedStyle(e); const c=parse(cs.backgroundColor); if(c&&c.a>=0.5) return c; if(cs.backgroundImage && cs.backgroundImage!=='none') return null; e=e.parentElement; } return {r:255,g:255,b:255,a:1}; };
  const ratio = (fg,bg) => { const a=lum(fg.r,fg.g,fg.b),b=lum(bg.r,bg.g,bg.b); const hi=Math.max(a,b),lo=Math.min(a,b); return (hi+0.05)/(lo+0.05); };
  // A short, human-readable selector path (≤4 levels).
  const pathOf = (el) => { const seg=[]; let e=el, n=0; while(e && e.nodeType===1 && n<4){ let s=e.tagName.toLowerCase(); if(e.id) s+='#'+e.id; else if(typeof e.className==='string'&&e.className.trim()) s+='.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'); seg.unshift(s); e=e.parentElement; n++; } return seg.join(' > '); };
  const hasDirectText = (el) => { for (const n of el.childNodes) if (n.nodeType===3 && n.textContent.trim().length) return true; return false; };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!hasDirectText(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag==='script'||tag==='style'||tag==='svg'||tag==='path'||tag==='noscript') continue;
    // Inside the Leaflet map / a <canvas>? skip — tiles aren't app text.
    if (el.closest('.leaflet-container, canvas')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility==='hidden' || cs.display==='none' || +cs.opacity===0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width<2 || rect.height<2) continue;
    if (rect.bottom<0 || rect.right<0 || rect.top>innerHeight || rect.left>innerWidth) continue;
    let fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); if (!bg) continue;            // unknown (image/gradient) bg — skip
    if (fg.a<1) fg = over(fg, bg);
    const r = ratio(fg, bg);
    const px = parseFloat(cs.fontSize) || 16;
    const wt = parseInt(cs.fontWeight) || 400;
    const large = px>=24 || (px>=18.66 && wt>=700);
    const floor = large ? 3.0 : 4.5;
    if (r >= floor - 0.05) continue;
    const text = (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40);
    if (!text) continue;
    const key = pathOf(el)+'|'+text+'|'+Math.round(r*10);
    if (seen.has(key)) continue; seen.add(key);
    out.push({ ratio:+r.toFixed(2), floor, px:+px.toFixed(1), wt, text, path: pathOf(el), fg:[fg.r,fg.g,fg.b], bg:[bg.r,bg.g,bg.b] });
  }
  return out.sort((a,b)=>a.ratio-b.ratio);
})()`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const hex = ([r, g, b]) => "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
const all = [];

// Drive the app through several states so the sweep sees more than the first screen.
// Non-navigating probes first; module switches via the accessible tab role; the map
// finder LAST because it routes away from the planner.
async function driveAndProbe(page, theme) {
  const states = [];
  const grab = async (label) => {
    await page.waitForTimeout(450);
    const res = await page.evaluate(PROBE);
    states.push({ label, res });
    await page.screenshot({ path: OUT + `sweep-${theme}-${label}.png` });
  };
  const reload = async () => { await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1400); };
  const tab = (name) => page.getByRole("button", { name, exact: false }).first();

  await grab("planner");
  // The site-name menu — the element that held the reported bug (opens a portal that
  // would intercept later clicks, so reload after probing it).
  try { await page.click('button[title="Switch or rename site"]', { timeout: 1500 }); await grab("planner-sitemenu"); } catch (_) {}
  try { await page.click('button[aria-label="Settings"]', { timeout: 1200 }); await grab("settings"); } catch (_) {}

  // Each remaining state from a fresh load so an open menu can't poison the next click.
  await reload();
  try { await tab("Library").click({ timeout: 2000 }); await page.waitForTimeout(700); await grab("markup"); } catch (_) {}
  await reload();
  try { await tab("Schedule").click({ timeout: 2000 }); await page.waitForTimeout(700); await grab("schedule"); } catch (_) {}
  await reload();
  try {
    await page.click('button[title^="All projects"], button[title="Dashboard — all projects"]', { timeout: 2000 });
    await page.waitForTimeout(700); await grab("finder");
    try { await page.click('button[title*="tatus"]', { timeout: 1200 }); await grab("finder-statusmenu"); } catch (_) {}
  } catch (_) {}
  return states;
}

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed(theme));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const states = await driveAndProbe(page, theme);
  console.log(`  ${theme}: probed ${states.length} states → ${states.map((s) => s.label).join(", ")}`);
  for (const s of states) for (const f of s.res) all.push({ theme, state: s.label, ...f });
  await ctx.close();
}
await browser.close();

// Report — unique by (theme, text, path).
const uniq = [];
const seen = new Set();
for (const f of all.sort((a, b) => a.ratio - b.ratio)) {
  const k = f.theme + "|" + f.path + "|" + f.text;
  if (seen.has(k)) continue; seen.add(k);
  uniq.push(f);
}
if (uniq.length === 0) {
  console.log("✓ No low-contrast text found in any workspace, in either theme.");
} else {
  console.log(`✗ ${uniq.length} low-contrast text element(s) found:\n`);
  for (const f of uniq) {
    console.log(`  [${f.theme}/${f.state}] ${String(f.ratio).padStart(5)} (need ≥${f.floor})  "${f.text}"`);
    console.log(`        ${f.px}px/${f.wt}  text ${hex(f.fg)} on ${hex(f.bg)}  ·  ${f.path}`);
  }
}
process.exit(uniq.length === 0 ? 0 : 1);
