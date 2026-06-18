import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium }=pw; const EXEC="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP=process.env.APP||"http://localhost:4173/";
const WEST=[29.583487,-95.409870]; // meat of the SMALLER (west) tract of 0440520000010
const browser=await chromium.launch({executablePath:EXEC,headless:true,args:["--ignore-certificate-errors"]});
const page=await browser.newPage({viewport:{width:1280,height:900},ignoreHTTPSErrors:true});
const q=[];
page.on("response",async r=>{const u=r.url();if(!/\/query\?/.test(u))return;const svc=/gis\.hctx\.net/.test(u)?"HCAD":/geographic\.texas\.gov/.test(u)?"TxGIO":null;if(!svc)return;if(!/esriGeometryPoint/.test(decodeURIComponent(u)))return;try{const j=await r.json();const f=(j.features||[])[0];q.push({svc,count:(j.features||[]).length,parcel:f?.attributes?.HCAD_NUM||f?.attributes?.prop_id,rings:f?.geometry?.rings?.length});}catch(e){q.push({svc,err:String(e).slice(0,40)});}});
page.on("console",m=>{if(/error/i.test(m.type()))console.log("  [console]",m.text().slice(0,140));});
await page.goto(APP,{waitUntil:"domcontentloaded",timeout:60000});await page.waitForTimeout(5000);
await page.locator('button:has-text("Select parcels")').first().click({timeout:10000}).catch(e=>console.log("selbtn:",e.message.slice(0,60)));
await page.waitForTimeout(1500);
const found=await page.evaluate(()=>{const cont=document.querySelector(".leaflet-container");if(!cont)return"nocont";const fk=Object.keys(cont).find(k=>k.startsWith("__reactFiber$"));if(!fk)return"nofiber";let root=cont[fk];while(root.return)root=root.return;const seen=new Set(),qq=[root];const isMap=v=>{try{return v&&typeof v==="object"&&typeof v.setView==="function"&&typeof v.latLngToContainerPoint==="function";}catch(e){return false;}};while(qq.length){const f=qq.shift();if(!f||seen.has(f))continue;seen.add(f);let h=f.memoizedState,d=0;while(h&&typeof h==="object"&&d<80){try{const ms=h.memoizedState;if(ms&&isMap(ms.current)){window.__MAP__=ms.current;return"ok";}}catch(e){}h=h.next;d++;}for(const k of["child","sibling"]){try{if(f[k])qq.push(f[k]);}catch(e){}}if(f.alternate&&!seen.has(f.alternate))qq.push(f.alternate);}return"nomap";});
console.log("map:",found);
if(found!=="ok"){await browser.close();process.exit(0);}
await page.evaluate(([la,ln])=>window.__MAP__.setView([la,ln],17,{animate:false}),[29.58288,-95.40837]); // center to show whole parcel
await page.waitForTimeout(4500);
// click WEST tract meat
const px=await page.evaluate(([la,ln])=>{const p=window.__MAP__.latLngToContainerPoint([la,ln]);const r=document.querySelector(".leaflet-container").getBoundingClientRect();return{x:r.left+p.x,y:r.top+p.y};},WEST);
q.length=0; await page.mouse.click(px.x,px.y); await page.waitForTimeout(3500);
// inspect highlight geometry: how many separate path 'M' subpaths (parts) + bbox span
const hl=await page.evaluate(()=>{const paths=[...document.querySelectorAll(".leaflet-overlay-pane path")].filter(p=>{const s=(p.getAttribute("stroke")||"").toLowerCase();return /e85|ea58|c241|d97|f59/.test(s);});
  return paths.map(p=>{const d=p.getAttribute("d")||"";const subpaths=(d.match(/M/gi)||[]).length;const b=p.getBBox();const a=window.__MAP__.containerPointToLatLng([b.x,b.y]),c=window.__MAP__.containerPointToLatLng([b.x+b.width,b.y+b.height]);return{subpaths,wFt:Math.round(Math.abs(c.lng-a.lng)*365223*Math.cos(29.58*Math.PI/180)),hFt:Math.round(Math.abs(a.lat-c.lat)*365223)};});});
const card=await page.locator("body").innerText().catch(()=>"");
const acres=(card.match(/[\d.]+\s*AC/gi)||[]); const parcelCount=(card.match(/\d+\s*PARCEL/gi)||[]);
console.log("\n--- FIX VERIFY: clicked WEST (smaller) tract @ -95.409870,29.583487 ---");
console.log("  point queries:",JSON.stringify(q));
console.log("  highlight path(s):",JSON.stringify(hl),"  (subpaths>1 OR width≈full-parcel ⇒ BOTH tracts highlighted)");
console.log("  selection card acreage:",JSON.stringify(acres)," parcelCount:",JSON.stringify(parcelCount));
await page.screenshot({path:"gis-verify/pearland-FIXED-clickwest.png"});
await browser.close();console.log("DONE");
