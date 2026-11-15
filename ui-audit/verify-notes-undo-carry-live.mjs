#!/usr/bin/env node
/* verify-notes-undo-carry-live — B2671278 (Notes: each page keeps its own undo history when you switch pages), checked LIVE and SIGNED IN.
 * The signed-in twin of verify-notes-undo-carry (local, seeded, signed out) — the way verify-undo-carry-live is for the Site Planner (B2671279).
 *
 *   E2E_LOGIN_KEY=… [EXPECT_SHA=3bf6c59] [BASE_URL=https://planyr.io] node ui-audit/verify-notes-undo-carry-live.mjs
 *
 * Everything runs as the TEST account (e2e@planyr.test) on THROWAWAY pages this run creates through the real UI (never anything else on the
 * account), then deletes, purges from the Bin, and reads back (constraint #15). Real keys and mouse; every verdict is the live editor's own document.
 *   K  KNOWN-GOOD ARMS (the run is VOID if either fails): on ONE page, no switch, typing then Ctrl+Z undoes it, and a box drag is an undo step
 *   a  type on A → open B → back to A → Ctrl+Z undoes the typing (twice), Ctrl+Y redoes it
 *   b  drag a text box on A → open B → back → Ctrl+Z puts it back, Ctrl+Y moves it again
 *   c  page B's Ctrl+Z never touches A (each page undoes only its own steps)
 *   d  STALE GUARD, signed in: A changed in the CLOUD (a second device's write to notes_pages) while away, adopted by the app's own refresh
 *      → reopen A → the other device's text shows, its saved history is discarded, Ctrl+Z replays nothing over it
 *   e  a box DELETE and a real Ctrl+V PASTE still undo after a switch
 *   f  typing after coming back is its own step; the older steps are still under it
 * Every assertion records the served /version.json build read IN THE SAME CALL; the run is VOID unless that build contains EXPECT_SHA
 * (the merge commit of B2671278, 3bf6c59) and every reading agrees. Cache-bust: ?cb=<ts>. */
import { execSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "3bf6c59";
const TAG = `ZZ undo carry ${Date.now().toString(36)}`;
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
/* the verdict and the build it was observed on are ONE call: the build is read right before the assertion is printed */
const ok = async (label, cond, detail = "") => {
  const b = await build(); reads.push(b);
  if (cond) { passN += 1; console.log(`  ✓ ${label}  [build ${b}]`); } else { failN += 1; console.log(`  ✗ ${label}  [build ${b}]${detail ? `\n      ${String(detail).slice(0, 300)}` : ""}`); }
};
const voidRun = (why) => { throw new Void(why); };

/* ───────────── document helpers (the live editor's own JSON) ───────────── */
const live = () => page.evaluate(() => window.__noteEditor && window.__noteEditor.doc());
const depth = () => page.evaluate(() => (window.__noteEditor ? window.__noteEditor.undoDepth() : null));
const boxesOf = (d) => ((d && d.content) || []).filter((n) => n.type === "noteAnchor");
const textOf = (d) => JSON.stringify(d || {}).match(/"text":"([^"]*)"/g)?.map((m) => m.slice(8, -1)).join("|") || "";
const firstBoxText = (d) => { const b = boxesOf(d)[0]; return b ? (b.content || []).map((p) => (p.content || []).map((t) => t.text || "").join("")).join("\n") : null; };
const firstBoxAt = (d) => { const b = boxesOf(d)[0]; return b ? { x: b.attrs.x, y: b.attrs.y } : null; };
const near = (a, b, tol = 1.5) => a && b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/* ───────────── page creation / navigation (the real UI) ───────────── */
const rowSel = (title) => page.locator('[data-testid^="notes-row-"]', { hasText: title }).first();
async function rowId(title) {
  for (let i = 0; i < 30; i++) {
    if (await rowSel(title).count()) { const t = await rowSel(title).getAttribute("data-testid"); return t.replace(/^notes-row-/, ""); }
    await wait(300);
  }
  return null;
}
async function armAndType(text) {
  const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * 0.08, y: r.top + r.height * 0.12 }; });
  await page.mouse.dblclick(at.x, at.y); await wait(500);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')))) voidRun("a double-click on blank paper did not arm a caret — cannot create page content");
  await page.keyboard.type(text, { delay: 18 }); await wait(1200);
}
async function makePage(name, text) {
  const title = `${TAG} ${name}`;
  await page.locator('[data-testid="notes-new-page"]').first().click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await page.locator('[data-testid="note-title"]').fill(title);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await wait(800);
  const id = await rowId(title);
  if (!id) voidRun(`the new page "${name}" never appeared in the list`);
  made.push({ title, id });
  await armAndType(text);
  const d = await live();
  if (!textOf(d).includes(text.slice(0, 5)) || boxesOf(d).length < 1) voidRun(`page ${name} did not get a text box with "${text}" (live: ${JSON.stringify(d).slice(0, 160)})`);
  return id;
}
async function openPage(id, marker) {
  await page.waitForSelector(`[data-testid="notes-row-${id}"]`, { timeout: 20000 });
  await page.click(`[data-testid="notes-row-${id}"]`);
  if (marker == null) { await wait(1500); return; }
  for (let i = 0; i < 80; i++) { const d = await live(); if (d && textOf(d).includes(marker)) break; await wait(150); }
  await wait(600);
  const d = await live();
  if (!d || !textOf(d).includes(marker)) voidRun(`page ${id} never showed "${marker}" (live: ${JSON.stringify(d).slice(0, 160)})`);
}
const roundTrip = async (away, awayMarker, back, backMarker) => { await openPage(away, awayMarker); await openPage(back, backMarker); };

