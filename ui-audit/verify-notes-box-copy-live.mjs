#!/usr/bin/env node
/* verify-notes-box-copy-live — NEW-1 + NEW-2 (B2671288 / B2671289, 2026-11-15): copying a BOX vs copying TEXT, and boxes that overlap when placed — checked LIVE, SIGNED IN.
 * The signed-in twin of verify-notes-box-copy and the overlap sweep (local, seeded, signed out).
 *
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge commit> [BASE_URL=https://planyr.io] node ui-audit/verify-notes-box-copy-live.mjs
 *
 * Everything runs as the TEST account (e2e@planyr.test) on THROWAWAY pages this run creates through the real UI (never anything else on the account),
 * then deletes, purges from the Bin and reads back (constraint #15). Real keys, mouse and system clipboard; every verdict is the live editor's own document.
 *   K  KNOWN-GOOD ARMS (VOID if either fails): a click on a box's outline selects the box; Ctrl+C leaves a BOX on the system clipboard and the moving outline on it
 *   1  box copy → Ctrl+V on armed blank paper = a NEW box, same width / text / formatting, at the armed spot; the outline stays; one Ctrl+Z removes it
 *   2  box copy → Ctrl+V with the caret inside ANOTHER box = its own new box (that box's text untouched); the tab offers Keep Text Only, which works and undoes
 *   3  the outline ends with Esc / a new copy / an edit; hover leaves it
 *   4  Ctrl+X cuts (one Ctrl+Z restores exactly) and Ctrl+V brings it back
 *   5  the copied box pastes onto ANOTHER page, in place, plain text on the clipboard
 *   6  text copies (Ctrl+A, Shift+End, drag-select-all): no outline, no box on the clipboard, a paste inserts text (inside another box AND on empty paper)
 *   7  NEW-2: a box dropped by its border onto another overlaps it and the other does NOT move (one Ctrl+Z restores); typing that makes a box grow still pushes the box below clear
 * Every assertion records the served /version.json build read IN THE SAME CALL; the run is VOID unless that build contains EXPECT_SHA and every reading agrees. Cache-bust: ?cb=<ts>. */
import { execSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA;
if (!EXPECT_SHA) { console.log("EXPECT_SHA (the merge commit under test) is required — a live run must name the build it judges."); process.exit(2); }
const TAG = `ZZ box copy ${Date.now().toString(36)}`;
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
const fresh = (name) => makePage(name, [[W1, 60, 170], [W2, 60, 218]]);
const W1 = "Alpha tax rate cap and the revenue it touches";
const W2 = "Bravo permit for a second water well";
const blank = async () => { const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + 330, y: r.top + 400 }; }); return at; };
const rects = () => page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, t: e.textContent.slice(0, 10) }; }));
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

