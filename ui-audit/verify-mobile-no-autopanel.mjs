/* Verify: on a small screen, selecting an element does NOT auto-open the left
 * properties/parcel panel (owner request 2026-06-28, B557); on desktop it still does.
 * The auto-open is gated on the viewport-width `narrow` state, so a MOUSE click at
 * each width exercises the real gate (and clicks reliably drive the pointer handlers).
 *
 * Run: BASE_URL=http://localhost:4173/ PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node ui-audit/verify-mobile-no-autopanel.mjs
 */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A demo site with one building, booting straight into the planner.
const parcel = { id:"pc1", locked:false, points:[{x:-440,y:-160},{x:440,y:-160},{x:440,y:300},{x:-440,y:300}] };
const demo = { id:"d", groupId:"d", site:"Panel Test", name:"Plan 1", origin:null, county:null, parcels:[parcel], els:[{id:"e1",type:"building",cx:0,cy:-40,w:420,h:180,rot:0}], measures:[], callouts:[], markups:[], settings:{}, underlay:null, updatedAt:Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1', JSON.stringify({d:${JSON.stringify(demo)}}));localStorage.setItem('planarfit:currentSite:v1','d');}catch(e){}})();`;

const browser = await chromium.launch({ executablePath: EXEC, args:["--no-sandbox","--ignore-certificate-errors"] });
const results = [];
const check = (n, ok, d="") => { results.push(ok); console.log(`${ok?"PASS":"FAIL"}  ${n}${d?" — "+d:""}`); };

// Is the left properties/parcel panel content visible? The panel renders the "Element"/
// "Parcel" inspector only when leftPanel is open. We detect it via the panel's known
// inspector text. A robust proxy: the panel container at left:54 (narrow overlay) or the
// desktop panel — detect by the presence of the inspector heading text.
async function panelOpen(page) {
  return page.evaluate(() => {
    // The open left menu is the cream (#efe9dd = rgb(239,233,221)) panel that follows the 54px
    // icon rail; when closed only the rail exists. Match the COMPUTED bg color (the DOM serializes
    // the inline hex to rgb) on a div wider than the rail.
    const els = [...document.querySelectorAll("div")];
    return els.some((d) => {
      const bg = getComputedStyle(d).backgroundColor;
      return bg === "rgb(239, 233, 221)" && d.getBoundingClientRect().width > 100;
    });
  });
}

async function run(label, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: vp.width < 760, isMobile: vp.width < 760 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const before = await panelOpen(page);
  // Click the building directly via its on-screen label (reliable across fit/zoom at any width).
  const bldgLabel = page.locator('svg text', { hasText: "Building 1" }).first();
  const lb = await bldgLabel.boundingBox();
  await page.mouse.click(lb.x + lb.width/2, lb.y + lb.height/2);
  await page.waitForTimeout(500);
  const after = await panelOpen(page);
  await page.screenshot({ path: new URL(`./screens/autopanel-${label}.png`, import.meta.url).pathname });
  await ctx.close();
  return { before, after };
}

const phone = await run("phone", { width: 390, height: 844 });
check("phone: panel stays CLOSED after selecting an element", phone.after === false, `before=${phone.before} after=${phone.after}`);

const desk = await run("desktop", { width: 1440, height: 900 });
check("desktop: panel OPENS after selecting an element (unchanged)", desk.after === true, `before=${desk.before} after=${desk.after}`);

await browser.close();
const failed = results.filter(r=>!r).length;
console.log(`\n${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
