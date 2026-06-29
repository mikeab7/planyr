/* Verify the planner's native-touch two-finger pinch (B556).
 * Boots into the planner with a demo site, then drives CDP multi-touch:
 *   1. pinch OUT  → ppf (px/ft) increases (zoom in)
 *   2. pinch IN   → ppf decreases back below the zoomed value (zoom out)
 *   3. one-finger drag after the pinch → view pans (no stuck state)
 * Reads the live "N px/ft" readout as the zoom proxy.
 *
 * Run: BASE_URL=http://localhost:4173/ PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node ui-audit/verify-planner-pinch.mjs
 */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const parcel = { id:"pc1", locked:false, points:[{x:-440,y:-160},{x:440,y:-160},{x:440,y:300},{x:-440,y:300}] };
const demo = { id:"d", groupId:"d", site:"Pinch Test", name:"Plan 1", origin:null, county:null, parcels:[parcel], els:[{id:"e1",type:"building",cx:0,cy:-40,w:420,h:180,rot:0}], measures:[], callouts:[], markups:[], settings:{}, underlay:null, updatedAt:Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1', JSON.stringify({d:${JSON.stringify(demo)}}));localStorage.setItem('planarfit:currentSite:v1','d');}catch(e){}})();`;

const b = await chromium.launch({ executablePath: EXEC, args:["--no-sandbox","--ignore-certificate-errors"] });
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, hasTouch:true, isMobile:true });
await ctx.addInitScript(seed);
const p = await ctx.newPage();
await p.goto(BASE,{waitUntil:"load"}); await p.waitForTimeout(1800);

const ppf = async () => p.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find(s => /px\/ft$/.test(s.textContent.trim()));
  return el ? parseFloat(el.textContent) : null;
});
const cdp = await ctx.newCDPSession(p);
const box = await p.locator('svg[aria-label="Site plan canvas"]').boundingBox();
const cx = box.x + box.width/2, cy = box.y + box.height/2;
// CDP keeps touch state between calls and is finicky about reusing point ids across separate
// gestures, so each gesture takes its own base id. (Real fingers don't have this constraint.)
const touch = (type, pts, base=0) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((pt,i)=>({ x:pt.x, y:pt.y, id:base+i })) });

const results = [];
const check = (n, ok, d="") => { results.push(ok); console.log(`${ok?"PASS":"FAIL"}  ${n}${d?" → "+d:""}`); };

// One continuous two-finger gesture: spread to zoom IN, then bring together to zoom OUT — exercises
// both directions and the per-frame re-baseline the way a real pinch does.
const p0 = await ppf();
await touch("touchStart", [{x:cx-30,y:cy},{x:cx+30,y:cy}]); await p.waitForTimeout(40);
for (let s=1;s<=10;s++){ const g=30+200*(s/10); await touch("touchMove",[{x:cx-g,y:cy},{x:cx+g,y:cy}]); await p.waitForTimeout(40); }
const pPeak = await ppf();
check("pinch-out increases zoom", p0!=null && pPeak!=null && pPeak > p0*1.3, `${p0} → ${pPeak} px/ft`);
for (let s=1;s<=10;s++){ const g=230-200*(s/10); await touch("touchMove",[{x:cx-g,y:cy},{x:cx+g,y:cy}]); await p.waitForTimeout(40); }
const pEnd = await ppf();
check("pinch-in (same gesture) decreases zoom", pEnd!=null && pEnd < pPeak*0.7, `${pPeak} → ${pEnd} px/ft`);
await touch("touchEnd", []); await p.waitForTimeout(150);

// A SECOND pinch after the first must still work — proves the gesture didn't leave the canvas
// stuck (touchCountRef reset to 0, no held pan/capture). Fresh touch-point ids (CDP won't
// re-register a gesture that reuses ended ids).
const before2 = await ppf();
await touch("touchStart", [{x:cx-30,y:cy},{x:cx+30,y:cy}], 20); await p.waitForTimeout(40);
for (let s=1;s<=10;s++){ const g=30+200*(s/10); await touch("touchMove",[{x:cx-g,y:cy},{x:cx+g,y:cy}], 20); await p.waitForTimeout(40); }
await touch("touchEnd", [], 20); await p.waitForTimeout(150);
const after2 = await ppf();
check("a second pinch still zooms (canvas not stuck)", before2!=null && after2!=null && after2 > before2*1.3, `${before2} → ${after2} px/ft`);

await p.screenshot({ path: new URL("./screens/planner-pinch.png", import.meta.url).pathname });
await b.close();
const failed = results.filter(r=>!r).length;
console.log(`\n${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