/* ───────────── input (as the person does it) ───────────── */
async function enterBox() {
  for (let i = 0; i < 2; i += 1) {
    const p = await page.evaluate(() => {
      const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
      const n = w.nextNode(); const r = document.createRange(); r.setStart(n, 1); r.collapse(true);
      const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    });
    await page.mouse.click(p.x, p.y); await wait(i ? 250 : 650);
  }
}
async function typeAtEnd(text) {
  await enterBox();
  await page.keyboard.press("End"); await wait(80);
  const at = await page.evaluate(() => window.__noteEditor.selection());
  if (!at || at.from < 2) voidRun(`the caret is not inside the box (${JSON.stringify(at)})`);
  await page.keyboard.type(text, { delay: 18 });
  await wait(800);                                  // longer than the save debounce AND the undo grouping window
}
const focusBody = async () => { await page.focus('[data-testid="note-body"]'); await wait(100); };
const undoKey = async () => { await focusBody(); await page.keyboard.press("Control+z"); await wait(400); };
const redoKey = async () => { await focusBody(); await page.keyboard.press("Control+y"); await wait(400); };
const topBandPoint = () => page.evaluate(() => { const b = document.querySelector('[data-testid="note-anchor"]'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 0.5) }; });
const isMoveBand = (x, y) => page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return !!(el && el.closest(".planyr-anchor-edge")); }, [x, y]);
async function dragBox(dx, dy) {
  const p = await topBandPoint();
  if (!(await isMoveBand(p.x, p.y))) voidRun("the box's top border does not resolve to the move band — the harness cannot drag a box");
  await page.mouse.move(p.x, p.y); await wait(80);
  await page.mouse.down();
  await page.mouse.move(p.x + dx / 2, p.y + dy / 2, { steps: 6 }); await wait(60);
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 }); await wait(60);
  await page.mouse.up(); await wait(1000);
}

/* ───────────── cloud helpers (the second device) ───────────── */
const cloudDoc = (id) => page.evaluate(async (pid) => { const { data, error } = await window.pfSupabase.from("notes_pages").select("doc,rev,deleted_at,purged_at").eq("id", pid).maybeSingle(); return error ? { error: error.message } : data; }, id);
const localCopyHas = (id, needle) => page.evaluate(([pid, n]) => Object.keys(localStorage).some((k) => k.includes("planyr:notes:page:v1:") && k.endsWith(`:${pid}`) && (localStorage.getItem(k) || "").includes(n)), [id, needle]);

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

