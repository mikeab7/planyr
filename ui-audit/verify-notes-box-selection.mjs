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
  /* ⛔ AMENDED — the grip is a deliberate HOVER affordance since B1370544 ("the grip is a 12×20
   * affordance visible on hover… a box you have just typed into must still be movable without
   * pressing Escape first"), unconditional on selection (`.planyr-anchor:hover .planyr-anchor-grip`
   * carries no `[data-selected]` qualifier). So "hovering reveals nothing at all" was true only
   * before that feature shipped; the real, current, documented invariant is narrower: hovering an
   * UNSELECTED box reveals the grip alone, never the resize/delete handles (`.planyr-anchor-h` IS
   * gated on `[data-selected="1"]`). */
  const hoverShown = await visibleControls(page);
  ok(`${label} · ⛔ HOVERING AN UNSELECTED BOX REVEALS ONLY THE DRAG GRIP, NOTHING ELSE`,
    hoverShown.length === 1 && hoverShown[0] === "note-anchor-grip", JSON.stringify(hoverShown));
  ok(`${label} · …and hovering does not select it either`, !(await renderedBoxes(page))[0].selected);

  /* ═══ ATTACK 2 — A CLICK SELECTS, AND SELECTION IS VISIBLE (NEW-1) ════════════════════════ */
  await page.mouse.click(c0.x, c0.y);
  await pacedWait(page, 400);
  ok(`${label} · ⛔ CLICKING A BOX SELECTS IT`, (await renderedBoxes(page))[0].selected);
  /* ⛔ AMENDED (B539651): TWO controls, not three — the delete × is gone. *"the delete option
   * shouldn't just be shown, like, anytime I click on the box… I should only be able to use the
   * keystroke to delete or a right click and then delete option."* So this now asserts BOTH
   * halves: the non-destructive controls appear, and the destructive one does NOT. */
  const shown = await visibleControls(page);
  ok(`${label} · …and NOW the controls are there`, shown.length === 2, JSON.stringify(shown));
  ok(`${label} · ⛔ …and NOTHING destructive is among them`, !shown.some((c) => /delete/.test(c)), JSON.stringify(shown));

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
  /* ⛔ THE MOUSE MUST MOVE AWAY FIRST — the grip is a HOVER affordance since B1370544 ("the grip is
   * a 12×20 affordance visible on hover"), independent of selection by design (`.planyr-anchor:hover
   * .planyr-anchor-grip` in EditorStyles). The pointer is still resting on the box from the two
   * clicks above, so checking `visibleControls` without moving away first was asserting a stale
   * invariant (no controls at all once deselected) against a real, later, intentional feature (a
   * deselected-but-hovered box still shows its grip) — a false failure unrelated to this box's
   * selection state at all. */
  await page.mouse.move(5, 5);
  await pacedWait(page, 200);
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

  /* ═══ ATTACK 14 — A REAL POINTER CLICK ON THE ANCHOR'S OWN TEXT, MEASURED THE WAY THE OWNER'S
   * OWN LIVE-VERIFY DID (B1555152, a failed live-verify on planyr.io reported after B1555152's
   * first fix merged and deployed — reopened, then re-closed once this attack, and the two
   * production builds it was checked against, could not reproduce the reported failure).
   *
   * ⛔ THE OWNER'S OWN REPRO, driven exactly: click real flow text, verify the native selection is
   * really there (`getSelection().anchorNode`/`anchorOffset`, `document.activeElement`) — THEN a
   * single real pointer click on the box's own text, INSIDE `.planyr-anchor-content`'s rect
   * (never the box's outer bounding-rect centre, which can land on padding or an empty area below
   * short text) — THEN read `className`/`data-selected`/`activeElement` BEFORE the keypress, THEN
   * a real Backspace, THEN read the flow text back.
   *
   * ⛔ `page.mouse.click()` IS A REAL POINTER EVENT (CDP `Input.dispatchMouseEvent`), NEVER A
   * SCRIPTED `element.click()` DOM call — this file has used it throughout, but the owner
   * explicitly asked for it to be asserted rather than assumed, so this attack states it and
   * checks the intermediate state a scripted click could not fake: the native
   * `document.getSelection()`/`activeElement` readings a `.click()` call never produces at all. */
  await seed(page, ONE);
  const flowPara14 = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"));
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 10), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(flowPara14.x, flowPara14.y);
  await pacedWait(page, 300);
  const nativeAfterFlow = await page.evaluate(() => {
    const sel = document.getSelection();
    return { anchorNodeIsFlowText: !!(sel.anchorNode && sel.anchorNode.textContent?.includes("Flow text")), activeElement: document.activeElement?.getAttribute?.("data-testid") };
  });
  ok(`${label} · ⛔ (14) A REAL FLOW-TEXT CLICK PRODUCES A REAL NATIVE SELECTION FIRST`,
    nativeAfterFlow.anchorNodeIsFlowText && nativeAfterFlow.activeElement === "note-body", JSON.stringify(nativeAfterFlow));

  const anchorContentPos14 = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="note-anchor"] .planyr-anchor-content');
    const p = content.querySelector("p");
    const r = (p || content).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(anchorContentPos14.x, anchorContentPos14.y);
  await pacedWait(page, 350);
  const afterAnchorClick14 = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-anchor"]');
    return {
      className: el.className,
      dataSelected: el.getAttribute("data-selected"),
      activeElement: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName,
    };
  });
  ok(`${label} · ⛔ (14) A REAL POINTER CLICK ON THE ANCHOR'S OWN TEXT SELECTS IT — className carries "selected", editor is blurred`,
    /planyr-anchor/.test(afterAnchorClick14.className) && afterAnchorClick14.dataSelected === "1" && afterAnchorClick14.activeElement !== "note-body",
    JSON.stringify(afterAnchorClick14));

  const flowBefore14 = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text")).textContent);
  await page.keyboard.press("Backspace");
  await pacedWait(page, 1300);
  const flowAfter14 = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"))?.textContent);
  ok(`${label} · ⛔ (14) …AND BACKSPACE LEAVES THE FLOW TEXT UNTOUCHED — the owner's exact bar`,
    flowAfter14 === flowBefore14, JSON.stringify({ flowBefore14, flowAfter14 }));

  /* ═══ ATTACK 15 — A BOX BELOW note-body'S OWN BOTTOM EDGE, SCROLLED PROPERLY INTO VIEW
   * (interaction check against B1550976/B1550977's new sheet-bottom hit-test, which sits in the
   * same click-routing function this fix touches). `focusFromMat` gained a NEW branch after
   * B1555152 first shipped — a press below `note-body`'s own rendered bottom edge, still on the
   * white sheet, now ends the caret at the document's end instead of falling through to the grey
   * mat. If that branch's condition were ever accidentally reachable for a press that actually
   * landed ON an anchor box positioned low on the page, it would silently eat the click before
   * this fix's own selection logic ever saw it. A box this low overhangs `note-body`'s own flow
   * height (out-of-flow, absolutely positioned) and the page must be scrolled to actually bring it
   * on screen — a fixed viewport coordinate past the window's own height hits nothing at all and
   * would read as a false pass, so this scrolls for real before measuring (DRIVER-SCROLL-IS-NOT-
   * APP-SCROLL's own caution, the other direction: not the driver scrolling unasked, but the test
   * failing to scroll when a real user would have to). */
  await seed(page, [{ x: 60, y: 900, w: 180, t: "low box" }]);
  await page.evaluate(() => document.querySelector('[data-testid="note-anchor"]').scrollIntoView({ block: "center" }));
  await pacedWait(page, 350);
  const lowBoxPos = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="note-anchor"] .planyr-anchor-content');
    const p = content.querySelector("p");
    const r = (p || content).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const stackAtLowBox = await page.evaluate((pos) =>
    document.elementsFromPoint(pos.x, pos.y).some((el) => el.closest && el.closest(".planyr-anchor")), lowBoxPos);
  ok(`${label} · ⛔ (15) A BOX BELOW note-body's BOTTOM EDGE IS STILL ON TOP OF THE HIT-TEST STACK`,
    stackAtLowBox);
  await page.mouse.click(lowBoxPos.x, lowBoxPos.y);
  await pacedWait(page, 350);
  ok(`${label} · ⛔ (15) …AND A REAL CLICK THERE STILL SELECTS THE BOX, NOT THE SHEET-BOTTOM BRANCH`,
    (await renderedBoxes(page))[0].selected);

  /* ═══ ATTACK 11 — A STALE CARET LEFT IN FLOW TEXT MUST NOT EAT THE KEY (B1555152, owner report
   * 2026-09-11: *"I clicked after 'Civil Engineer: ', then clicked one of his margin boxes, then
   * pressed Backspace, and it backspaced the Civil Engineer line."*).
   *
   * ⛔ EVERY ATTACK ABOVE THAT PRESSES DELETE/BACKSPACE ON A SELECTED BOX SEEDS THE PAGE FRESH —
   * the box is the FIRST thing the mouse ever touches, so there is no earlier caret sitting in
   * flow text to leave stale. That is exactly the gap that let this ship: `focusFromMat`'s stage-1
   * select calls `e.preventDefault()`, which stops the BROWSER's click from moving the caret, but
   * did nothing about a caret already parked in ordinary text from an EARLIER click — and
   * `notesKeyScope.js` cannot tell a stale caret from a live one, so Backspace fell through to the
   * browser's native handling at the stale position instead of reaching the box's own Delete
   * handler. This attack clicks flow text FIRST, exactly like his report, before ever touching the
   * box. */
  await seed(page, ONE);
  const flowPara = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"));
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 10), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(flowPara.x, flowPara.y);
  await pacedWait(page, 300);
  const flowBefore = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text")).textContent);
  const c11 = await centreOf(page, 0);
  await page.mouse.click(c11.x, c11.y);           // stage 1: select the box, caret must NOT move
  await pacedWait(page, 350);
  ok(`${label} · ⛔ STAGE 1 AFTER A PRIOR FLOW-TEXT CLICK STILL SELECTS THE BOX`,
    (await renderedBoxes(page))[0].selected);
  const boxesBefore11 = await storedBoxes(page);
  await page.keyboard.press("Backspace");
  await pacedWait(page, 1300);
  const flowAfter = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"))?.textContent);
  const boxesAfter11 = await storedBoxes(page);
  ok(`${label} · ⛔ …AND BACKSPACE THERE NEVER TOUCHES THE STALE FLOW TEXT`,
    flowAfter === flowBefore, JSON.stringify({ flowBefore, flowAfter }));
  ok(`${label} · ⛔ …IT DELETES THE SELECTED BOX INSTEAD — exactly what B434416 asked for`,
    boxesAfter11.length === boxesBefore11.length - 1, `${boxesBefore11.length} → ${boxesAfter11.length}`);
  await page.keyboard.press("Control+z");
  await pacedWait(page, 1300);
  ok(`${label} · ⛔ …AND Ctrl+Z BRINGS THE BOX BACK`, (await storedBoxes(page)).length === boxesBefore11.length);

  /* ═══ ATTACK 12 — CLICKING AWAY RELEASES THE BOX, SO THE SAME GESTURE NEVER FLIP-FLOPS
   * (B1555152 part 2, owner's own words: *"even the ASDS click isn't really working that well…
   * sometimes it takes a double click, sometimes it takes a click, it's actually kinda odd"*).
   *
   * ⛔ MEASURED BEFORE THIS FIX: entering a box (stage 2), typing, then clicking an UNRELATED
   * paragraph elsewhere left `data-selected`/`data-editing` BOTH still "1" — the ring and the
   * text-cursor state never let go — so a LATER single click on that same box landed straight in
   * stage 2 (the app still believed it was already selected), while an untouched box still needed
   * two clicks. Same gesture, two different outcomes, from invisible leftover state — exactly his
   * complaint. */
  await seed(page, ONE);
  const c12 = await centreOf(page, 0);
  await page.mouse.click(c12.x, c12.y);            // stage 1
  await pacedWait(page, 300);
  await page.mouse.click(c12.x, c12.y);            // stage 2: enter and edit
  await pacedWait(page, 300);
  await page.keyboard.type(" hi", { delay: 20 });
  await pacedWait(page, 400);
  const flowPara12 = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"));
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 10), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(flowPara12.x, flowPara12.y);   // click AWAY into ordinary text
  await pacedWait(page, 350);
  ok(`${label} · ⛔ CLICKING AWAY RELEASES THE BOX — the ring and editing state both clear`,
    !(await renderedBoxes(page))[0].selected);
  await page.mouse.click(c12.x, c12.y);             // one click back on the (released) box
  await pacedWait(page, 350);
  const caretIn12 = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-anchor"]');
    const sel = document.getSelection();
    return !!(sel.anchorNode && el.contains(sel.anchorNode));
  });
  ok(`${label} · ⛔ …SO ONE CLICK BACK ON IT IS STAGE 1 AGAIN, NOT AN INSTANT SURPRISE ENTRY`,
    (await renderedBoxes(page))[0].selected && !(await caretIn12()));

  /* ═══ ATTACK 13 — SELECTED AND EDITING MUST LOOK DIFFERENT AT A GLANCE (B1555152 part 1) ══ */
  await seed(page, ONE);
  const c13 = await centreOf(page, 0);
  await page.mouse.click(c13.x, c13.y);
  await pacedWait(page, 300);
  const selectedWash = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('[data-testid="note-anchor"]')).backgroundColor.match(/[\d.]+\)$/)?.[0] || "0"));
  await page.mouse.click(c13.x, c13.y);
  await pacedWait(page, 300);
  const editingWash = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('[data-testid="note-anchor"]')).backgroundColor.match(/[\d.]+\)$/)?.[0] || "0"));
  ok(`${label} · ⛔ SELECTED (stage 1) AND EDITING (stage 2) PAINT DIFFERENTLY`,
    editingWash > selectedWash, `selected wash ${selectedWash} → editing wash ${editingWash}`);

  await ctx.close();
}

