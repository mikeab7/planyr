#!/usr/bin/env node
/* verify-notes-select-all-live — NEW-1 (B2671293, 2026-11-15): CTRL+A BELONGS TO THE THING YOU ARE IN (PowerPoint), checked LIVE, SIGNED IN.
 * The signed-in twin of verify-notes-select-all (local, seeded, signed out).
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge commit> [BASE_URL=https://planyr.io] node ui-audit/verify-notes-select-all-live.mjs
 *
 * Everything runs as the TEST account (e2e@planyr.test) on a THROWAWAY page this run creates through the real UI (three boxes typed on blank paper — the self-fitting
 * shape a person makes, which a seeded fixture is not), then deletes, purges from the Bin and reads back (constraint #15). Real keys, mouse and system clipboard.
 *   K  KNOWN-GOOD ARMS (VOID if they fail): the served build contains the merge commit; signed in as the test account; a click on a box's outline selects the box
 *   1  caret in box A: Ctrl+A selects A's words only; Ctrl+C = text only (no box, no outline); typing replaces only A; ONE Ctrl+Z restores it
 *   2  a box selected by its outline: Ctrl+A selects all three boxes as boxes; Ctrl+C = three BOXES on the clipboard with the moving outline; nothing changed
 *   3  blank paper (caret armed): Ctrl+A selects all three boxes as boxes and creates nothing
 * Every assertion records the served /version.json build read IN THE SAME CALL; the run is VOID unless that build contains EXPECT_SHA and every reading agrees. Cache-bust: ?cb=<ts>. */
import { execSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA;
if (!EXPECT_SHA) { console.log("EXPECT_SHA (the merge commit under test) is required — a live run must name the build it judges."); process.exit(2); }
const TAG = `ZZ select all ${Date.now().toString(36)}`;
const made = [];                                   // { title, id }
const reads = [];                                  // every build read
let passN = 0, failN = 0;
class Void extends Error {}

let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try {
    s = await openSignedIn({ base: BASE, viewport: { width: 1500, height: 950 }, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  } catch (e) { if (!/answered 5\d\d/.test(String(e)) || i === 11) throw e; console.log("sign-in route 5xx, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await s.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => {});
const wait = (ms) => page.evaluate((m) => new Promise((r) => { const ch = new MessageChannel(); const t = performance.now(); const tick = () => (performance.now() - t >= m ? r() : (ch.port2.onmessage = tick, ch.port1.postMessage(0))); tick(); }), ms);
const build = () => page.evaluate(() => fetch(`/version.json?cb=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
const containsMerge = (b) => { if (!b) return false; if (String(b).startsWith(EXPECT_SHA.slice(0, 7))) return true; try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${b}`, { stdio: "ignore" }); return true; } catch { return false; } };
const ok = async (label, cond, detail = "") => {
  const b = await build(); reads.push(b);
  if (cond) { passN += 1; console.log(`  ✓ ${label}  [build ${b}]`); } else { failN += 1; console.log(`  ✗ ${label}  [build ${b}]${detail ? `\n      ${String(detail).slice(0, 300)}` : ""}`); }
};
const voidRun = (why) => { throw new Void(why); };

/* ───────────── document helpers (the live editor's own JSON) ───────────── */
const live = () => page.evaluate(() => window.__noteEditor && window.__noteEditor.doc());
const boxesOf = (d) => ((d && d.content) || []).filter((n) => n.type === "noteAnchor");
const boxText = (b) => JSON.stringify(b.content || []);
const wordsOf = (b) => (b.content || []).map((p) => (p.content || []).map((t) => t.text || "").join("")).join("\n");
const byWord = (d, w) => boxesOf(d).find((b) => wordsOf(b).includes(w));
const pos = (b) => (b ? [b.attrs.x, b.attrs.y] : null);
const sameAt = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/* ───────────── page creation / navigation (the real UI) ───────────── */
const rowSel = (title) => page.locator('[data-testid^="notes-row-"]', { hasText: title }).first();
async function rowId(title) {
  for (let i = 0; i < 30; i++) {
    if (await rowSel(title).count()) { const t = await rowSel(title).getAttribute("data-testid"); return t.replace(/^notes-row-/, ""); }
    await wait(300);
  }
  return null;
}
/** Arm a caret on blank paper at (dx, dy) from the sheet's top-left and type: the first character makes the box. */
async function armAndType(text, dx, dy) {
  const at = await page.evaluate(([x, y]) => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; }, [dx, dy]);
  await page.mouse.dblclick(at.x, at.y); await wait(500);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')))) voidRun("a double-click on blank paper did not arm a caret — cannot create page content");
  await page.keyboard.type(text, { delay: 14 }); await wait(900);
  await page.keyboard.press("Escape"); await wait(250); await page.keyboard.press("Escape"); await wait(250);
}
async function makePage(name, boxes) {
  const title = `${TAG} ${name}`;
  await page.locator('[data-testid="notes-new-page"]').first().click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await page.locator('[data-testid="note-title"]').fill(title);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await wait(800);
  const id = await rowId(title);
  if (!id) voidRun(`the new page "${name}" never appeared in the list`);
  made.push({ title, id });
  for (const [text, dx, dy] of boxes) await armAndType(text, dx, dy);
  const d = await live();
  for (const [text] of boxes) if (!byWord(d, text.slice(0, 6))) voidRun(`page ${name} did not get its box "${text}" (live: ${JSON.stringify(d).slice(0, 200)})`);
  await wait(1200);
  return id;
}
async function openPage(id, marker) {
  await page.waitForSelector(`[data-testid="notes-row-${id}"]`, { timeout: 20000 });
  await page.click(`[data-testid="notes-row-${id}"]`);
  for (let i = 0; i < 80; i++) { const d = await live(); if (d && JSON.stringify(d).includes(marker)) break; await wait(150); }
  await wait(600);
  const d = await live();
  if (!d || !JSON.stringify(d).includes(marker)) voidRun(`page ${id} never showed "${marker}"`);
}

/* ───────────── input (as the person does it) ───────────── */
const key = async (k) => { await page.keyboard.press(k); await wait(160); };
const rectOfWord = (w) => page.evaluate((word) => { const e = [...document.querySelectorAll(".planyr-anchor")].find((a) => a.textContent.includes(word)); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, id: e.getAttribute("data-anchor-id") }; }, w);
const textPoint = (needle) => page.evaluate((n) => { const t = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); let node; while ((node = t.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 2, y: Math.round(b.top + b.height / 2) }; } } return null; }, needle);
async function enterBox(word) { for (let i = 0; i < 2; i++) { const p = await textPoint(word); if (!p) voidRun(`no "${word}" on the page`); await page.mouse.click(p.x, p.y); await wait(i ? 250 : 650); } }
async function selectByOutline(word) {
  const r = await rectOfWord(word); if (!r) voidRun(`no box with "${word}"`);
  const at = { x: r.l + r.w * 0.3, y: r.t - 1 };
  await page.mouse.move(at.x, at.y, { steps: 3 }); await wait(120);
  if (!(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [at.x, at.y]))) voidRun(`the outline of "${word}" is not under the pointer`);
  await page.mouse.click(at.x, at.y); await wait(300);
  if ((await page.evaluate((id) => document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`)?.getAttribute("data-selected"), r.id)) !== "1") voidRun(`clicking the outline of "${word}" did not select the box`);
}
const ants = () => page.evaluate(() => [...document.querySelectorAll('.planyr-anchor[data-copied="1"]')].map((e) => e.textContent.slice(0, 12)));
const clip = () => page.evaluate(async () => { const out = {}; try { for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text(); } catch (e) { out.err = String(e); } return out; });
const setClip = (c) => page.evaluate(async (k) => { await navigator.clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(k).filter(([t]) => t.startsWith("text/")).map(([t, v]) => [t, new Blob([v], { type: t })])))]); }, c);
const noMarker = (c) => !/data-planyr-boxes|planyr-anchor|data-anchor-|noteAnchor/.test(c["text/html"] || "");
const chipVisible = () => page.locator('[data-testid="note-paste-options"]').first().isVisible().catch(() => false);
const armed = () => page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));

/* ───────────── cleanup ───────────── */
async function cleanup() {
  console.log("\n[cleanup] deleting the throwaway pages, purging them from the Bin, reading back");
  try {
    await page.evaluate(() => document.activeElement?.blur?.());
    for (let g = 0; g < 40 && (await page.locator('[data-testid^="notes-row-"]', { hasText: TAG }).count()); g++) {
      const row = page.locator('[data-testid^="notes-row-"]', { hasText: TAG }).first();
      await row.click({ button: "right" }); await wait(300);
      await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click(); await wait(600);
      const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
      if (await yes.count()) { await yes.click(); await wait(1100); }
    }
    await page.locator('[data-testid="notes-view-bin"]').click({ timeout: 8000 }); await wait(1200);
    for (let g = 0; g < 40; g++) {
      const ids = await page.evaluate((tag) => [...document.querySelectorAll('[data-testid^="notes-bin-"]')]
        .filter((e) => !/preview|peek|restore|purge|project|viewing|empty/.test(e.getAttribute("data-testid")) && (e.innerText || "").includes(tag))
        .map((e) => e.getAttribute("data-testid").replace(/^notes-bin-/, "")), TAG);
      if (!ids.length) break;
      await page.locator(`[data-testid="notes-bin-purge-${ids[0]}"]`).click({ timeout: 8000 }); await wait(500);
      await page.getByText("✓").first().click({ timeout: 3000 }).catch(() => {}); await wait(1000);
    }
    await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });   // back to the Pages view, freshly read
    await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 }); await wait(4000);
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 220)); }
  const left = await page.locator('[data-testid^="notes-row-"]', { hasText: TAG }).count();
  const after = await page.locator('[data-testid^="notes-row-"]').count();
  await ok("cleanup: no throwaway page is left in the page list, and the list is back to its starting size", left === 0 && after === (typeof listBefore === "number" ? listBefore : after), `${left} left · ${after} rows vs ${listBefore} before`);
  let cloud = [];
  for (let i = 0; i < 12; i++) {
    cloud = await page.evaluate(async (ids) => (await window.pfSupabase.from("notes_pages").select("id,deleted_at,purged_at").in("id", ids)).data || [], made.map((m) => m.id));
    if (cloud.every((r) => r.purged_at)) break;
    await wait(2500);
  }
  await ok(`cleanup: read back from the cloud — all ${made.length} throwaway pages are purged (none live, none merely binned)`, cloud.every((r) => r.purged_at) && !cloud.some((r) => !r.deleted_at && !r.purged_at), JSON.stringify(cloud.map((r) => ({ id: r.id, del: !!r.deleted_at, purged: !!r.purged_at }))));
}


/* ───────────── the run ───────────── */
const W1 = "Alpha tax rate cap and the revenue it touches";
const W2 = "Bravo permit for a second water well";
const W3 = "Charlie survey note for the north parcel";
const selectedCount = () => page.evaluate(() => document.querySelectorAll('.planyr-anchor[data-selected="1"]').length);
const selString = () => page.evaluate(() => String(window.getSelection() || ""));
const payloadBoxes = (html) => { const m = /data-planyr-boxes="([^"]*)"/.exec(html || ""); if (!m) return null; try { return JSON.parse(decodeURIComponent(m[1])).boxes; } catch (_) { return null; } };

let exitCode = 0;
let listBefore = null;
try {
  await assertMeasurable(page, "verify-notes-select-all-live");
  const build0 = await build();
  console.log(`signed in as ${s.proof.email} · served build ${build0} · expecting a build containing ${EXPECT_SHA} · tag "${TAG}"`);
  await ok("KNOWN-GOOD: served build contains the merge commit under test", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA}`);
  await ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));
  if (failN) voidRun("the served build does not contain the merge commit, or the sign-in is not the test account");

  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
  await wait(3500);
  listBefore = await page.locator('[data-testid^="notes-row-"]').count();
  console.log(`the account's list holds ${listBefore} pages before the run`);

  const id1 = await makePage("select-all", [[W1, 60, 170], [W2, 60, 260], [W3, 60, 350]]);
  const d0 = await live();
  await ok("setup: the throwaway page holds three boxes", boxesOf(d0).length === 3, String(boxesOf(d0).length));

  /* ───────── 1 · caret in a box ───────── */
  console.log("\n=== 1 · caret in box A: Ctrl+A selects only A's words ===");
  await enterBox("Alpha"); await key("Control+a");
  const sel1 = await selString();
  await ok("1: the selection is A's words", sel1.includes(W1), JSON.stringify(sel1));
  await ok("1: …and nothing of B or C", !sel1.includes("Bravo") && !sel1.includes("Charlie"), JSON.stringify(sel1));
  await ok("1: no box was selected as a box", (await selectedCount()) <= 1, String(await selectedCount()));
  await key("Control+c"); await wait(350);
  const c1 = await clip();
  await ok("1: the clipboard holds A's words only", (c1["text/plain"] || "").includes(W1) && !/Bravo|Charlie/.test(c1["text/plain"] || ""), JSON.stringify(c1["text/plain"]));
  await ok("1: …as text — no box on the clipboard, no outline", noMarker(c1) && (await ants()).length === 0, (c1["text/html"] || "").slice(0, 160));
  await page.keyboard.type("ZZ", { delay: 30 }); await wait(700);
  const d1 = await live();
  await ok("1: typing replaced only A's words", wordsOf(byWord(d1, "ZZ")) === "ZZ" && !!byWord(d1, "Bravo") && !!byWord(d1, "Charlie") && boxesOf(d1).length === 3, JSON.stringify(boxesOf(d1).map(wordsOf)));
  await key("Control+z"); await wait(800);
  const d1u = await live();
  await ok("1: ONE Ctrl+Z restores A's words", !!byWord(d1u, "Alpha tax rate cap") && wordsOf(byWord(d1u, "Alpha")) === wordsOf(byWord(d0, "Alpha")), JSON.stringify(boxesOf(d1u).map(wordsOf)));

  /* ───────── 2 · a box selected by its outline ───────── */
  console.log("\n=== 2 · a box selected by its outline: Ctrl+A selects every box as boxes ===");
  await key("Escape"); await key("Escape");
  const before2 = JSON.stringify(await live());
  await selectByOutline("Bravo");
  await ok("2: KNOWN-GOOD arm — only B is selected before the key", (await selectedCount()) === 1, String(await selectedCount()));
  await key("Control+a");
  await ok("2: all three boxes are selected", (await selectedCount()) === 3, String(await selectedCount()));
  await ok("2: the document did not change", JSON.stringify(await live()) === before2);
  await key("Control+c"); await wait(400);
  const c2 = await clip(); const pb = payloadBoxes(c2["text/html"]);
  await ok("2: the clipboard carries all three BOXES", !!pb && pb.length === 3, String(pb && pb.length));
  await ok("2: all three wear the moving outline", (await ants()).length === 3, JSON.stringify(await ants()));

  /* ───────── 3 · blank paper ───────── */
  console.log("\n=== 3 · blank paper: Ctrl+A selects every box as boxes and creates nothing ===");
  await key("Escape"); await key("Escape");
  const before3 = JSON.stringify(await live());
  const at3 = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + 330, y: r.top + 520 }; });
  await page.mouse.dblclick(at3.x, at3.y); await wait(500);
  await ok("3: KNOWN-GOOD arm — the double-click armed a caret on blank paper", await armed());
  await key("Control+a");
  await ok("3: all three boxes are selected", (await selectedCount()) === 3, String(await selectedCount()));
  await ok("3: the armed caret is gone and nothing was created", !(await armed()) && JSON.stringify(await live()) === before3);

  await ok("no page errors", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
} catch (e) {
  if (e instanceof Void) { console.log(`\nVOID: ${e.message}`); exitCode = 2; }
  else { console.log("\nUNEXPECTED:", e && e.stack || e); exitCode = 1; }
} finally {
  try { await cleanup(); } catch (e) { console.log("cleanup failed:", String(e).slice(0, 200)); exitCode = exitCode || 1; }
}
const distinct = [...new Set(reads)];
console.log(`\nbuild readings across ${reads.length} assertions: ${JSON.stringify(distinct)}`);
if (distinct.length > 1) { console.log("✗ the served build changed during the run — the readings are not one build"); failN += 1; }
if (distinct.length && !distinct.every(containsMerge)) { console.log(`✗ a reading does not contain ${EXPECT_SHA}`); failN += 1; }
console.log(`\n${passN} passed, ${failN} failed${exitCode === 2 ? " (VOID)" : ""}`);
await s.close();
process.exit(exitCode || (failN ? 1 : 0));