let exitCode = 0;
let listBefore = null;
try {
  await assertMeasurable(page, "verify-notes-undo-carry-live");
  const build0 = await build();
  console.log(`signed in as ${s.proof.email} · served build ${build0} · expecting a build containing ${EXPECT_SHA} · tag "${TAG}"`);
  await ok("KNOWN-GOOD: served build contains the B2671278 merge commit", containsMerge(build0), `build=${build0} expect=${EXPECT_SHA}`);
  await ok("KNOWN-GOOD: signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));
  if (failN) voidRun("the served build does not contain the merge commit, or the sign-in is not the test account");

  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
  await wait(3500);
  const before = await page.locator('[data-testid^="notes-row-"]').count();
  listBefore = before;
  console.log(`the account's list holds ${before} pages before the run`);

  /* shared page B (a plain "other page") */
  const idB = await makePage("bravo-shared", "Bravo line one");

  /* ───────── K · known-good arms: ONE page, no switch ───────── */
  console.log("\n=== K · KNOWN-GOOD ARMS — on one page, no switch, typing and a box drag are undoable with the real keys ===");
  const idK = await makePage("kgood", "Kilo line one");
  const k0 = await live();
  await typeAtEnd(" TYPED");
  if (!firstBoxText(await live())?.includes("TYPED")) voidRun("typing did not reach the box");
  await undoKey();
  if (firstBoxText(await live()) !== firstBoxText(k0)) voidRun(`Ctrl+Z on the same page did not undo the typing (${firstBoxText(await live())}) — the instrument cannot see undo`);
  await ok("the instrument sees Ctrl+Z undo typing on one page (no switch)", true);
  const dK = await depth();
  await dragBox(70, 50);
  if (near(firstBoxAt(await live()), firstBoxAt(k0), 2)) voidRun("a real drag from the border did not move the box");
  if ((await depth()) <= dK) voidRun("the box drag registered no undo step");
  await undoKey();
  await ok("the instrument sees a box drag as an undo step, and Ctrl+Z puts the box back on one page", near(firstBoxAt(await live()), firstBoxAt(k0), 2), JSON.stringify([firstBoxAt(await live()), firstBoxAt(k0)]));

  /* ───────── a · typing ───────── */
  console.log("\n=== a · type on A → open B → back to A → Ctrl+Z undoes the typing; Ctrl+Y redoes it ===");
  const idA = await makePage("alpha-typing", "Alpha line one");
  const a0 = await live();
  await typeAtEnd(" ONE");
  await typeAtEnd(" TWO");
  const aTyped = await live();
  await ok("A holds both typed bits before leaving", /ONE/.test(firstBoxText(aTyped)) && /TWO/.test(firstBoxText(aTyped)), firstBoxText(aTyped));
  const dA = await depth();
  await roundTrip(idB, "Bravo", idA, "Alpha");
  await ok("back on A the document is exactly what was left", JSON.stringify(await live()) === JSON.stringify(aTyped), firstBoxText(await live()));
  await ok("back on A the undo history is carried (same depth)", (await depth()) === dA, `${dA} → ${await depth()}`);
  await undoKey();
  await ok("Ctrl+Z undoes the LAST typing (TWO)", !/TWO/.test(firstBoxText(await live())) && /ONE/.test(firstBoxText(await live())), firstBoxText(await live()));
  await undoKey();
  await ok("Ctrl+Z again undoes ONE — back to the text before the edits", firstBoxText(await live()) === firstBoxText(a0), firstBoxText(await live()));
  await redoKey();
  await ok("Ctrl+Y redoes ONE (the redo stack was carried too)", /ONE/.test(firstBoxText(await live())) && !/TWO/.test(firstBoxText(await live())), firstBoxText(await live()));
  await redoKey();
  await ok("Ctrl+Y again redoes TWO", /ONE/.test(firstBoxText(await live())) && /TWO/.test(firstBoxText(await live())), firstBoxText(await live()));

  /* ───────── b · box move ───────── */
  console.log("\n=== b · drag a text box on A → open B → back → Ctrl+Z puts it back; Ctrl+Y moves it again ===");
  const idAb = await makePage("alpha-box", "Alpha box line");
  const b0 = firstBoxAt(await live());
  await dragBox(80, 60);
  const bMoved = firstBoxAt(await live());
  await ok("the box moved", !near(bMoved, b0, 2), JSON.stringify([b0, bMoved]));
  await roundTrip(idB, "Bravo", idAb, "Alpha box");
  await ok("back on A the box is where it was left", near(firstBoxAt(await live()), bMoved, 1.5), JSON.stringify(firstBoxAt(await live())));
  await undoKey();
  await ok("Ctrl+Z puts the box back where it started", near(firstBoxAt(await live()), b0, 2), JSON.stringify(firstBoxAt(await live())));
  await redoKey();
  await ok("Ctrl+Y moves the box again", near(firstBoxAt(await live()), bMoved, 2), JSON.stringify(firstBoxAt(await live())));

  /* ───────── c · per page ───────── */
  console.log("\n=== c · each page undoes only its OWN steps ===");
  const idC = await makePage("alpha-iso", "Alpha iso line");
  const idCb = await makePage("bravo-iso", "Bravo iso line");
  await openPage(idC, "Alpha iso");
  await typeAtEnd(" AAA"); const dCa = await depth();
  await openPage(idCb, "Bravo iso");
  await typeAtEnd(" BBB"); const dCb = await depth();
  await openPage(idC, "Alpha iso");
  await ok("A: its history is its own (depth as it was left)", (await depth()) === dCa, `${dCa} → ${await depth()}`);
  await openPage(idCb, "Bravo iso");
  await ok("B: its history is its own (depth as it was left)", (await depth()) === dCb, `${dCb} → ${await depth()}`);
  await undoKey();
  await ok("Ctrl+Z on B removes BBB", !/BBB/.test(firstBoxText(await live())) && /Bravo iso/.test(firstBoxText(await live())), firstBoxText(await live()));
  await openPage(idC, "Alpha iso");
  await ok("…and A is untouched by it (still has AAA, same depth)", /AAA/.test(firstBoxText(await live())) && (await depth()) === dCa, `${firstBoxText(await live())} · depth ${await depth()}`);
  await undoKey();
  await ok("Ctrl+Z on A removes AAA", !/AAA/.test(firstBoxText(await live())) && /Alpha iso/.test(firstBoxText(await live())), firstBoxText(await live()));
  await openPage(idCb, "Bravo iso");
  await ok("…and B (already undone) is not touched by A's undo", !/AAA/.test(firstBoxText(await live())) && (await depth()) === dCb - 1, `depth ${await depth()} (want ${dCb - 1})`);

  /* ───────── d · stale guard, signed in ───────── */
  console.log("\n=== d · A changed in the CLOUD behind the carried history (second device) → saved history discarded ===");
  const idD = await makePage("alpha-stale", "Alpha stale line");
  await typeAtEnd(" MINE");
  const dD = await depth();
  await ok("A holds MINE and has history before leaving", /MINE/.test(firstBoxText(await live())) && dD >= 1, `${firstBoxText(await live())} · depth ${dD}`);
  await openPage(idB, "Bravo");
  let row = null;
  for (let i = 0; i < 40; i++) { row = await cloudDoc(idD); if (row && row.doc && JSON.stringify(row.doc).includes("MINE")) break; await wait(1000); }
  if (!row || !row.doc || !JSON.stringify(row.doc).includes("MINE")) voidRun(`page A's MINE never reached the cloud (${JSON.stringify(row).slice(0, 160)}) — cannot stage a second-device write`);
  const edited = JSON.parse(JSON.stringify(row.doc));
  const tn = (function find(n) { if (n && n.type === "text") return n; for (const c of (n && n.content) || []) { const f = find(c); if (f) return f; } return null; })(boxesOf(edited)[0]);
  tn.text += " ELSEWHERE";
  const w = await page.evaluate(async ([pid, doc]) => { const r = await window.pfSupabase.from("notes_pages").update({ doc }).eq("id", pid).select("rev"); return { err: r.error && r.error.message, rows: (r.data || []).length }; }, [idD, edited]);
  await ok("setup: a second device's write landed in the cloud (notes_pages updated for page A)", !w.err && w.rows === 1, JSON.stringify(w));
  for (let i = 0; i < 12 && !(await localCopyHas(idD, "ELSEWHERE")); i++) { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await wait(2500); }
  const adopted = await localCopyHas(idD, "ELSEWHERE");
  await ok("setup: the app's own refresh adopted the other device's text into this tab (the check below is not vacuous)", adopted);
  if (!adopted) voidRun("the cloud change was never adopted into this tab, so the stale guard cannot be judged");
  await openPage(idD, "ELSEWHERE");
  await ok("A opens with the text that was changed on the other device (and keeps MINE)", /ELSEWHERE/.test(firstBoxText(await live())) && /MINE/.test(firstBoxText(await live())), firstBoxText(await live()));
  await ok("…its saved undo history was DISCARDED (nothing to undo)", (await depth()) === 0, `depth ${await depth()}`);
  const lastRestore = await page.evaluate((id) => (window.__undoCarryLog || []).filter((e) => e.phase === "restore" && String(e.key).endsWith(`|${id}`)).pop(), idD);
  console.log(`   carry log for that open: ${JSON.stringify(lastRestore)}`);
  await ok("…the carry itself says why: it did not restore (stale document)", lastRestore && lastRestore.restored === false && /page-changed/.test(String(lastRestore.reason)), JSON.stringify(lastRestore));
  await undoKey();
  await ok("Ctrl+Z replays nothing over the other device's text", /ELSEWHERE/.test(firstBoxText(await live())) && /MINE/.test(firstBoxText(await live())), firstBoxText(await live()));

  /* ───────── e · delete + paste ───────── */
  console.log("\n=== e · a box DELETE and a real Ctrl+V PASTE still undo after a switch ===");
  const idE = await makePage("alpha-delete", "Alpha delete line");
  await openPage(idB, "Bravo"); await openPage(idE, "Alpha delete");     // a freshly opened page: no caret inside the box (a Delete with the caret in it edits TEXT, not the box)
  const e0 = await live();
  {
    const p = await topBandPoint();
    await page.mouse.click(p.x, p.y); await wait(500);
    await page.keyboard.press("Delete"); await wait(1000);
    await ok("the box was deleted", boxesOf(await live()).length === 0, JSON.stringify(await live()).slice(0, 200));
    const dDel = await depth();
    await openPage(idB, "Bravo"); await openPage(idE, null);
    await ok("back on A the box is still gone and the delete is an undo step", boxesOf(await live()).length === 0 && (await depth()) === dDel && dDel >= 1, `depth ${dDel} → ${await depth()}`);
    await undoKey();
    await ok("Ctrl+Z brings the box back, text and all", boxesOf(await live()).length === 1 && firstBoxText(await live()) === firstBoxText(e0), firstBoxText(await live()));
  }
  {
    const idP = await makePage("alpha-paste", "Alpha paste line");
    await openPage(idB, "Bravo"); await openPage(idP, "Alpha paste");
    await enterBox();
    await page.keyboard.press("End"); await wait(100);
    const selNow = await page.evaluate(() => window.__noteEditor.selection());
    if (!selNow || selNow.from < 2) voidRun(`the caret is not inside the box (${JSON.stringify(selNow)}) — a paste would land outside it`);
    await page.evaluate(() => navigator.clipboard.writeText(" PASTED"));
    await page.keyboard.press("Control+v"); await wait(1500);
    await ok("the real Ctrl+V landed in the box", /PASTED/.test(firstBoxText(await live())), firstBoxText(await live()));
    await page.keyboard.press("Escape").catch(() => {}); await wait(300);
    const dPaste = await depth();
    await openPage(idB, "Bravo"); await openPage(idP, "Alpha paste");
    await ok("back on A the paste is still there with its undo steps", /PASTED/.test(firstBoxText(await live())) && (await depth()) === dPaste, `depth ${dPaste} → ${await depth()}`);
    let n = 0;
    while (/PASTED/.test(firstBoxText(await live()) || "") && n < 4) { await undoKey(); n += 1; }
    await ok("Ctrl+Z takes the paste out", !/PASTED/.test(firstBoxText(await live()) || "") && /Alpha paste/.test(firstBoxText(await live()) || ""), `${n} presses · ${firstBoxText(await live())}`);
    console.log(`   (the paste took ${n} Ctrl+Z press${n === 1 ? "" : "es"})`);
  }

  /* ───────── f · new typing after returning ───────── */
  console.log("\n=== f · typing after coming back is its own step, the old steps are still under it ===");
  const idF = await makePage("alpha-new", "Alpha new line");
  await typeAtEnd(" OLD");
  const dOld = await depth();
  await roundTrip(idB, "Bravo", idF, "Alpha");
  await typeAtEnd(" NEW");
  await ok("one more step on top of the carried ones", (await depth()) === dOld + 1, `depth ${dOld} → ${await depth()}`);
  await undoKey();
  await ok("Ctrl+Z removes only NEW", /OLD/.test(firstBoxText(await live())) && !/NEW/.test(firstBoxText(await live())), firstBoxText(await live()));
  await undoKey();
  await ok("Ctrl+Z again removes OLD (it survived the switch under the new edit)", !/OLD/.test(firstBoxText(await live())), firstBoxText(await live()));

  /* ───────── the carry's own trail ───────── */
  const trail = await page.evaluate(() => (window.__undoCarryLog || []).filter((e) => e.phase === "restore").map((e) => `${e.restored ? "restored" : e.reason}`));
  console.log(`\ncarry decisions this run: ${trail.length} opens → ${JSON.stringify(trail.reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {}))}`);
  await ok("the carry actually restored histories during this run (the run is not vacuous)", trail.filter((r) => r === "restored").length >= 6, JSON.stringify(trail));
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
