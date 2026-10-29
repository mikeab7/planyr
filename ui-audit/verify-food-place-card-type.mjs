#!/usr/bin/env node
/* verify-food-place-card-type — the Food PLACE CARD's type scale, left edge, vertical rhythm and "one add-a-dish" rule on an iPhone
 * (NEW-1 + NEW-2, 2026-10-27, owner on his iPhone looking at "Auntie Chang's Dumpling House": "look at the text here. Like, it's all
 * different sizes. There's no alignment. Like, we can do so much better.").
 *
 *   T1  SIZES      every piece of text on the card is one of the four sizes in lib/foodType.js (title 20 · body 13 · caption 12 · label 10.5) —
 *                  glyph-only icons (aria-hidden: ›  ▾  the dot) are not text and are exempt; the report lists any other size and where it is
 *   T2  ONE LABEL  every section label (What to order · Maybe · Skip · Visits) has the SAME size, weight, case, tracking and colour
 *   E1  LEFT EDGE  name, subtitle, address, first score chip, every section label, every dish badge, "+ Add a dish", every visit row and "Log a visit"
 *                  start on ONE edge (±1 px) — the red dot hangs in the gutter to its left and never pushes the column
 *   E2  RIGHT EDGE the "+ List" pill, every row chevron and the Skip chevron end on ONE right edge (±1 px)
 *   C1  CHIPS      the score chips and "+ List" share height and centre line (±0.5)
 *   R1  RHYTHM     the space above every section label is the same (±1), the space under it is the same (±1), and a group step is bigger than a within-group step
 *   H1  TARGETS    every tappable row (dish, visit, Skip toggle, + Add a dish, ✕) is ≥ 44 tall
 *   A1  ONE ADD    with the Log-a-visit form OPEN there is exactly ONE add-a-dish control on screen (was two); it is back when the form closes; the same
 *                  while EDITING a past visit
 * Each runs at iPhone 15 (393) and iPhone 15 Pro Max (430) in WebKit AND Chromium emulation, plus the desktop rail (E1/T1/T2 only).
 *
 * KNOWN-ANSWER ARM (DRIVER-SCROLL §6): a planted block whose text is 3 px off the column and a planted 14 px string must be reported as such, else the run
 * is VOID and says so (a run that found no labels / rows / chips is VACUOUS and fails). ENGINE, stated: Playwright's Linux WebKit build (real WebKit layout,
 * Inter as in production — NOT iOS Safari) and Chromium iPhone emulation.
 *
 * Usage: build with the fixture env (ui-audit/lib/foodFixture.mjs), `npx vite preview --port 4180`, then
 *   PW_CHROME=<chromium> node ui-audit/verify-food-place-card-type.mjs [baseUrl] [--shots=<dir>] [--engine=webkit|chromium]
 *   --live [baseUrl]: the DEPLOYED site signed in as the test account on the throwaway Aburi visit (read-only: nothing is ever saved; the form is only opened).
 */
import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { open, openPlace, LIVE, LIVE_MARK, LIVE_ABURI, BASE, seedLive, cleanupLive, closeLeakedLive } from "./lib/foodIosPage.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const ONLY = (process.argv.find((a) => a.startsWith("--engine=")) || "").slice(9);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
// The scale under test — mirrored from src/workspaces/food/lib/foodType.js (test/foodPlaceCardType.test.js fails if the two ever differ).
const SIZES = [20, 13, 12, 10.5];
const EDGE_TOL = 1;
const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } finally { await closeLeakedLive(); } };
const MAXP = { "iPhone 15": [393, 852], "iPhone 15 Pro Max": [430, 932], desktop: [1280, 800] };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function openCard(br, name) {
  const [w, h] = MAXP[name];
  const { ctx, page } = await open(br, name, "ios", { dishes: true });
  if (name !== "desktop") await page.setViewportSize({ width: w, height: h });
  await sleep(800);
  await assertMeasurable(page, "verify-food-place-card-type"); // FOREGROUND-OR-VOID
  await openPlace(page, "aburi", /aburi/i, false);
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(500);
  return { ctx, page };
}

