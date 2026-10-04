import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const s = await openSignedIn({ base: "https://planyr.io", viewport:{width:1440,height:900} });
const {page}=s;
console.log(s.build, JSON.stringify(s.proof));
await page.goto("https://planyr.io/#/notes",{waitUntil:"domcontentloaded"});
await page.locator('[data-testid="notes-tree"]').first().waitFor({timeout:30000}).catch(e=>console.log("no tree"));
await page.waitForTimeout(4000);
await assertMeasurable(page,"b05-explore");
const info = await page.evaluate(async()=>{
 const {data,error}=await window.pfSupabase.from("notes_trees").select("rev,data");
 return {error:error&&error.message, rows:(data||[]).map(r=>({rev:r.rev,pages:(r.data.pages||[]).length,trash:(r.data.trash||[]).length,tombs:(r.data.tombs||[]).length}))};
});
console.log(JSON.stringify(info));
console.log(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes("notes")).join("\n")));
await page.screenshot({path:"/tmp/claude-0/-home-user-planyr/db5c0953-cf9e-5605-a866-2b8c4145b56f/scratchpad/b05-x.png"});
await s.close();
