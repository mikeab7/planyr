/* B341 — live contrast verification of the chrome elements that regressed after the
 * scheme change (user-name pill, Dashboard/Map breadcrumb toggle, module tabs). Reads
 * the REAL computed text color + effective background of each element in a headless
 * browser and asserts WCAG AA, in BOTH light and dark themes. Also saves screenshots.
 *
 * Build with dummy Supabase env first so the "Sign in" pill (same `pill` style as the
 * signed-in user-name pill) renders:
 *   VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npm run build
 *   npx vite preview --port 4173 &   then   node ui-audit/verify-b341-contrast.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const demoSite = { id: "d", groupId: "d", site: "Katy Logistics Park", name: "Plan 1", origin: null, county: null, parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

const seed = (theme) => `(() => { try {
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

// In-page: WCAG contrast of an element's text vs its first opaque ancestor background.
const PROBE = `(() => {
  const lum = (r,g,b) => { const f=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = (s) => { const m=(s||'').match(/rgba?\\(([^)]+)\\)/); if(!m) return null; const p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p[3]==null?1:p[3]}; };
  const bgOf = (el) => { let e=el; while(e){ const c=parse(getComputedStyle(e).backgroundColor); if(c&&c.a>0.5) return c; e=e.parentElement; } return {r:255,g:255,b:255,a:1}; };
  const ratio = (fg,bg) => { const a=lum(fg.r,fg.g,fg.b),b=lum(bg.r,bg.g,bg.b); const hi=Math.max(a,b),lo=Math.min(a,b); return (hi+0.05)/(lo+0.05); };
  const measure = (el, label, floor) => {
    if (!el) return { label, found: false };
    const fg = parse(getComputedStyle(el).color);
    const bg = bgOf(el);
    return { label, found: true, ratio: +ratio(fg, bg).toFixed(2), floor, fg, bg, text: (el.textContent||'').trim().slice(0,24) };
  };
  const probe = (sel, label, floor) => measure(document.querySelector(sel), label, floor);
  // Find a module tab by its exact label text (icon + label button) — the inactive
  // tabs use the muted-but-legible chrome-tab-inactive token.
  const tabByText = (txt) => [...document.querySelectorAll('header button')].find(b => (b.textContent||'').trim() === txt);
  return [
    probe('button[title="Sign in or create an account"]', 'auth pill ("Sign in" = user-name pill style)', 4.5),
    probe('button[title^="All projects"]', 'Dashboard/Map crumb', 4.5),
    probe('button[title="Switch project"]', 'project crumb (selected)', 4.5),
    probe('button[aria-current="page"]', 'active module tab', 4.5),
    measure(tabByText('Schedule'), 'inactive module tab (Schedule)', 4.5),
    measure(tabByText('Library'), 'inactive module tab (Markup)', 4.5),
  ];
})()`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let failures = 0;
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
  await ctx.addInitScript(seed(theme));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  const results = await page.evaluate(PROBE);
  console.log(`\n===== ${theme.toUpperCase()} =====`);
  for (const r of results) {
    if (!r.found) { console.log(`  · (not rendered) ${r.label}`); continue; }
    const ok = r.ratio >= r.floor - 1e-9;
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${String(r.ratio).padStart(6)} (≥${r.floor})  ${r.label}  ["${r.text}"]`);
  }
  await page.screenshot({ path: OUT + `b341-chrome-${theme}.png` });
  console.log(`  saved b341-chrome-${theme}.png`);
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "\n✓ All probed chrome elements clear WCAG AA in both themes." : `\n✗ ${failures} element(s) below floor.`);
process.exit(failures === 0 ? 0 : 1);