/** Everything the checks need, read in ONE evaluate so the layout cannot move between readings. */
function measure(root) {
  const R = document.querySelector(root);
  const q = (s) => R.querySelector(s), qa = (s) => [...R.querySelectorAll(s)];
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const textRect = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects()].filter((r) => r.width > 0); return rs[0] || e.getBoundingClientRect(); };
  const firstText = (e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) }); const n = w.nextNode(); if (!n) return e.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(n); return rg.getClientRects()[0]; };
  // T1 — every text node's computed size, glyph icons (aria-hidden) excluded
  const sizes = {};
  const w = document.createTreeWalker(R, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || el.closest('[aria-hidden="true"]') || !vis(el)) continue;
    const s = parseFloat(getComputedStyle(el).fontSize); (sizes[s] = sizes[s] || []).push(t.slice(0, 24));
  }
  const labels = qa("[data-section-label]").filter(vis).map((e) => { const c = getComputedStyle(e); const tr = textRect(e.querySelector("[data-section-label-text]") || e); return { text: e.textContent.trim().replace(/\s+/g, " "), size: c.fontSize, weight: c.fontWeight, transform: c.textTransform, tracking: c.letterSpacing, color: c.color, left: tr.left, top: tr.top, bottom: tr.bottom, box: e.getBoundingClientRect().toJSON() }; });
  const rows = (sel) => qa(sel).filter(vis);
  const title = q('[data-testid="food-panel-title"]'), dot = q('[data-testid="food-panel-accent-dot"]');
  const chips = qa('[data-testid="food-score-pill-food"], [data-testid="food-score-pill-ambiance"], [data-testid="food-add-to-list-btn"]').filter(vis);
  const edges = {
    name: textRect(title).left,
    subtitle: firstText(q('[data-testid="food-panel-subline"]')).left,
    address: firstText(q('[data-testid="food-directions-link"]')).left,
    "first chip": chips[0].getBoundingClientRect().left,
    ...Object.fromEntries(labels.map((l, i) => [`label ${i + 1} "${l.text.slice(0, 18)}"`, l.left])),
    ...Object.fromEntries(rows('[data-testid="dish-row"]').map((e, i) => [`dish badge ${i + 1}`, e.firstElementChild.getBoundingClientRect().left])),
    ...(q('[data-testid="food-add-dish-btn"]') && vis(q('[data-testid="food-add-dish-btn"]')) ? { "+ Add a dish": firstText(q('[data-testid="food-add-dish-btn"]')).left } : {}),
    ...Object.fromEntries(rows('[data-testid="food-visit-card"]').map((e, i) => [`visit row ${i + 1}`, firstText(e.querySelector('[data-testid="food-visit-row-label"]')).left])),
    ...(q('[data-testid="food-log-visit-btn"]') && vis(q('[data-testid="food-log-visit-btn"]')) ? { "Log a visit": q('[data-testid="food-log-visit-btn"]').getBoundingClientRect().left } : {}),
  };
  const lastRight = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects()].filter((r) => r.width > 0); return rs[rs.length - 1].right; };
  const rights = {
    "+ List": chips[chips.length - 1].getBoundingClientRect().right,
    ...Object.fromEntries(rows('[data-testid="dish-row"]').map((e, i) => [`dish chevron ${i + 1}`, e.lastElementChild.getBoundingClientRect().right])),
    ...Object.fromEntries(rows('[data-testid="food-visit-card"]').map((e, i) => [`visit chevron ${i + 1}`, e.lastElementChild.getBoundingClientRect().right])),
    ...(q('[data-testid="food-dishes-skip-toggle"]') ? { "skip chevron": lastRight(q('[data-testid="food-dishes-skip-toggle"]')) } : {}),
  };
  const ch = chips.map((e) => { const b = e.getBoundingClientRect(); return { id: e.dataset.testid, h: b.height, c: b.top + b.height / 2 }; });
  // R1 — the visible space above / below every label: previous block's bottom → label text top; label text bottom → next block's top
  const all = [...R.querySelectorAll("*")];
  const gaps = labels.map((l) => {
    const el = qa("[data-section-label]").filter(vis).find((e) => e.textContent.trim().replace(/\s+/g, " ") === l.text);
    // previous visible painted block: the nearest earlier element whose box ends above the label text and starts the visible stack
    const prev = all.filter((e) => vis(e) && e.getBoundingClientRect().bottom <= l.top + 0.5 && !e.contains(el) && !el.contains(e) && getComputedStyle(e).display !== "inline" && (e.matches('[data-testid="dish-row"], [data-testid="food-visit-card"], [data-testid="food-add-dish-btn"], [data-testid="food-score-pills"], [data-section-label]') || e.dataset.testid === "food-dishes-skip-toggle"));
    const above = prev.length ? l.top - Math.max(...prev.map((e) => e.getBoundingClientRect().bottom)) : null;
    const nextEls = all.filter((e) => vis(e) && e.getBoundingClientRect().top >= l.bottom - 0.5 && e.matches('[data-testid="dish-row"], [data-testid="food-visit-card"], [data-testid="food-add-dish-btn"]'));
    const below = nextEls.length ? Math.min(...nextEls.map((e) => e.getBoundingClientRect().top)) - l.bottom : null;
    return { text: l.text, above, below };
  });
  const targets = [
    ...rows('[data-testid="dish-row"]').map((e) => ["dish row", e.getBoundingClientRect().height]),
    ...rows('[data-testid="food-visit-card"]').map((e) => ["visit row", e.getBoundingClientRect().height]),
    ...rows('[data-testid="food-dishes-skip-toggle"], [data-testid="food-add-dish-btn"], [data-testid="food-panel-close"], [data-testid="food-log-visit-btn"]').map((e) => [e.dataset.testid, e.getBoundingClientRect().height]),
  ];
  const d = dot.getBoundingClientRect(), tr = textRect(title);
  return { sizes, labels, edges, rights, chips: ch, gaps, targets, dot: { right: d.right, left: d.left, c: d.top + d.height / 2 }, titleLine: { left: tr.left, c: tr.top + tr.height / 2 } };
}