await run("A · a full window", { width: 1500, height: 950 });
await run("B · a SHORT window, which is his", { width: 1280, height: 620 });
await run("C · zoomed in — NOT 100%", { width: 1500, height: 950, zoomSteps: 2 });

/* ═══ ATTACK 16 — THE ACTIVEELEMENT NEVER LEAVES THE EDITOR (B1555152 ×3, owner correction
 * 2026-09-12). The owner retracted his earlier "the box never gets selected" claim — instrument
 * error on his side, reading `className` instead of `data-selected` — and sent PRECISE replacement
 * evidence from a real signed-in reproduction on planyr.io at his own window size (1191×465, a box
 * whose content rect straddles the right edge of that viewport):
 *
 *     anchor data-selected           "1"          ← selection DID happen
 *     document.activeElement         "note-body"  ← the blur did NOT happen
 *     getSelection().rangeCount      1, anchorNode still the flow paragraph  ← the live caret survived
 *
 * So `editor.commands.blur()` (the call the first fix added) is not reliable in his real
 * environment — `activeElement` can stay on the editor even after `data-selected` correctly flips
 * to "1". Attack 14 above proves the HAPPY path (a click on a box blurs the editor); this attack
 * proves the ROBUSTNESS path — Backspace must stay safe even when the blur does not stick, for
 * whatever reason (this sandbox cannot reproduce his real DPI/Chrome/sync-tick environment, so it
 * is driven directly: click the box for real, THEN force focus back onto the editor, matching the
 * exact state he measured, and check what a subsequent Backspace does).
 *
 * ⛔ THE FIX: `formFieldOwnsTheKey()` (`notesKeyScope.js`) replaces the box-selection binding's use
 * of `bindingShouldDecline`/`readCaretScope`'s `activeEditable` flag — which reads TRUE merely
 * because the contenteditable HAS focus, regardless of where the selection inside it actually is —
 * with a narrower check for a genuine form field only. Whether a selected box's Backspace binding
 * should decline no longer depends on `blur()` having taken effect at all: it depends on the
 * `paint` effect's own caret-position tracking (added in this bug's first round), which already
 * knows whether the caret has genuinely moved since the box was selected.
 *
 * ⛔ RED-PROVEN: this exact sequence was run against the code before this round's fix and the flow
 * text was mutated ("MAINLINE ALPHA BRAVO" → "MAINLIE ALPHA BRAVO", the letter coming out of the
 * stale selection) — confirming the scenario is real and this attack has teeth. */
{
  const label = "D · his reported viewport, box straddling the right edge";
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: { width: 1191, height: 465 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "verify-notes-box-selection");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  // A box near the right edge of a 1191-wide viewport straddles it, exactly as his did
  // (content rect x 1068–1204 on his machine; this sandbox's own placement lands similarly).
  await seed(page, [{ x: 1000, y: 120, w: 180, t: "SIDEBOX CHARLIE" }]);

  const flowPara16 = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"));
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 10), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(flowPara16.x, flowPara16.y);
  await pacedWait(page, 300);

  const c16 = await centreOf(page, 0);
  await page.mouse.click(c16.x, c16.y);
  await pacedWait(page, 350);
  const afterClick16 = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-anchor"]');
    return {
      dataSelected: el.getAttribute("data-selected"),
      activeElement: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName,
    };
  });
  ok(`${label} · ⛔ A REAL CLICK SELECTS THE BOX`, afterClick16.dataSelected === "1", JSON.stringify(afterClick16));

  // Force activeElement back onto the editor — the exact state the owner measured, whatever the
  // real-world cause (this sandbox cannot reproduce his DPI/Chrome/sync-tick environment directly).
  await page.evaluate(() => document.querySelector('[data-testid="note-body"]').focus());
  await pacedWait(page, 300);
  const forcedState16 = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-anchor"]');
    return {
      dataSelected: el.getAttribute("data-selected"),
      activeElement: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName,
    };
  });
  ok(`${label} · the box is still selected with activeElement forced back to the editor — his exact reported state`,
    forcedState16.dataSelected === "1" && forcedState16.activeElement === "note-body", JSON.stringify(forcedState16));

  const flowBefore16 = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text")).textContent);
  const boxesBefore16 = await storedBoxes(page);
  await page.keyboard.press("Backspace");
  await pacedWait(page, 1300);
  const flowAfter16 = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent.includes("Flow text"))?.textContent);
  const boxesAfter16 = await storedBoxes(page);
  ok(`${label} · ⛔ BACKSPACE STILL LEAVES THE FLOW TEXT UNTOUCHED EVEN WITH activeElement STUCK ON THE EDITOR`,
    flowAfter16 === flowBefore16, JSON.stringify({ flowBefore16, flowAfter16 }));
  ok(`${label} · ⛔ …AND IT DELETES THE SELECTED BOX INSTEAD`,
    boxesAfter16.length === boxesBefore16.length - 1, `${boxesBefore16.length} → ${boxesAfter16.length}`);

  await ctx.close();
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
