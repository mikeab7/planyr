#!/usr/bin/env node
/* verify-map-notes.mjs — map notes, driven in a real browser at the owner's window (NEW-1).
 *
 * WHAT THIS CAN AND CANNOT PROVE, said up front rather than implied by a score. Every WRITE path
 * (place → save → reopen → edit → soft-delete a real row) needs a signed-in session, and this
 * sandbox's proxy CORS-blocks the Supabase auth handshake — that is `Blocker: auth`, and those legs
 * are logged in VERIFICATION.md, not silently counted here. What IS Claude-doable logged out, and is
 * therefore driven here rather than deferred (ATTEMPT-BEFORE-YOU-PARK):
 *   · the Notes layer toggle exists beside Sites and Comps, with a count, and persists
 *   · the pin entry point — Drop a pin, then "Record info ▾" → "Add a note" — opens the editor
 *   · the note verb sits in the SAME "Record info" menu as Log a comp / Place a site plan
 *     (B1892544, 2026-09-24 — moved off the bar itself, which now shows only "Plan this site"
 *     and "Record info ▾" as direct controls)
 *   · the editor refuses to save an empty note, in a sentence, and Escape / Cancel closes it
 *   · a placed-then-cancelled note writes NOTHING — no row, no marker, no residue
 *
 * ⛔ FOREGROUND-OR-VOID: `assertMeasurable` first. Every reading below is a DOM geometry read after
 * a view/state change, which is exactly the class a suspended rAF makes internally consistent and
 * wrong. ⛔ And the decide bar is chrome that DOES NOT EXIST until ground has been pointed at — the
 * probe therefore asks its question AFTER the interaction, never from a DOM read before it, and it
 * asserts the bar's ABSENCE first as its known-good arm.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
// Two lines rather than one destructure: `test/tabTiming.test.js` requires the precondition's
// import to be present VERBATIM in every browser-driving harness, so it cannot be hidden behind a
// combined import a future edit might quietly drop.
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4183/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
/* The owner's real window (stated in the brief), not a comfortable default — a short viewport is
   where a floating card collides with the toolbar and the cursor chip. */
const VIEWPORT = { width: 1600, height: 465 };

const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-map-notes");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await pacedWait(page, 2200);

const mapBox = await page.evaluate(() => {
  const r = document.querySelector(".leaflet-container").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

// ── 1 · THE LAYER TOGGLE ──────────────────────────────────────────────────────────────────────
{
  // The Imagery & layers panel starts collapsed at this height; open it the way a user does.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Imagery & layers/i.test(b.textContent || ""));
    if (!btn) return false;
    if (!document.querySelector('[data-testid="map-show-notes"]')) btn.click();
    return true;
  });
  await pacedWait(page, 500);
  const row = await page.evaluate(() => {
    const cb = document.querySelector('[data-testid="map-show-notes"]');
    if (!cb) return null;
    const label = cb.closest("label");
    const r = label.getBoundingClientRect();
    const sites = document.querySelector('[data-testid="map-show-sites"]')?.closest("label")?.getBoundingClientRect();
    const comps = document.querySelector('[data-testid="map-show-comps"]')?.closest("label")?.getBoundingClientRect();
    return { text: (label.textContent || "").trim(), checked: cb.checked, top: r.top, w: r.width, h: r.height,
             sitesTop: sites?.top ?? null, compsTop: comps?.top ?? null };
  });
  ok("1 · the layers panel opens", opened);
  ok("1 · a Notes toggle exists", !!row, row ? row.text : "not found");
  ok("1 · it sits with Sites and Comps, below both", !!row && row.sitesTop < row.top && row.compsTop < row.top);
  ok("1 · it is ON by default, like its two neighbours", !!row && row.checked === true);
  ok("1 · the row is really on screen at this height (not clipped to zero)", !!row && row.w > 40 && row.h > 8,
     row ? `${row.w.toFixed(0)}×${row.h.toFixed(0)}` : "");

  // Toggling it off must persist across a reload — the same rule its neighbours follow.
  await page.click('[data-testid="map-show-notes"]');
  await pacedWait(page, 300);
  const stored = await page.evaluate(() => localStorage.getItem("planarfit:mapShowNotes:v1"));
  ok("1 · unticking it is remembered", stored === "0", `stored ${stored}`);
  await page.click('[data-testid="map-show-notes"]');
  await pacedWait(page, 300);
  ok("1 · re-ticking it is remembered too", (await page.evaluate(() => localStorage.getItem("planarfit:mapShowNotes:v1"))) === "1");
}

