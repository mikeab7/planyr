/* Diagnose B2285440: open the Schedule signed in as the test account, capture the crash + the
 * schedule data the page loaded. Read-only. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io";
const s = await openSignedIn({ base });
await assertMeasurable(s.page, "diagnose-schedule-active-project");
const logs = [];
s.page.on("console", m => { if (m.type() === "error") logs.push(m.text().slice(0, 600)); });
s.page.on("pageerror", e => logs.push("PAGEERROR " + String(e.stack || e).slice(0, 900)));
await s.page.goto(base + "/#/schedule", { waitUntil: "domcontentloaded" });
await s.page.waitForTimeout(8000);
console.log("build", JSON.stringify(s.build));
console.log("body:", (await s.page.locator("body").innerText()).slice(0, 400).replace(/\n/g, " | "));
for (const f of s.page.frames()) console.log("frame", f.url().slice(0, 100));
console.log(logs.join("\n---\n"));
const ls = await s.page.evaluate(() => Object.keys(localStorage).filter(k => /hs-|seq|sched/i.test(k)).map(k => [k, (localStorage.getItem(k) || "").slice(0, 200)]));
console.log("ls", JSON.stringify(ls));
await s.close();