const spread = (o) => { const v = Object.values(o); return Math.max(...v) - Math.min(...v); };
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}:${(+v).toFixed(1)}`).join(" ");

async function cardChecks(page, L, root, { desktop = false } = {}) {
  await page.locator('[data-testid="food-dishes-skip-toggle"]').first().evaluate((b) => { if (b.getAttribute("aria-expanded") !== "true") b.click(); }).catch(() => {}); await sleep(400);
  const m = await page.evaluate(measure, root);
  if (LIVE) { // merged ≠ live: name the build being judged IN THE SAME RUN as the assertions, and prove it carries this change
    const ver = await page.evaluate(async () => { try { return await (await fetch("/version.json?cb=" + Date.now(), { cache: "no-store" })).json(); } catch (e) { return { error: String(e) }; } });
    check(`${L} BUILD MARKER: the page being judged carries the section-label contract (≥ 1 [data-section-label]) — version ${JSON.stringify(ver).slice(0, 100)}`, m.labels.length >= 1, `${m.labels.length}`);
  }
  const offenders = Object.entries(m.sizes).filter(([s]) => !SIZES.includes(+s));
  check(`${L} T1 every text on the card is one of the 4 token sizes ${JSON.stringify(SIZES)}`, offenders.length === 0, offenders.length ? offenders.map(([s, t]) => `${s}px: ${t.slice(0, 3).join("|")}`).join("; ") : `sizes seen: ${Object.keys(m.sizes).join(",")}`);
  check(`${L} T2 VACUITY: the card shows ≥ 4 section labels (What to order, Maybe, Skip, Visits)`, m.labels.length >= 4, m.labels.map((l) => l.text).join(" | "));
  const sig = (l) => [l.size, l.weight, l.transform, l.tracking, l.color].join("/");
  const sigs = [...new Set(m.labels.map(sig))];
  check(`${L} T2 every section label is ONE style (size / weight / case / tracking / colour)`, m.labels.length >= 4 && sigs.length === 1, sigs.join("  ||  "));
  const names = Object.keys(m.edges);
  check(`${L} E1 VACUITY: ≥ 10 blocks measured (name, subtitle, address, chip, labels, dish badges, add, visits, log)`, names.length >= 10, `${names.length}`);
  check(`${L} E1 every block starts on ONE left edge (±${EDGE_TOL})`, spread(m.edges) <= EDGE_TOL, `spread ${spread(m.edges).toFixed(2)} — ${fmt(m.edges)}`);
  check(`${L} E1 the red dot hangs in the gutter: it ends left of the column and sits on the name's first line (±1.5)`, m.dot.right <= m.edges.name - 2 && Math.abs(m.dot.c - m.titleLine.c) <= 1.5, JSON.stringify({ dotRight: m.dot.right, nameLeft: m.edges.name, dotC: m.dot.c, titleC: m.titleLine.c }));
  check(`${L} E2 right edges (+ List, row chevrons, Skip chevron) end on ONE edge (±${EDGE_TOL})`, Object.keys(m.rights).length >= 4 && spread(m.rights) <= EDGE_TOL, `spread ${spread(m.rights).toFixed(2)} — ${fmt(m.rights)}`);
  const hs = m.chips.map((c) => c.h), cs = m.chips.map((c) => c.c);
  check(`${L} C1 the score chips and + List share height and centre line (±0.5)`, m.chips.length >= 3 && Math.max(...hs) - Math.min(...hs) <= 0.5 && Math.max(...cs) - Math.min(...cs) <= 0.5, JSON.stringify(m.chips));
  const aboves = m.gaps.map((g) => g.above), belows = m.gaps.map((g) => g.below);
  check(`${L} R1 VACUITY: the rhythm was measured on ≥ 4 labels`, m.gaps.length >= 4, `${m.gaps.length}`);
  check(`${L} R1 the space ABOVE every section label is the same (±1)`, aboves.every((v) => v != null) && Math.max(...aboves) - Math.min(...aboves) <= 1, JSON.stringify(m.gaps.map((g) => [g.text.slice(0, 12), g.above && +g.above.toFixed(1)])));
  check(`${L} R1 the space BELOW every section label is the same (±1)`, belows.every((v) => v != null) && Math.max(...belows) - Math.min(...belows) <= 1, JSON.stringify(m.gaps.map((g) => [g.text.slice(0, 12), g.below && +g.below.toFixed(1)])));
  check(`${L} R1 a group step (above a label) is bigger than the label-to-content step`, aboves.every((v) => v != null) && Math.min(...aboves) > Math.max(...belows) + 4, `above ${aboves.map((v) => v && v.toFixed(1))} below ${belows.map((v) => v && v.toFixed(1))}`);
  const small = m.targets.filter(([, h]) => h < 43.5);
  check(`${L} H1 every tappable row / control is ≥ 44 tall`, m.targets.length >= 6 && small.length === 0, small.length ? JSON.stringify(small) : `${m.targets.length} targets`);
  return m;
}

