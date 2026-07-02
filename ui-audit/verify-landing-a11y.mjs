import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const b = await chromium.launch({ args: ["--no-sandbox","--ignore-certificate-errors","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
let fails = 0;
const ok = (n,c,d="")=>{ console.log((c?"  ok  ":"FAIL  ")+n+(d?"  — "+d:"")); if(!c) fails++; };
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

// ---------- LANDING: a11y structure + keyboard + anchor scroll ----------
console.log("\n=== LANDING a11y structure / keyboard / anchors ===");
{
  const ctx = await b.newContext({ viewport:{width:1280,height:900} }); const p = await ctx.newPage();
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await sleep(1200);
  const struct = await p.evaluate(()=>{
    const h1 = [...document.querySelectorAll("h1")];
    const heads = [...document.querySelectorAll("h1,h2,h3")].map(h=>+h.tagName[1]);
    // detect a skipped level (e.g. h1 -> h3)
    let skip=false; for(let i=1;i<heads.length;i++){ if(heads[i]-heads[i-1]>1) skip=true; }
    const landmarks = { main: !!document.querySelector("main"), nav: !!document.querySelector("nav"), header: !!document.querySelector("header"), footer: !!document.querySelector("footer") };
    const canvas = document.getElementById("bg");
    const canvasHidden = canvas && canvas.getAttribute("aria-hidden")==="true";
    const canvasFocusable = canvas && canvas.tabIndex >= 0;
    // any element with a positive tabindex (anti-pattern)?
    const posTab = [...document.querySelectorAll("[tabindex]")].filter(e=>+e.getAttribute("tabindex")>0).length;
    return { h1count: h1.length, h1text: h1[0]&&h1[0].innerText.replace(/\s+/g," ").trim().slice(0,40), heads, skip, landmarks, canvasHidden, canvasFocusable, posTab };
  });
  ok("exactly one h1", struct.h1count===1, "count="+struct.h1count+" text="+struct.h1text);
  ok("no skipped heading levels", !struct.skip, "levels="+JSON.stringify(struct.heads));
  ok("has main+nav+footer landmarks", struct.landmarks.main && struct.landmarks.nav && struct.landmarks.footer, JSON.stringify(struct.landmarks));
  ok("decorative canvas aria-hidden + not focusable", struct.canvasHidden && !struct.canvasFocusable, JSON.stringify({h:struct.canvasHidden,f:struct.canvasFocusable}));
  ok("no positive tabindex anti-pattern", struct.posTab===0, "count="+struct.posTab);

  // keyboard: Tab a few times from the top; ensure focus lands on real links/buttons and is visible
  await p.evaluate(()=>window.scrollTo(0,0));
  const focusChain=[];
  for(let i=0;i<6;i++){ await p.keyboard.press("Tab"); const f=await p.evaluate(()=>{ const a=document.activeElement; return a?{tag:a.tagName,text:(a.innerText||a.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,24),outline:getComputedStyle(a).outlineStyle}:null; }); focusChain.push(f); }
  const reachable = focusChain.filter(f=>f && (f.tag==="A"||f.tag==="BUTTON")).length;
  ok("keyboard: Tab reaches interactive elements", reachable>=4, JSON.stringify(focusChain.map(f=>f&&f.tag)));
  const anyVisibleFocus = focusChain.some(f=>f && f.outline && f.outline!=="none");
  ok("keyboard: focus ring visible on a focused link", anyVisibleFocus, "outlines="+JSON.stringify(focusChain.map(f=>f&&f.outline)));

  // anchor scroll: clicking a topbar tab scrolls to that section
  const yBefore = await p.evaluate(()=>window.scrollY);
  await p.evaluate(()=>{ const a=[...document.querySelectorAll('.tabs a')].find(x=>x.getAttribute('href')==='#review'); a&&a.click(); });
  await sleep(900);
  const movedToReview = await p.evaluate(()=>{ const r=document.getElementById("review").getBoundingClientRect(); return Math.abs(r.top) < window.innerHeight; });
  ok("anchor: clicking the Review tab scrolls to #review", movedToReview, "scrollY "+yBefore+"→"+(await p.evaluate(()=>window.scrollY)));
  await ctx.close();
}

// ---------- APP: /?app actually boots the app (renders, not blank, not redirected) ----------
console.log("\n=== /?app boots the real app ===");
{
  const ctx = await b.newContext({ viewport:{width:1280,height:900} }); const p = await ctx.newPage();
  await p.addInitScript(()=>Object.defineProperty(navigator,"webdriver",{get:()=>false})); // simulate a human
  await p.goto(BASE+"/?app", { waitUntil:"domcontentloaded" }); await sleep(2500);
  const r = await p.evaluate(()=>({ url: location.pathname+location.search, onLanding: location.pathname.indexOf("/landing")>=0, rootChildren: (document.getElementById("root")||{}).childElementCount||0, bodyText: (document.body.innerText||"").replace(/\s+/g," ").trim().length }));
  ok("/?app: not redirected to landing", !r.onLanding, "url="+r.url);
  ok("/?app: app shell actually renders (non-blank)", r.rootChildren>0 && r.bodyText>0, JSON.stringify({children:r.rootChildren,textLen:r.bodyText}));
  await ctx.close();
}

console.log("\n"+(fails===0?"✅ ADV2 ALL PASSED":("⚠️  "+fails+" CHECK(S) FAILED")));
await b.close();
process.exit(fails===0?0:1);