// ── 2 · THE PIN ENTRY POINT (drop a pin → the decide bar → "Record info" → "Add a note") ─────
// ⛔ TWO-PRESS SHAPE: the decide bar does not exist until a pin is dropped, so the question is
// asked AFTER the interaction. Its absence beforehand is the known-good arm — a probe that cannot
// tell "not mounted" from "mounted" proves nothing about either.
// B1892544 (2026-09-24) — "Add a note" moved off the bar into the "Record info ▾" menu, so it is
// now a THREE-press shape: drop the pin, open the menu, then press the row.
const CLICK = { x: mapBox.x + mapBox.w * 0.42, y: mapBox.y + mapBox.h * 0.55 };
{
  const before = await page.evaluate(() => document.querySelectorAll('[data-testid^="map-decide-verb-"]').length);
  ok("2 · with no ground pointed at, the decide bar is correctly absent (known-good arm)", before === 0);

  await page.click('[data-testid="map-toolbar-drop-pin"]');
  await pacedWait(page, 300);
  await page.mouse.click(CLICK.x, CLICK.y);
  await pacedWait(page, 700);

  const direct = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="map-decide-verb-"], [data-testid="map-decide-record-info"]')]
    .map((b) => ({ key: (b.dataset.testid || "").replace("map-decide-verb-", ""), text: (b.textContent || "").trim() })));
  ok("2 · dropping a pin raises the decide bar", direct.length > 0, `${direct.length} direct controls`);
  ok("2 · 'Plan this site' and 'Record info' are its two direct controls",
     direct.some((v) => v.key === "site") && direct.some((v) => v.key === "map-decide-record-info"),
     direct.map((v) => v.text).join(" · "));

  await page.click('[data-testid="map-decide-record-info"]');
  await pacedWait(page, 300);

  const verbs = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="map-decide-verb-"]')]
    .filter((b) => b.dataset.testid !== "map-decide-verb-site")
    .map((b) => ({ key: b.dataset.testid.replace("map-decide-verb-", ""), text: (b.textContent || "").trim(),
                   w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
  ok("2 · opening 'Record info' reveals 'Add a note' among its rows", verbs.some((v) => v.key === "note"),
     verbs.map((v) => v.text).join(" · "));
  ok("2 · it sits beside the other two record verbs in the same menu",
     ["comp", "siteplan"].every((k) => verbs.some((v) => v.key === k)));
  const note = verbs.find((v) => v.key === "note");
  // B1892544 — the row's textContent concatenates its title AND subtitle spans with no
  // separator ("Add a notePin a comment to the map"), so this checks the PREFIX rather than
  // an exact match.
  ok("2 · its title reads 'Add a note'", !!note && note.text.startsWith("Add a note"), note ? note.text : "");
  ok("2 · it is a real, clickable control", !!note && note.w > 40 && note.h > 8);

  const hits = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="map-decide-verb-note"]');
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el ? (el.closest("[data-testid]")?.dataset.testid || el.tagName) : null;
  });
  ok("2 · nothing paints over it (its own centre answers to it)", hits === "map-decide-verb-note", `elementFromPoint → ${hits}`);

  await page.click('[data-testid="map-decide-verb-note"]');
  await pacedWait(page, 700);
}