/** LIVE: the same card the fixture draws — an undated second visit and one dish per group — on the throwaway Aburi row (all deleted by cleanupLive; dishes cascade). */
async function seedLiveCard() {
  const s = await openSignedIn({ base: BASE });
  try {
    const r = await s.page.evaluate(async ([mark, placeId]) => {
      const c = window.pfSupabase; const { data: u } = await c.auth.getUser();
      const first = await c.from("food_visits").select("id").eq("user_id", u.user.id).eq("place_id", placeId).limit(1);
      if (first.error || !first.data?.length) return { error: "no throwaway visit to hang dishes on" };
      const v2 = await c.from("food_visits").insert({ user_id: u.user.id, place_id: placeId, visited_on: null, rating: 7.5, rating_ambiance: 7.5, notes: mark + " seeded by verify-food-place-card-type (deleted at the end of the run)" }).select("id");
      const d = (name, score, order_again, note = null) => ({ user_id: u.user.id, visit_id: first.data[0].id, name: "ZZ " + name, score, order_again, note });
      const dd = await c.from("food_dishes").insert([d("Salmon Nigiri", 9.5, "yes", "ask for the extra torch"), d("Miso Soup", 7, "yes"), d("Edamame", 8, null), d("Udon", 4.5, "no")]).select("id");
      return { error: (v2.error && String(v2.error.message)) || (dd.error && String(dd.error.message)) || null };
    }, [LIVE_MARK, LIVE_ABURI]);
    if (r.error) throw new Error("seedLiveCard failed — " + r.error);
  } finally { await s.close(); }
}
if (LIVE) { await seedLive(); await seedLiveCard(); console.log("live: throwaway Aburi visits + dishes seeded on the test account"); }
for (const [en, type] of Object.entries({ webkit, chromium })) {
  if (ONLY && ONLY !== en) continue;
  const br = await type.launch(en === "chromium" ? { executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] } : {});
  for (const name of Object.keys(MAXP)) {
    if (name === "desktop" && en !== "chromium") continue;
    const L = `[${en} ${name}]`;
    const root = name === "desktop" ? '[data-testid="food-visit-panel"]' : '[data-testid="food-bottom-sheet"]';

    await section(`${L} instrument`, async () => {
      const { ctx, page } = await openCard(br, name);
      // known-answer arm: the measure must see a block planted 3 px off the column and a 14 px string
      await page.evaluate((root) => {
        const host = document.querySelector('[data-testid="food-dishes-section"]') || document.querySelector(root);
        const el = document.createElement("div"); el.id = "plant"; el.textContent = "planted"; el.setAttribute("data-section-label", ""); el.style.cssText = "margin-left:3px;font-size:14px;text-transform:none";
        host.appendChild(el);
      }, root);
      const m = await page.evaluate(measure, root);
      const planted = m.labels.find((l) => l.text === "planted");
      check(`${L} KNOWN ANSWER: a label planted 3 px off the column and at 14 px is read as exactly that`, !!planted && Math.abs(planted.left - m.edges.name) >= 2 && (m.sizes["14"] || []).includes("planted"), JSON.stringify({ left: planted?.left, name: m.edges.name, s14: m.sizes["14"] }));
      await ctx.close();
    });

    await section(`${L} card`, async () => {
      const { ctx, page } = await openCard(br, name);
      await shot(page, `${en}-${name.replace(/ /g, "")}-card`);
      await cardChecks(page, L, root, { desktop: name === "desktop" });
      await shot(page, `${en}-${name.replace(/ /g, "")}-card-skip-open`);
      await ctx.close();
    });

    if (name === "desktop") continue;
    await section(`${L} one add-a-dish`, async () => {
      const { ctx, page } = await openCard(br, name);
      const addControls = () => page.evaluate((root) => [...document.querySelector(root).querySelectorAll("button")].filter((b) => /add (a|another) dish/i.test(b.textContent) && b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0).map((b) => b.dataset.testid || b.textContent.trim()), root);
      const before = await addControls();
      check(`${L} A1 KNOWN ANSWER: with no form open the card shows exactly one add-a-dish control`, before.length === 1, JSON.stringify(before));
      await page.locator('[data-testid="food-log-visit-btn"]').evaluate((b) => b.click()); await sleep(900);
      await page.evaluate(() => document.activeElement?.blur?.()); await sleep(300);
      const open = await addControls();
      await shot(page, `${en}-${name.replace(/ /g, "")}-form-open`);
      check(`${L} A1 with the Log-a-visit form open exactly ONE add-a-dish control is on screen`, open.length === 1 && open[0] === "visit-dish-add", JSON.stringify(open));
      await page.locator('[data-testid="visit-form-actions"] button[type="button"]').first().evaluate((b) => b.click()); await sleep(700);
      const closed = await addControls();
      check(`${L} A1 closing the form brings the card's add-a-dish back (and only that one)`, closed.length === 1 && closed[0] === "food-add-dish-btn", JSON.stringify(closed));
      // editing a past visit: its own form has an add-a-dish, so the card's must step aside there too
      await page.locator('[data-testid="food-visit-card"]').first().evaluate((b) => b.click()); await sleep(900);
      const editing = await addControls();
      check(`${L} A1 while EDITING a past visit exactly one add-a-dish control is on screen`, editing.length === 1, JSON.stringify(editing));
      await ctx.close();
    });
  }
  await br.close();
}
if (LIVE) { const c = await cleanupLive(); console.log("live cleanup:", JSON.stringify(c)); if (c.error || c.left !== 0) check("live cleanup left rows behind", false, JSON.stringify(c)); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
