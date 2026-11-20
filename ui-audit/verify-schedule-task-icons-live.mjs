/* B2671207 / V2115869 — live signed-in check of the amended Schedule task icons on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-task-icons-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Signs in as the test account (ONE browser), reads /version.json IN THE SAME CALL as the assertions, imports a throwaway
 * fixture schedule (local to this browser context — the test account's cloud write is refused for it, so NOTHING is stored and
 * there is nothing to clean up; the reload round trip is therefore proven by the sandbox harness verify-schedule-task-icons,
 * not here) and checks the deployed page: no hover glyph, no "N tasks", no gap, right-click Set / Change / Remove on a leaf
 * AND a phase, picker anchored at the name, collapsed-phase icon summary. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const task = o => ({ start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const fixture = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: "Task Icons Live Check", tasks: [
  task({ id: 1, name: "Entitlements" }), task({ id: 2, name: "Submit TIA", parentId: 1 }), task({ id: 3, name: "Will-serve letters", parentId: 1, icons: ["📮"] }),
  task({ id: 4, name: "Closeout" }), task({ id: 5, name: "Punch list", parentId: 4 }) ] } } };
const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1440, height: 800 } });
const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1440, height: 800 });
const errs = []; page.on("pageerror", e => errs.push(String(e))); page.on("dialog", d => d.accept());
await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
await assertMeasurable(page, "verify-schedule-task-icons-live");
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1200);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 600);
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()));   // same call as the assertions
const served = await page.evaluate(() => fetch("/sequence/", { cache: "no-store" }).then(r => r.text()).then(t => ({ noGlyph: !t.includes("ti-mood-plus") })));
console.log("signed in as", s.proof.email, "| build", JSON.stringify(build));
if (want) ok(`served build matches ${want}`, JSON.stringify(build).includes(want));
ok("1 the served Schedule page is the amended one (no add-glyph markup)", served.noGlyph, JSON.stringify(served));
const row = id => `[data-task-row="${id}"]`;
const st = id => page.evaluate(id => { const c = document.querySelector(`[data-task-row="${id}"] [data-col-key="name"]`); const n = c.querySelector("[data-task-name]"), t = c.querySelector('span[title="Collapse"], span[title="Expand"]'), ic = [...c.querySelectorAll("[data-task-icon]")];
  return { glyphs: ic.map(e => e.getAttribute("data-task-icon")), slot: !!c.querySelector("[data-task-icon-slot]"), add: !!c.querySelector(".ti-mood-plus, .ti-slot-add"), html: c.innerHTML, text: c.innerText, nameLeft: n.getBoundingClientRect().left, nameBottom: n.getBoundingClientRect().bottom, chevRight: t ? t.getBoundingClientRect().right : null, firstIcon: ic.length ? ic[0].getBoundingClientRect().left : null, lastIcon: ic.length ? ic[ic.length - 1].getBoundingClientRect().right : null, count: /\d+\s*tasks?\b/i.test(c.innerText) }; }, id);
const menu = async id => { await page.locator(`${row(id)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 250);
  return page.evaluate(() => [...document.querySelectorAll("div")].filter(d => /^(Set icon…|Change icon…|Remove icon)$/.test(d.textContent.trim()) && d.children.length >= 2 && getComputedStyle(d).cursor === "pointer").map(d => d.textContent.trim())); };
const item = l => page.locator("div", { hasText: new RegExp("^" + l + "$") }).filter({ has: page.locator("i.ti") }).last();
const picker = page.locator("[data-task-icon-picker]");

const a = await st(2); await page.mouse.move(5, 5); await pacedWait(page, 200);
const box = await page.locator(`${row(2)} [data-col-key="name"]`).boundingBox(); await page.mouse.move(box.x + 60, box.y + box.height / 2); await pacedWait(page, 300);
const b = await st(2);
ok("2 hovering an untagged row shows nothing in the name cell", b.add === false && b.slot === false && b.html === a.html);
const p = await st(1);
ok("3 untagged phase: chevron flush against the name (no gap)", p.chevRight != null && p.nameLeft - p.chevRight <= 1.5, `gap=${(p.nameLeft - p.chevRight).toFixed(1)}`);
await page.locator(`${row(1)} span[title="Collapse"]`).click(); await pacedWait(page, 300);
const c = await st(1);
ok("3 collapsed phase: faded icon summary, NO “N tasks” count", c.glyphs.length === 0 && c.count === false && c.text.trim() === "Entitlements" && await page.locator(`${row(1)} [data-phase-icons] img`).count() === 1, JSON.stringify(c.text));
await page.locator(`${row(1)} span[title="Expand"]`).click(); await pacedWait(page, 300);
for (const [label, id] of [["leaf", 2], ["phase", 4]]) {
  const m1 = await menu(id); ok(`4 ${label}: untagged → menu offers “Set icon…” only`, JSON.stringify(m1) === '["Set icon…"]', JSON.stringify(m1));
  await item("Set icon…").click(); await pacedWait(page, 300);
  const pb = await picker.boundingBox(), nm = await st(id);
  ok(`4 ${label}: the picker opens under that task's name`, !!pb && Math.abs(pb.x - nm.nameLeft) <= 3 && pb.y >= nm.nameBottom - 2, `px=${pb && pb.x} nx=${nm.nameLeft}`);
  await picker.locator("input").fill("tia"); await picker.locator("[data-icon-id]").first().click(); await pacedWait(page, 200); await page.keyboard.press("Escape"); await pacedWait(page, 250);
  const t = await st(id); ok(`4 ${label}: the icon appears on the row, before the name`, t.slot && t.glyphs.length === 1 && t.nameLeft - t.lastIcon <= 6 && (t.chevRight == null || t.firstIcon - t.chevRight <= 4), JSON.stringify(t.glyphs));
  const m2 = await menu(id); ok(`4 ${label}: tagged → “Change icon…” + “Remove icon”`, JSON.stringify([...m2].sort()) === '["Change icon…","Remove icon"]', JSON.stringify(m2));
  await item("Remove icon").click(); await pacedWait(page, 300);
  const g = await st(id); ok(`4 ${label}: Remove icon clears it and the slot leaves the DOM`, g.glyphs.length === 0 && g.slot === false);
}
ok("0 no uncaught page errors", errs.length === 0, errs.join(" | "));
await s.close();
const f = results.filter(r => !r).length; console.log(`\n${results.length - f}/${results.length} passed`); if (f) process.exit(1);
