/* verify-notes-box-selection — THE ADVERSARIAL PASS THE OWNER ASKED FOR, BY NAME.
 *
 * ⛔ HIS INSTRUCTION, VERBATIM: *"Before you report any of the three as done, attack each one
 * deliberately… For every fix, ask: 'what did I verify, and could that check pass while the
 * feature is still broken?' … Try to REFUTE each fix rather than confirm it. Default to refuted if
 * uncertain."*
 *
 * ⛔ AND THE REASON HE HAD TO SAY IT. Resize was reported fixed the round before on a harness that
 * WAS green and DID read storage. It passed because a signed-out sandbox has nothing that
 * re-renders a node view mid-gesture, and the commit read `dom.style.width` — a value any
 * re-render rewrites from the node's current attrs. On his signed-in account a sync tick does
 * exactly that, so the drag committed the width the box already had while going on RENDERING at
 * the size he dragged to. Measured on his account: rendered 300, stored 180, 180 after a reload.
 * "It does not work" would have been the kinder failure; this one looked like it worked.
 *
 * So this file is built to REFUTE, not to confirm. Every persistence claim is checked at the
 * DOCUMENT level and then again AFTER A RELOAD, and the hard cases — an interfering re-render
 * mid-gesture, a box that was moved first, a zoom other than 100%, the last box on a crowded page
 * — are the point of it rather than an appendix.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const pageErrors = [];

/** ⛔ THE STORED ATTRS — the ONLY thing that counts for anything claiming to persist. */
const storedBoxes = (page) => page.evaluate((k) => {
  const doc = JSON.parse(localStorage.getItem(k) || "null");
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") {
      const t = [];
      const dig = (x) => { if (x?.type === "text") t.push(x.text); (x?.content || []).forEach(dig); };
      dig(n);
      out.push({ x: n.attrs.x, y: n.attrs.y, w: n.attrs.w, text: t.join("") });
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}, `${PAGE_PREFIX}p1`);

const renderedBoxes = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="note-anchor"]')].map((el) => ({
    x: Math.round(parseFloat(el.style.left)),
    y: Math.round(parseFloat(el.style.top)),
    w: Math.round(parseFloat(el.style.width)),
    selected: el.getAttribute("data-selected") === "1",
    text: (el.querySelector(".planyr-anchor-content") || el).innerText.trim(),
  })));

/** Which affordances are actually VISIBLE — opacity, not merely present in the DOM. */
const visibleControls = (page, idx = 0) => page.evaluate((i) => {
  const el = [...document.querySelectorAll('[data-testid="note-anchor"]')][i];
  if (!el) return null;
  const seen = [];
  for (const id of ["note-anchor-grip", "note-anchor-delete", "note-anchor-size"]) {
    const n = el.querySelector(`[data-testid="${id}"]`);
    if (n && parseFloat(getComputedStyle(n).opacity) > 0.05) seen.push(id);
  }
  return seen;
}, idx);

/* ⛔ SCROLLED INTO VIEW FIRST. On the short window the last box of a crowded page sits below the
 * fold, so its centre is an off-screen coordinate — a click there lands on nothing and the harness
 * reports "clicking the last box selects nothing" about a box it never actually clicked. That is
 * the instrument's blind spot reported as the app's defect, which this file exists to avoid. */
const centreOf = async (page, idx) => {
  await page.evaluate((i) => {
    const el = [...document.querySelectorAll('[data-testid="note-anchor"]')][i];
    el?.scrollIntoView({ block: "center" });
  }, idx);
  await pacedWait(page, 250);
  return page.evaluate((i) => {
    const el = [...document.querySelectorAll('[data-testid="note-anchor"]')][i];
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, idx);
};

const handleOf = async (page, idx, which) => {
  await page.evaluate((i) => {
    const el = [...document.querySelectorAll('[data-testid="note-anchor"]')][i];
    el?.scrollIntoView({ block: "center" });
  }, idx);
  await pacedWait(page, 250);
  return page.evaluate(([i, w]) => {
  const el = [...document.querySelectorAll('[data-testid="note-anchor"]')][i];
  const n = el?.querySelector(`[data-testid="${w}"]`);
  if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, [idx, which]);
};

async function seed(page, boxes) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix, list]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Grand Port", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [...list.map((b) => ({ type: "noteAnchor", attrs: { x: b.x, y: b.y, w: b.w }, content: [P(b.t)] })), P("Flow text.")],
    }));
  }, [TREE_KEY, PAGE_PREFIX, boxes]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
  await pacedWait(page, 800);
}

