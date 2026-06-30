import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const b = await chromium.launch({ args: ["--no-sandbox","--ignore-certificate-errors","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });

const human = () => ({ get: () => false });
let fails = 0;
function expect(name, cond, detail="") { console.log((cond?"  ok  ":"FAIL  ")+name+(detail?"  — "+detail:"")); if(!cond) fails++; }

// ---------- FRONT DOOR ----------
console.log("\n=== FRONT DOOR (real-user redirect; auth callbacks must NOT bounce) ===");
async function fd(name, { url, seed, expectLanding }) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  if (seed) await p.addInitScript((k) => { try { localStorage.setItem(k, k.startsWith("sb-") ? '{"access_token":"x"}' : "{}"); } catch(e){} }, seed);
  await p.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(()=>{});
  await new Promise(r=>setTimeout(r,400));
  const onLanding = p.url().includes("/landing/");
  expect(name, onLanding === expectLanding, "→ " + p.url().replace(BASE,""));
  await ctx.close();
}
await fd("new visitor /                    → landing", { url:"/", expectLanding:true });
await fd("?app                             → app",     { url:"/?app", expectLanding:false });
await fd("deep link #/project/x            → app",     { url:"/#/project/x", expectLanding:false });
await fd("returning (planarfit: data)      → app",     { url:"/", seed:"planarfit:sites:v1", expectLanding:false });
await fd("signed-in (sb-…-auth-token)      → app",     { url:"/", seed:"sb-lyeqzkuiwngunutlkkmi-auth-token", expectLanding:false });
await fd("AUTH ?code= (email confirm/PKCE) → app",     { url:"/?code=abc123def", expectLanding:false });
await fd("AUTH ?error=access_denied        → app",     { url:"/?error=access_denied&error_description=x", expectLanding:false });
await fd("AUTH #access_token&type=recovery → app",     { url:"/#access_token=zzz&type=recovery", expectLanding:false });
await fd("AUTH ?type=recovery&code=        → app",     { url:"/?type=recovery&code=q", expectLanding:false });

// automation must never redirect (webdriver true)
{
  const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil:"domcontentloaded" }).catch(()=>{});
  await new Promise(r=>setTimeout(r,300));
  expect("automation /                     → app (webdriver exempt)", !p.url().includes("/landing/"), "→ "+p.url().replace(BASE,""));
  await ctx.close();
}

// ---------- LANDING STRESS ----------
console.log("\n=== LANDING STRESS ===");
function watch(p, errs){ p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()); }); p.on("pageerror",e=>errs.push("PAGEERROR: "+e.message)); }
const real = (t)=> !/ERR_CONNECTION_CLOSED|fonts\.(googleapis|gstatic)/.test(t); // ignore sandbox-blocked fonts

