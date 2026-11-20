/* NEW-1 (2026-11-06) — the REAL-SHELL half of "ctrl zoom always works if im hovering over the schedule".
 *
 * verify-schedule-ctrl-zoom-hover.mjs proves it with a toy parent page and the shipped forwarder. THIS opens the actual app
 * on planyr.io (or a preview), signed in as the test account (ui-audit/lib/signedInSession.mjs — the one shared sign-in),
 * goes to a Schedule, parks keyboard focus in the SHELL (the header's own project switcher / breadcrumb), hovers the Gantt,
 * holds Ctrl, wheels, and asserts the frame cancelled the event and the timeline zoomed — with the served build named in the
 * SAME call (a stale cached chunk voids a live reading).
 *
 *   node ui-audit/verify-schedule-ctrl-zoom-live.mjs [https://planyr.io]
 * Exit 0 = held; 1 = defect; 2 = VOID (no schedule to hover / precondition not set).
 * Test artifacts: if the account has no schedule, this CREATES one through the shell's own "create" control and DELETES it
 * again before exiting (owner rule 2026-10-05: test artifacts are always cleared, never asked about).
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const line = (s) => console.log(s);
const s = await openSignedIn({ base });
const { page } = s;
await assertMeasurable(page, "verify-schedule-ctrl-zoom-live");
const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
line(`served build ${served} (openSignedIn reports ${JSON.stringify(s.build)}) — read in the same call as the assertions below`);
const failures = [];
const fail = (m) => { failures.push(m); line("  ✗ " + m); };
const ok = (m) => line("  ✓ " + m);
const logs = [];
page.on("pageerror", (e) => logs.push(String(e.message).slice(0, 200)));

const NAME = "zz ctrl-zoom check (auto-deleted)";
const bodyText = async () => (await page.locator("body").innerText()).replace(/\n/g, " | ");
await page.goto(base + "/#/project/e2e-fixture-site/schedule", { waitUntil: "domcontentloaded" });
await pacedWait(page, 8000);
// The test account has no schedule of its own, and the shell HIDES the Schedule frame while there is none. Create one
// (Organization-level, named so it is obviously a test artifact) and delete it again in `cleanup` — owner rule 2026-10-05.
const openCrumb = async () => { await page.locator(`text=/Select a schedule|${NAME.slice(0, 12)}/`).first().click(); await pacedWait(page, 700); };
let created = false;
async function cleanup() {
  if (!created) return;
  try {
    await openCrumb();
    await page.getByRole("button", { name: new RegExp("More actions for .*" + NAME.slice(0, 12)) }).first().click(); await pacedWait(page, 500);
    await page.getByText("Delete", { exact: true }).first().click(); await pacedWait(page, 500);
    await page.getByRole("button", { name: "Delete", exact: true }).last().click(); await pacedWait(page, 2500);
    await openCrumb();
    const left = (await bodyText()).includes(NAME);
    left ? line(`  ✗ the throwaway schedule "${NAME}" is STILL listed — delete it by hand`) : line("  ✓ the throwaway schedule was deleted and is gone from the list (delete verified)");
    if (left) failures.push("cleanup: throwaway schedule not deleted");
  } catch (e) { line(`  ✗ cleanup could not complete (${String(e.message).split("\n")[0]}) — delete "${NAME}" by hand`); failures.push("cleanup failed"); }
}
if (!(await bodyText()).includes(NAME)) {
  await openCrumb();
  await page.getByText("New schedule", { exact: true }).first().click(); await pacedWait(page, 1200);
  await page.getByPlaceholder("Master Schedule").fill(NAME);
  await page.getByRole("button", { name: "Create schedule" }).click(); created = true; await pacedWait(page, 6000);
} else { created = true; }
await page.getByRole("button", { name: "Gantt", exact: true }).click(); await pacedWait(page, 2500);
let frame = page.frames().find((x) => x.url().includes("/sequence/"));
const hasGantt = frame ? await frame.evaluate(() => !!document.querySelector("[data-gantt-scroll]")).catch(() => false) : false;
if (!hasGantt) { line("VOID — no Gantt in the Schedule frame. Body: " + (await bodyText()).slice(0, 200)); await cleanup(); await s.close(); process.exit(2); }

// the frame's own build, so the reading is about THIS bundle
const chunk = await frame.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.src).slice(0, 3).join(" "));
line(`frame bundle: ${chunk || "(inline script — the frame is /sequence/index.html itself)"}`);
await frame.evaluate(() => {
  window.__w = [];
  window.addEventListener("wheel", (e) => { const ev = e; setTimeout(() => window.__w.push({ ctrl: ev.ctrlKey, meta: ev.metaKey, cancelable: ev.cancelable, prevented: ev.defaultPrevented }), 0); }, { passive: true });
});
const width = () => frame.evaluate(() => document.querySelector("[data-gantt-scroll]")?.scrollWidth ?? null);

// Park focus in the SHELL: click the shell's own header (outside the iframe) — then verify where focus really is.
await page.evaluate(() => { const i = document.querySelector('iframe[title="Sequence Planyr"]'); const b = [...document.querySelectorAll("button")].find((x) => !i.contains(x) && x.offsetParent && x.getBoundingClientRect().y < 80); if (b) b.focus(); });
const focusIn = await page.evaluate(() => { const a = document.activeElement; return a ? (a.tagName === "IFRAME" ? "frame" : a.tagName.toLowerCase()) : "none"; });
if (focusIn === "frame") { line("VOID — focus is still in the frame; the precondition could not be set"); await s.close(); process.exit(2); }
ok(`keyboard focus is in the shell (${focusIn}), not in the Schedule frame`);

const gb = await frame.locator("[data-gantt-scroll]").boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await pacedWait(page, 200);
for (const [key, label] of [["Control", "Ctrl"], ["Meta", "Cmd"]]) {
  const w0 = await width(); await frame.evaluate(() => window.__w.splice(0));
  await page.keyboard.down(key); await pacedWait(page, 150);
  await page.mouse.wheel(0, -300); await pacedWait(page, 500);
  await page.keyboard.up(key); await pacedWait(page, 200);
  const w1 = await width(), ev = await frame.evaluate(() => window.__w.splice(0));
  ev.length && ev.every((e) => e.prevented) ? ok(`${label}+wheel over the Gantt: the frame cancelled it (browser page cannot zoom)`) : fail(`${label}+wheel NOT cancelled: ${JSON.stringify(ev)}`);
  w1 > w0 ? ok(`${label}+wheel over the Gantt: timeline ${w0} → ${w1}`) : fail(`${label}+wheel did not zoom the timeline (${w0} → ${w1})`);
  await page.keyboard.down("Control"); await pacedWait(page, 100); await page.mouse.wheel(0, 300); await pacedWait(page, 400); await page.keyboard.up("Control"); await pacedWait(page, 150);
}
{ // plain wheel afterwards: scrolls / does not zoom, not cancelled
  const w0 = await width(); await frame.evaluate(() => window.__w.splice(0));
  await page.mouse.wheel(0, 300); await pacedWait(page, 400);
  const w1 = await width(), ev = await frame.evaluate(() => window.__w.splice(0));
  w1 === w0 && ev.every((e) => !e.prevented && !e.ctrl) ? ok("plain wheel after release: no zoom, not cancelled") : fail(`plain wheel misbehaved (${w0} → ${w1}, ${JSON.stringify(ev)})`);
}
if (logs.length) line("  page errors: " + logs.join(" | "));

await cleanup();
await s.close();
if (failures.length) { line(`FAIL — ${failures.length} defect(s) on build ${served}`); process.exit(1); }
line(`PASS — in the real shell on build ${served}, with focus in the shell, Ctrl/Cmd+wheel over the Gantt zooms the timeline and the browser page never gets the event.`);