const ONE = [{ x: 60, y: 120, w: 180, t: "a box" }];
const CROWDED = [
  { x: 40, y: 90, w: 150, t: "one" }, { x: 40, y: 160, w: 150, t: "two" },
  { x: 40, y: 230, w: 150, t: "three" }, { x: 40, y: 300, w: 150, t: "four" },
  { x: 40, y: 370, w: 150, t: "last" },
];

/** Drag a handle by a client delta. `interfere` re-renders the node view mid-gesture, which is
 *  what a sync tick does on a signed-in account and what nothing does in a sandbox. */
async function dragHandle(page, idx, which, dx, dy, { interfere = false } = {}) {
  const h = await handleOf(page, idx, which);
  if (!h) return false;
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(Math.round(h.x + (dx * i) / 6), Math.round(h.y + (dy * i) / 6));
    await pacedWait(page, 30);
  }
  if (interfere) {
    await page.evaluate((i) => {
      const el = [...document.querySelectorAll('[data-testid="note-anchor"]')][i];
      el.style.width = `${el.getAttribute("data-anchor-w") ? 180 : 180}px`;   // a re-render's reset
      el.style.left = "60px";
    }, idx);
  }
  await page.mouse.up();
  await pacedWait(page, 1300);          // past the editor's 600 ms save debounce
  return true;
}

async function reload(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
  await pacedWait(page, 800);
}

