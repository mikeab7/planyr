import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const S="/tmp/claude-0/-home-user-planyr/db5c0953-cf9e-5605-a866-2b8c4145b56f/scratchpad/";
const s = await openSignedIn({ base: "https://planyr.io", viewport:{width:1440,height:900} });
const {page}=s; console.log("build",s.build.build);
await assertMeasurable(page,"tmp-b03-b");
await page.waitForTimeout(2500);
await page.locator('button[aria-label^="Account:"]').click();
await page.waitForTimeout(500);
console.log("menu:",await page.evaluate(()=>[...document.querySelectorAll(".menu button, [role=menu] button, [role=menuitem]")].map(b=>b.textContent.trim()).join(" | ")));
await page.getByText("Settings",{exact:true}).first().click();
await page.waitForTimeout(800);
const dlg=page.locator('[role=dialog]').first();
console.log("nav:",await page.locator('nav[aria-label="Settings sections"] button').allInnerTexts());
console.log("active/visible:",await dlg.innerText().then(t=>t.slice(0,300)));
console.log("smooth row:",await page.getByTestId("smooth-zoom-toggle").count(), "checked:",await page.getByTestId("smooth-zoom-toggle").isChecked().catch(e=>"err"));
await page.screenshot({path:S+"b03b.png"});
// View menu and plan menu: smooth zoom count
const total=await page.evaluate(()=>document.body.innerText.match(/Smooth zoom/g)?.length||0);
console.log("Smooth zoom mentions in page w/ dialog open:",total);
// toggle off, reload
await page.getByTestId("smooth-zoom-toggle").uncheck().catch(async e=>{console.log("uncheck err",String(e).slice(0,100)); await page.getByTestId("smooth-zoom-toggle").click();});
console.log("ls:",await page.evaluate(()=>localStorage.getItem("planarfit:smoothZoom")));
await s.close();