let exitCode = 0;
let listBefore = null;
try {
  await assertMeasurable(page, "verify-notes-box-copy-live");
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

  const idOther = await makePage("other-page", [["Gamma on the other page", 60, 170]]);

  /* ───────── K + 1 · box copy, paste on armed paper ───────── */
  console.log("\n=== K / 1 · a click on a box's outline then Ctrl+C = moving outline + a BOX on the clipboard; Ctrl+V on armed paper = a new box ===");
  const idA = await fresh("copy-paste");
  const d0 = await live(); const src0 = byWord(d0, "Alpha");
  await selectByOutline("Alpha"); await key("Control+c"); await wait(350);
  const c1 = await clip();
  if (!/data-planyr-boxes/.test(c1["text/html"] || "")) voidRun("the box-copy arm left no box on the system clipboard — the instrument is not doing a box copy");
  await ok("K: the copied box (and only it) wears the outline", (await ants()).length === 1 && (await ants())[0].startsWith("Alpha"), JSON.stringify(await ants()));
  await ok("1: the outline really animates", await page.evaluate(() => { const e = document.querySelector('.planyr-anchor[data-copied="1"]'); return !!e && getComputedStyle(e, "::after").animationName === "planyr-ants"; }));
  await ok("1: the clipboard's plain-text half is the words, no markup", /Alpha tax rate/.test(c1["text/plain"] || "") && !/[<>]/.test(c1["text/plain"] || ""), JSON.stringify(c1["text/plain"]));
  const at = await blank(); await page.mouse.dblclick(at.x, at.y); await wait(500);
  if (!(await armed())) voidRun("a double-click on blank paper armed no caret");
  await key("Control+v"); await wait(1300);
  const d1 = await live();
  await ok("1: Ctrl+V on armed paper made exactly one new box", boxesOf(d1).length === boxesOf(d0).length + 1, `${boxesOf(d0).length} → ${boxesOf(d1).length}`);
  const copies = boxesOf(d1).filter((b) => wordsOf(b) === wordsOf(src0));
  const nb = copies.find((b) => b.attrs.aid !== src0.attrs.aid);
  await ok("1: the new box has the same words, width, height rule and fit as the source", !!nb && boxText(nb) === boxText(src0) && nb.attrs.w === src0.attrs.w && nb.attrs.h === src0.attrs.h && nb.attrs.fit === src0.attrs.fit, JSON.stringify(nb && nb.attrs));
  await ok("1: …and it landed where he pressed, not on the source", !!nb && Math.abs(nb.attrs.y - src0.attrs.y) > 150, JSON.stringify([pos(nb), pos(src0)]));
  await ok("1: the source box is untouched and the outline stays for the next paste", sameAt(pos(byWord(d1, "Alpha tax")), pos(src0)) && (await ants()).length === 1);
  await key("Control+z"); await wait(700);
  await ok("1: ONE Ctrl+Z removes the pasted box", boxesOf(await live()).length === boxesOf(d0).length, String(boxesOf(await live()).length));

  /* ───────── 3 · the outline lifecycle ───────── */
  console.log("\n=== 3 · the outline ends with Esc, with a new copy, or with an edit ===");
  await key("Escape"); await wait(200);
  await ok("3: Esc clears the outline", (await ants()).length === 0, JSON.stringify(await ants()));
  await selectByOutline("Alpha"); await key("Control+c"); await wait(250);
  await key("Escape"); await selectByOutline("Bravo"); await key("Control+c"); await wait(250);
  await ok("3: a NEW copy moves it to the new box only", (await ants()).length === 1 && (await ants())[0].startsWith("Bravo"), JSON.stringify(await ants()));
  await page.mouse.move(700, 500); await page.mouse.move(800, 600); await wait(300);
  await ok("3: hovering leaves it alone", (await ants()).length === 1);
  await key("Escape"); await key("Escape");
  await enterBox("Bravo"); await key("End"); await page.keyboard.type("!"); await wait(400);
  await ok("3: an edit (typing) clears it", (await ants()).length === 0, JSON.stringify(await ants()));

  /* ───────── 2 · paste with the caret inside another box ───────── */
  console.log("\n=== 2 · box copy → Ctrl+V with the caret inside ANOTHER box = its own new box; Keep Text Only offered ===");
  const idB2 = await fresh("into-box");
  const e0 = await live(); const bravo0 = wordsOf(byWord(e0, "Bravo"));
  await selectByOutline("Alpha"); await key("Control+c"); await wait(300);
  await key("Escape"); await key("Escape");
  await enterBox("Bravo"); await key("End"); await key("Control+v"); await wait(1300);
  const e1 = await live();
  await ok("2: a new box appeared (3 boxes)", boxesOf(e1).length === 3, String(boxesOf(e1).length));
  await ok("2: Bravo's own words are exactly what they were", wordsOf(byWord(e1, "Bravo permit")) === bravo0 || wordsOf(boxesOf(e1).find((b) => wordsOf(b).startsWith("Bravo"))) === bravo0);
  await ok("2: nothing is nested", JSON.stringify(e1).split("noteAnchor").length - 1 === boxesOf(e1).length);
  await ok("2: the paste-options tab is offered", await chipVisible());
  await key("Control"); await wait(450); await key("t"); await wait(1100);
  const e2 = await live();
  await ok("2: Keep Text Only — the box is gone again and the words went in at the caret", boxesOf(e2).length === 2 && JSON.stringify(boxesOf(e2).find((b) => wordsOf(b).startsWith("Bravo"))).includes("Alpha tax rate"), `${boxesOf(e2).length} boxes`);
  await key("Control+z"); await wait(800);
  await ok("2: ONE Ctrl+Z undoes the pick (the pasted box is back)", boxesOf(await live()).length === 3, String(boxesOf(await live()).length));

  /* ───────── 4 · cut ───────── */
  console.log("\n=== 4 · Ctrl+X cuts a selected box; one Ctrl+Z restores it exactly; Ctrl+V brings it back ===");
  const idC = await fresh("cut");
  const f0 = await live(); const aBox = byWord(f0, "Alpha");
  await selectByOutline("Alpha"); await key("Control+x"); await wait(700);
  await ok("4: the box is gone", boxesOf(await live()).length === boxesOf(f0).length - 1 && !byWord(await live(), "Alpha tax"));
  await key("Control+z"); await wait(900);
  const f1 = await live();
  await ok("4: ONE Ctrl+Z restores it exactly (position and words)", !!byWord(f1, "Alpha tax") && sameAt(pos(byWord(f1, "Alpha tax")), pos(aBox)) && boxText(byWord(f1, "Alpha tax")) === boxText(aBox), JSON.stringify(pos(byWord(f1, "Alpha tax"))));
  await selectByOutline("Alpha"); await key("Control+x"); await wait(500);
  const at4 = await blank(); await page.mouse.dblclick(at4.x, at4.y); await wait(500);
  await key("Control+v"); await wait(1300);
  await ok("4: Ctrl+V after the cut brings back a box with the same words", boxesOf(await live()).length === boxesOf(f0).length && !!byWord(await live(), "Alpha tax"), String(boxesOf(await live()).length));

  /* ───────── 5 · another page ───────── */
  console.log("\n=== 5 · the copied box pastes onto ANOTHER page, in place ===");
  const idD = await fresh("cross-source");
  const g0 = await live(); const gSrc = byWord(g0, "Alpha");
  await selectByOutline("Alpha"); await key("Control+c"); await wait(300);
  const c5 = await clip();
  await openPage(idOther, "Gamma");
  const h0 = await live();
  const at5 = await blank(); await page.mouse.click(at5.x, at5.y); await wait(300);
  await key("Control+v"); await wait(1400);
  const h1 = await live();
  const pasted5 = boxesOf(h1).find((b) => wordsOf(b).includes("Alpha tax"));
  await ok("5: page two gained exactly one box with the words and the formatting", boxesOf(h1).length === boxesOf(h0).length + 1 && !!pasted5 && boxText(pasted5) === boxText(gSrc), `${boxesOf(h0).length} → ${boxesOf(h1).length}`);
  await ok("5: in place (same x and y as on the source page)", !!pasted5 && sameAt(pos(pasted5), pos(gSrc)), JSON.stringify([pos(pasted5), pos(gSrc)]));
  await ok("5: the clipboard's plain-text half was plain text", !/[<>]/.test(c5["text/plain"] || ""));
  await key("Control+z"); await wait(800);

  /* ───────── 6 · text copies ───────── */
  const picks = {
    "Ctrl+A": async () => { await key("Control+a"); },
    "Shift+End": async () => { await key("Home"); await page.keyboard.down("Shift"); await key("End"); await page.keyboard.up("Shift"); },
    "drag-select": async () => { const r = await rectOfWord("Alpha"); await page.mouse.move(r.l + 18, r.t + r.h / 2); await page.mouse.down(); await page.mouse.move(r.l + r.w - 6, r.t + r.h / 2, { steps: 8 }); await page.mouse.move(r.l + r.w - 6, r.t + r.h - 6, { steps: 4 }); await page.mouse.up(); await wait(200); },
  };
  for (const [name, pick] of Object.entries(picks)) {
    console.log(`\n=== 6 · text copy by ${name}: TEXT only — no outline, no box on the clipboard, a paste inserts text ===`);
    await fresh(`text-${name.replace(/\W/g, "")}`);
    const t0 = await live(); const srcW = byWord(t0, "Alpha").attrs.w;
    await enterBox("Alpha"); await pick(); await wait(200);
    await key("Control+c"); await wait(400);
    const ct = await clip();
    await ok(`6/${name}: no outline anywhere`, (await ants()).length === 0, JSON.stringify(await ants()));
    await ok(`6/${name}: nothing on the clipboard says "box" (no marker, no frame, no position)`, noMarker(ct), (ct["text/html"] || "").slice(0, 200));
    await ok(`6/${name}: the words are on the clipboard`, /Alpha tax rate/.test(ct["text/plain"] || ""), JSON.stringify(ct["text/plain"]));
    await key("Escape"); await key("Escape");
    const n0 = boxesOf(await live()).length;
    await enterBox("Bravo"); await key("End"); await key("Control+v"); await wait(1200);
    const t1 = await live();
    await ok(`6/${name}: pasted inside another box, NO new box was made`, boxesOf(t1).length === n0, `${n0} → ${boxesOf(t1).length}`);
    await ok(`6/${name}: …the words went into that box, nothing nested`, JSON.stringify(boxesOf(t1).find((b) => wordsOf(b).startsWith("Bravo"))).includes("Alpha tax rate") && JSON.stringify(t1).split("noteAnchor").length - 1 === boxesOf(t1).length);
    await key("Control+z"); await wait(700);
    await key("Escape"); await key("Escape");
    const at6 = await blank(); await page.mouse.dblclick(at6.x, at6.y); await wait(500);
    await setClip({ "text/html": ct["text/html"] || "", "text/plain": ct["text/plain"] || "" });
    await key("Control+v"); await wait(1300);
    const t2 = await live();
    const host = boxesOf(t2).find((b) => !boxesOf(t0).some((o) => o.attrs.aid === b.attrs.aid));
    await ok(`6/${name}: pasted on empty paper — ONE new box that holds just the text, made fresh (not a copy of the source box)`, boxesOf(t2).length === boxesOf(t0).length + 1 && !!host && /Alpha tax rate/.test(wordsOf(host)) && host.attrs.w !== srcW, JSON.stringify(host && host.attrs));
    await ok(`6/${name}: …and no outline`, (await ants()).length === 0);
  }

  /* ───────── 7 · NEW-2: overlap rules ───────── */
  console.log("\n=== 7 · a box he DROPS onto another overlaps it and nothing moves; growth from typing still pushes ===");
  const idE = await fresh("overlap");
  const o0 = await live(); const w2At = pos(byWord(o0, "Bravo")); const w1At = pos(byWord(o0, "Alpha"));
  const r1 = await rectOfWord("Alpha");
  const edge = { x: r1.l + r1.w * 0.3, y: r1.t - 1 };
  await page.mouse.move(edge.x, edge.y, { steps: 3 }); await wait(150);
  if (!(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [edge.x, edge.y]))) voidRun("the top border does not resolve to the move band");
  await page.mouse.down(); await page.mouse.move(edge.x + 6, edge.y + 25, { steps: 6 }); await page.mouse.move(edge.x + 12, edge.y + 60, { steps: 6 }); await page.mouse.up(); await wait(1200);
  const o1 = await live(); const rs = await rects();
  const ra = rs.find((r) => r.t.startsWith("Alpha")); const rb = rs.find((r) => r.t.startsWith("Bravo"));
  if (!ra || !rb || !overlap(ra, rb)) voidRun(`the dropped box does not overlap the other — the precondition for "nothing moved" does not hold (${JSON.stringify([ra, rb])})`);
  await ok("7: the dropped box overlaps the other one", true);
  await ok("7: …and the OTHER box did not move", sameAt(pos(byWord(o1, "Bravo")), w2At), JSON.stringify([pos(byWord(o1, "Bravo")), w2At]));
  await key("Control+z"); await wait(800);
  const o2 = await live();
  await ok("7: ONE Ctrl+Z puts the dropped box back", sameAt(pos(byWord(o2, "Alpha")), w1At), JSON.stringify(pos(byWord(o2, "Alpha"))));
  await enterBox("Alpha"); await key("End");
  await page.keyboard.type(" and a long continuation that has to wrap onto a second and then a third line inside this box so it grows", { delay: 6 }); await wait(1200);
  const o3 = await live(); const rs3 = await rects();
  await ok("7: typing that makes the box grow DOES push the box below clear (no overlap)", pos(byWord(o3, "Bravo"))[1] > w2At[1] && !overlap(rs3.find((r) => r.t.startsWith("Alpha")), rs3.find((r) => r.t.startsWith("Bravo"))), JSON.stringify([pos(byWord(o3, "Bravo")), w2At]));
  await key("Control+z"); await wait(900);
  await ok("7: ONE Ctrl+Z puts words and neighbour back", sameAt(pos(byWord(await live(), "Bravo")), w2At), JSON.stringify(pos(byWord(await live(), "Bravo"))));

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