// 1) baseline + rapid resize
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} }); const p = await ctx.newPage(); const errs=[]; watch(p,errs);
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await new Promise(r=>setTimeout(r,1500));
  const ready = await p.evaluate(()=>!!window.__landingReady);
  expect("baseline: ready, webgl boots", ready, "ready="+ready);
  for (const [w,h] of [[480,900],[1280,700],[360,800],[1024,1366],[1440,900],[390,844]]) { await p.setViewportSize({width:w,height:h}); await new Promise(r=>setTimeout(r,140)); }
  await new Promise(r=>setTimeout(r,400));
  expect("rapid resize: no real errors", errs.filter(real).length===0, errs.filter(real).slice(0,3).join(" | "));
  await ctx.close();
}
// 2) fast scroll down+up
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} }); const p = await ctx.newPage(); const errs=[]; watch(p,errs);
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await new Promise(r=>setTimeout(r,1000));
  for (let i=0;i<12;i++){ await p.evaluate(y=>window.scrollTo(0,y), Math.random()*9000|0); await new Promise(r=>setTimeout(r,60)); }
  await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await new Promise(r=>setTimeout(r,200));
  await p.evaluate(()=>window.scrollTo(0,0)); await new Promise(r=>setTimeout(r,300));
  expect("fast scroll: no real errors", errs.filter(real).length===0, errs.filter(real).slice(0,3).join(" | "));
  await ctx.close();
}
// 3) reduced motion
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900}, reducedMotion:"reduce" }); const p = await ctx.newPage(); const errs=[]; watch(p,errs);
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await new Promise(r=>setTimeout(r,1400));
  const st = await p.evaluate(()=>({ ready:!!window.__landingReady, reveal:getComputedStyle(document.querySelector(".reveal")).opacity, yield0:document.querySelector('[data-yield="coverage"]').textContent }));
  expect("reduced-motion: ready + reveals shown", st.ready && st.reveal==="1", JSON.stringify(st));
  expect("reduced-motion: no real errors", errs.filter(real).length===0, errs.filter(real).slice(0,3).join(" | "));
  await ctx.close();
}
// 4) WebGL absent → fallback
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} }); const p = await ctx.newPage(); const errs=[]; watch(p,errs);
  await p.addInitScript(()=>{ const g=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(t){ if(String(t).indexOf("webgl")>=0) return null; return g.apply(this,arguments); }; });
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await new Promise(r=>setTimeout(r,1400));
  const st = await p.evaluate(()=>({ ready:!!window.__landingReady, fallback:!!window.__landingWebglFallback, fbShown:document.getElementById("bg-fallback").classList.contains("show") }));
  expect("WebGL-absent: fallback shown + page ready", st.ready && st.fallback && st.fbShown, JSON.stringify(st));
  expect("WebGL-absent: no real errors", errs.filter(real).length===0, errs.filter(real).slice(0,3).join(" | "));
  await ctx.close();
}

// 5) C1: crossing the 860px breakpoint after load reloads + re-inits (tablet rotation).
//    Count page inits via a sessionStorage counter (survives reload, set in an init script).
{
  const ctx = await b.newContext({ viewport:{width:960,height:800} }); const p = await ctx.newPage();
  await p.addInitScript(()=>{ try { sessionStorage.__inits = (+sessionStorage.__inits||0)+1; } catch(e){} });
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await new Promise(r=>setTimeout(r,600));
  await p.setViewportSize({ width: 700, height: 800 }); // cross 860 (desktop→mobile)
  await new Promise(r=>setTimeout(r,1600)); // debounce + reload + re-init
  let inits=-1, ready=false, mobile=false;
  try { const r = await p.evaluate(()=>({ i:+sessionStorage.__inits||0, ready:!!window.__landingReady, mobile:matchMedia("(max-width:860px)").matches })); inits=r.i; ready=r.ready; mobile=r.mobile; } catch(e){}
  expect("C1: crossing 860px reloads + re-inits in mobile mode", inits>=2 && mobile, `inits=${inits} mobile=${mobile} ready=${ready}`);
  await ctx.close();
}
// 6) no reload on a same-mode resize (desktop→desktop must NOT reload)
{
  const ctx = await b.newContext({ viewport:{width:1440,height:900} }); const p = await ctx.newPage();
  await p.addInitScript(()=>{ try { sessionStorage.__inits = (+sessionStorage.__inits||0)+1; } catch(e){} });
  await p.goto(BASE+"/landing/", { waitUntil:"load" }); await new Promise(r=>setTimeout(r,600));
  await p.setViewportSize({ width: 1100, height: 700 }); // still desktop, no breakpoint crossed
  await new Promise(r=>setTimeout(r,900));
  let inits=-1; try { inits = await p.evaluate(()=>+sessionStorage.__inits||0); } catch(e){}
  expect("C1: same-mode resize does NOT reload", inits === 1, `inits=${inits}`);
  await ctx.close();
}

console.log("\n"+(fails===0?"✅ ALL ADVERSARIAL CHECKS PASSED":("⚠️  "+fails+" CHECK(S) FAILED")));
await b.close();
process.exit(fails===0?0:1);