// ── 3 · THE EDITOR ────────────────────────────────────────────────────────────────────────────
{
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="map-note-editor"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const save = document.querySelector('[data-testid="map-note-save"]');
    return {
      x: r.left, y: r.top, w: r.width, h: r.height,
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      kind: (el.textContent || "").includes("Dropped pin"),
      hasBody: !!document.querySelector('[data-testid="map-note-body"]'),
      hasSite: !!document.querySelector('[data-testid="map-note-site"]'),
      saveDisabled: save ? save.disabled : null,
      // a NEW note has no Delete — there is nothing to delete yet
      hasDelete: !!document.querySelector('[data-testid="map-note-delete"]'),
    };
  });
  ok("3 · the editor opens on the clicked point", !!card);
  ok("3 · it fits entirely inside the owner's short window", !!card && card.inViewport,
     card ? `${card.w.toFixed(0)}×${card.h.toFixed(0)} at ${card.x.toFixed(0)},${card.y.toFixed(0)}` : "");
  ok("3 · it says which kind of anchor it is on", !!card && card.kind);
  ok("3 · it offers a text area", !!card && card.hasBody);
  // NEW-2 (2026-09-24) — the site-picker step is GONE (it listed every site on the account,
  // regardless of where they actually were): the editor must never grow one back.
  ok("3 · it does NOT offer a site picker (removed, NEW-2)", !!card && card.hasSite === false);
  ok("3 · a brand-new note offers no Delete", !!card && card.hasDelete === false);
  ok("3 · Save is refused while the note is empty (never writes a findable-by-nobody pin)",
     !!card && card.saveDisabled === true);

  // Typing enables Save — the refusal is about EMPTINESS, not a dead button.
  await page.click('[data-testid="map-note-body"]');
  await page.keyboard.type("Throwaway check — old fence sits inside the north line.");
  await pacedWait(page, 250);
  const afterTyping = await page.evaluate(() => ({
    disabled: document.querySelector('[data-testid="map-note-save"]').disabled,
    value: document.querySelector('[data-testid="map-note-body"]').value,
  }));
  ok("3 · typing a note enables Save", afterTyping.disabled === false);
  ok("3 · the text really lands in the field (a real keystroke, not a synthetic event)",
     afterTyping.value.startsWith("Throwaway check"), afterTyping.value.slice(0, 24));
  await page.screenshot({ path: OUT + "map-notes-editor-1600x465.png" });
}

// ── 4 · CANCEL WRITES NOTHING ─────────────────────────────────────────────────────────────────
{
  await page.keyboard.press("Escape");
  await pacedWait(page, 400);
  const gone = await page.evaluate(() => ({
    editor: !!document.querySelector('[data-testid="map-note-editor"]'),
    markers: document.querySelectorAll(".map-note-feature").length,
  }));
  ok("4 · Escape closes the editor", gone.editor === false);
  ok("4 · a placed-then-cancelled note leaves no marker behind", gone.markers === 0);
}

// ── 5 · THE PARCEL ENTRY POINT ────────────────────────────────────────────────────────────────
// Selecting a real parcel needs the county GIS service, which this sandbox's egress blocks
// (`Blocker: live-GIS`), so what is checked here is the half that does NOT need one: the note verb
// takes whatever ground the bar is about, so the SAME button covers a parcel selection — proven by
// the shared verb table (test/mapNotesWiring.test.js) rather than claimed as a live pass here.
// The live parcel leg is a step in VERIFICATION.md, not a score on this run.
{
  const absent = await page.evaluate(() => document.querySelectorAll('[data-testid="map-decide-verb-note"]').length);
  ok("5 · with the pin consumed, the decide bar is gone again (known-good arm)", absent === 0);
}

ok("· no page errors during the run", errs.length === 0, errs[0] || "");

const pass = results.filter((r) => r.pass).length;
console.log(`\n  ${pass}/${results.length} checks passed at ${VIEWPORT.width}×${VIEWPORT.height}`);
console.log("  ⚠ Signed-in write legs (save · reopen+edit · soft-delete a real row) are Blocker: auth — see VERIFICATION.md.");
await ctx.close();
await browser.close();
process.exit(pass === results.length ? 0 : 1);