async function run(label, { width, height, zoomSteps = 0 }) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "verify-notes-box-selection");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seed(page, ONE);

  if (zoomSteps) {
    await page.keyboard.down("Control");
    for (let i = 0; i < zoomSteps; i += 1) await page.keyboard.press("Equal");
    await page.keyboard.up("Control");
    await pacedWait(page, 600);
  }

  /* ═══ ATTACK 1 — HOVER MUST DO NOTHING AT ALL (NEW-3) ═════════════════════════════════════ */
  await page.mouse.move(5, 5);
  await pacedWait(page, 200);
  ok(`${label} · nothing is selected to begin with`, !(await renderedBoxes(page))[0].selected);
  const c0 = await centreOf(page, 0);
  await page.mouse.move(c0.x, c0.y);          // HOVER only — no press
  await pacedWait(page, 500);
  ok(`${label} · ⛔ HOVERING A BOX REVEALS NOTHING`, (await visibleControls(page)).length === 0, JSON.stringify(await visibleControls(page)));
  ok(`${label} · …and hovering does not select it either`, !(await renderedBoxes(page))[0].selected);

  /* ═══ ATTACK 2 — A CLICK SELECTS, AND SELECTION IS VISIBLE (NEW-1) ════════════════════════ */
  await page.mouse.click(c0.x, c0.y);
  await pacedWait(page, 400);
  ok(`${label} · ⛔ CLICKING A BOX SELECTS IT`, (await renderedBoxes(page))[0].selected);
  ok(`${label} · …and NOW the controls are there`, (await visibleControls(page)).length === 3, JSON.stringify(await visibleControls(page)));

  /* ═══ ATTACK 3 — SELECTED, DELETE REMOVES IT; UNDO BRINGS IT BACK ═════════════════════════ */
  const beforeDel = await storedBoxes(page);
  await page.keyboard.press("Delete");
  await pacedWait(page, 1300);
  ok(`${label} · ⛔ DELETE REMOVES A SELECTED BOX`, (await storedBoxes(page)).length === beforeDel.length - 1,
    `${beforeDel.length} → ${(await storedBoxes(page)).length}`);
  await page.keyboard.press("Control+z");
  await pacedWait(page, 1300);
  ok(`${label} · ⛔ …AND Ctrl+Z BRINGS IT BACK`, (await storedBoxes(page)).length === beforeDel.length,
    `${(await storedBoxes(page)).length} of ${beforeDel.length}`);
  await reload(page);
  ok(`${label} · ⛔ …AND IT IS STILL THERE AFTER A RELOAD — the undo reached storage`,
    (await storedBoxes(page)).length === beforeDel.length);

  /* ═══ ATTACK 4 — THE ONE THAT PRODUCED THIS ROUND: DOES RESIZE PERSIST? ═══════════════════ */
  await seed(page, ONE);
  const w0 = (await storedBoxes(page))[0].w;
  await page.mouse.click((await centreOf(page, 0)).x, (await centreOf(page, 0)).y);
  await pacedWait(page, 400);
  await dragHandle(page, 0, "note-anchor-size", 110, 0);
  const wAfter = (await storedBoxes(page))[0].w;
  const rAfter = (await renderedBoxes(page))[0].w;
  ok(`${label} · ⛔ A RESIZE REACHES THE DOCUMENT`, wAfter > w0, `${w0} → ${wAfter}`);
  ok(`${label} · ⛔ …AND THE RENDER AGREES WITH THE DOCUMENT — no lying about it`,
    Math.abs(rAfter - wAfter) <= 1, `rendered ${rAfter} · stored ${wAfter}`);
  await reload(page);
  const wReload = (await storedBoxes(page))[0].w;
  ok(`${label} · ⛔ …AND IT SURVIVES A RELOAD, which is where his measurement caught it`,
    wReload === wAfter, `${wAfter} → ${wReload}`);
  ok(`${label} · …and renders at the stored width after that reload`,
    Math.abs((await renderedBoxes(page))[0].w - wReload) <= 1);

  /* ═══ ATTACK 5 — A RE-RENDER MID-GESTURE, which is what a sync tick does ══════════════════ */
  await seed(page, ONE);
  const w5 = (await storedBoxes(page))[0].w;
  await page.mouse.click((await centreOf(page, 0)).x, (await centreOf(page, 0)).y);
  await pacedWait(page, 400);
  await dragHandle(page, 0, "note-anchor-size", 110, 0, { interfere: true });
  const w5after = (await storedBoxes(page))[0].w;
  ok(`${label} · ⛔ A RE-RENDER MID-DRAG DOES NOT EAT THE RESIZE`, w5after > w5, `${w5} → ${w5after}`);
  await reload(page);
  ok(`${label} · ⛔ …and THAT survives a reload too`, (await storedBoxes(page))[0].w === w5after);

  /* ═══ ATTACK 6 — RESIZE A BOX YOU HAVE ALREADY MOVED ══════════════════════════════════════ */
  await seed(page, ONE);
  await page.mouse.click((await centreOf(page, 0)).x, (await centreOf(page, 0)).y);
  await pacedWait(page, 400);
  await dragHandle(page, 0, "note-anchor-grip", 120, 70);
  const movedTo = (await storedBoxes(page))[0];
  ok(`${label} · the box really moved first`, movedTo.x !== 60 || movedTo.y !== 120, JSON.stringify(movedTo));
  await dragHandle(page, 0, "note-anchor-size", 90, 0);
  const afterBoth = (await storedBoxes(page))[0];
  ok(`${label} · ⛔ RESIZING A BOX YOU MOVED WIDENS IT`, afterBoth.w > movedTo.w, `${movedTo.w} → ${afterBoth.w}`);
  ok(`${label} · ⛔ …AND DOES NOT MOVE IT`, afterBoth.x === movedTo.x && afterBoth.y === movedTo.y,
    `${movedTo.x},${movedTo.y} → ${afterBoth.x},${afterBoth.y}`);
  await reload(page);
  ok(`${label} · ⛔ …and both survive a reload`, JSON.stringify((await storedBoxes(page))[0]) === JSON.stringify(afterBoth));

  /* ═══ ATTACK 7 — THE LAST BOX ON A CROWDED PAGE ══════════════════════════════════════════ */
  await seed(page, CROWDED);
  const crowd = await storedBoxes(page);
  const lastIdx = crowd.length - 1;
  const cl = await centreOf(page, lastIdx);
  await page.mouse.click(cl.x, cl.y);
  await pacedWait(page, 400);
  const sel = (await renderedBoxes(page)).filter((b) => b.selected);
  ok(`${label} · ⛔ ON A CROWDED PAGE, CLICKING THE LAST BOX SELECTS EXACTLY IT`,
    sel.length === 1 && sel[0].text === "last", JSON.stringify(sel.map((b) => b.text)));
  await dragHandle(page, lastIdx, "note-anchor-size", 80, 0);
  const crowdAfter = await storedBoxes(page);
  ok(`${label} · ⛔ …AND RESIZING IT CHANGES ONLY IT`,
    crowdAfter[lastIdx].w > crowd[lastIdx].w
      && crowdAfter.slice(0, lastIdx).every((b, i) => b.w === crowd[i].w && b.x === crowd[i].x && b.y === crowd[i].y),
    JSON.stringify(crowdAfter.map((b) => b.w)));
  await reload(page);
  ok(`${label} · ⛔ …and the crowded page reloads exactly as it was left`,
    JSON.stringify(await storedBoxes(page)) === JSON.stringify(crowdAfter));

  /* ═══ ATTACK 8 — THE TWO-STAGE MODEL, AND ESCAPE ═════════════════════════════════════════ */
  await seed(page, ONE);
  const c8 = await centreOf(page, 0);
  await page.mouse.click(c8.x, c8.y);
  await pacedWait(page, 350);
  const caretIn = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-anchor"]');
    return !!(el && el.contains(document.activeElement === document.body ? null : document.getSelection()?.anchorNode));
  });
  ok(`${label} · ⛔ PRESS 1 SELECTS THE BOX AND DOES NOT PUT THE CARET IN IT`,
    (await renderedBoxes(page))[0].selected && !(await caretIn()));
  await page.mouse.click(c8.x, c8.y);
  await pacedWait(page, 400);
  ok(`${label} · ⛔ PRESS 2 PUTS THE CARET IN IT — the OneNote second stage`, await caretIn());
  await page.keyboard.press("Escape");
  await pacedWait(page, 400);
  ok(`${label} · ⛔ ESCAPE LEAVES EDITING AND THE BOX IS STILL SELECTED`,
    (await renderedBoxes(page))[0].selected);
  await page.keyboard.press("Escape");
  await pacedWait(page, 400);
  ok(`${label} · ⛔ ESCAPE AGAIN DESELECTS`, !(await renderedBoxes(page))[0].selected);
  ok(`${label} · …and the controls went away with the selection`, (await visibleControls(page)).length === 0);

  /* ═══ ATTACK 9 — TYPING INSIDE A SELECTED BOX MUST NOT DELETE IT ═════════════════════════ */
  await seed(page, ONE);
  const c9 = await centreOf(page, 0);
  await page.mouse.click(c9.x, c9.y);
  await pacedWait(page, 300);
  await page.mouse.click(c9.x, c9.y);          // enter it
  await pacedWait(page, 400);
  await page.keyboard.press("End");
  await page.keyboard.type(" edited", { delay: 20 });
  await pacedWait(page, 1300);
  const typed = await storedBoxes(page);
  ok(`${label} · ⛔ TYPING IN AN ENTERED BOX EDITS ITS WORDS`, typed.length === 1 && typed[0].text.includes("edited"), JSON.stringify(typed.map((b) => b.text)));
  await page.keyboard.press("Backspace");
  await pacedWait(page, 1300);
  const bs = await storedBoxes(page);
  ok(`${label} · ⛔ …AND BACKSPACE THERE DELETES A LETTER, NOT THE WHOLE BOX`,
    bs.length === 1 && bs[0].text.endsWith("edite"), JSON.stringify(bs.map((b) => b.text)));

  /* ═══ ATTACK 10 — PLACING A BOX STILL WORKS, which selection must not have broken ════════ */
  await seed(page, ONE);
  const before10 = await storedBoxes(page);
  const blank = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]');
    const r = body.getBoundingClientRect();
    for (let dy = 40; dy < r.height - 40; dy += 30) {
      for (let dx = r.width - 60; dx > r.width / 2; dx -= 40) {
        const x = Math.round(r.left + dx);
        const y = Math.round(r.top + dy);
        if (x > window.innerWidth - 8 || y > window.innerHeight - 8) continue;
        if (document.elementFromPoint(x, y) === body) return { x, y };
      }
    }
    return null;
  });
  if (!blank) ok(`${label} · a blank point could be found to press`, false);
  else {
    await page.mouse.click(blank.x, blank.y);
    await pacedWait(page, 300);
    await page.keyboard.type("fresh", { delay: 20 });
    await pacedWait(page, 1300);
    const after10 = await storedBoxes(page);
    ok(`${label} · ⛔ A PRESS ON BLANK PAGE STILL PLACES A BOX`, after10.length === before10.length + 1,
      `${before10.length} → ${after10.length}`);
  }

  await ctx.close();
}

await run("A · a full window", { width: 1500, height: 950 });
await run("B · a SHORT window, which is his", { width: 1280, height: 620 });
await run("C · zoomed in — NOT 100%", { width: 1500, height: 950, zoomSteps: 2 });

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
