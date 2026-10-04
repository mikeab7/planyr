import { openSignedIn } from "./lib/signedInSession.mjs";
const A = await openSignedIn({ base:"https://planyr.io" });
const B = await openSignedIn({ base:"https://planyr.io" });
console.log("build", A.build.build, B.build.build);
const open = async (s)=>{ await s.page.locator('[data-testid="module-tab-notes"]:visible').first().click(); await s.page.waitForTimeout(3000); };
await open(A); await open(B);
console.log("B before:", await B.page.locator('[data-testid="notes-tree"]').innerText());
await A.page.locator('[data-testid="notes-empty-create"]').first().click();
await A.page.waitForSelector('[data-testid="note-body"]');
await A.page.locator('[data-testid="note-body"]').click();
await A.page.keyboard.type("zz-b02-sync-probe hello from A");
await A.page.waitForTimeout(6000);
console.log("A footer:", (await A.page.locator('[data-testid="notes-footer-rail"]').innerText()).replace(/\n/g," | "));
console.log("A badge:", await A.page.locator('[data-testid="note-save-badge"]').innerText().catch(e=>"none"));
// B: switch away and back
await B.page.locator('[data-testid="module-tab-site"]:visible').first().click().catch(()=>{});
await B.page.waitForTimeout(1500);
await open(B); await B.page.waitForTimeout(5000);
console.log("B tree:", (await B.page.locator('[data-testid="notes-tree"]').innerText()).replace(/\n/g," | "));
const hit = B.page.locator('[data-testid="notes-tree"]').getByText(/zz-b02|hello|Untitled/i).first();
if (await hit.count()) { await hit.click(); await B.page.waitForTimeout(2000); console.log("B body:", await B.page.locator('[data-testid="note-body"]').innerText().catch(()=>"nobody")); }
console.log("B footer:", (await B.page.locator('[data-testid="notes-footer-rail"]').innerText()).replace(/\n/g," | "));
await B.page.screenshot({path:"/tmp/claude-0/-home-user-planyr/db5c0953-cf9e-5605-a866-2b8c4145b56f/scratchpad/b02b.png"});
await A.page.screenshot({path:"/tmp/claude-0/-home-user-planyr/db5c0953-cf9e-5605-a866-2b8c4145b56f/scratchpad/b02a2.png"});
await A.close(); await B.close();
