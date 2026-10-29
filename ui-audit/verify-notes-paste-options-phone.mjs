#!/usr/bin/env node
/* verify-notes-paste-options-phone — V1944320 / B2494096. THE OFFICE-STYLE PASTE OPTIONS IN EMULATED iPHONE WEBKIT, LIVE.
 *
 * The desktop harnesses (verify-notes-paste-options*.mjs) run on Chromium. The two things that cannot be assumed to carry over:
 * PICTURE (a table painted onto a canvas and exported — the step where Safari/WebKit taints or refuses) and the FLYOUT LAYOUT on a
 * phone (tap targets, staying on screen, rows that do not clip). This drives the real planyr.io, signed in as the test account, in
 * Playwright's WebKit with an iPhone descriptor (docs/PHONE-TESTING.md): everything is a TAP — there is no Ctrl key on a phone — and
 * the verdicts are read off the stored document and the rendered boxes.
 *
 * Say "emulated iPhone WebKit", never "Safari"/"iPhone" (docs/PHONE-TESTING.md): no real finger, no collapsing browser toolbar, no
 * real safe-area inset. A throwaway page is created and deleted per device (constraint 15).
 *
 * `BASE_URL` (default https://planyr.io) · `DEVICES="iPhone 15,iPhone SE,iPhone 15 landscape"` · `SHOTS=<dir>`. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { loadFixture } from "./lib/clipboardTableFixtures.mjs";
import { mkdirSync } from "node:fs";
import { decodePng } from "./lib/pngDiff.mjs";
import { devices } from "@playwright/test";

const BASE = process.env.BASE_URL || "https://planyr.io";
const DEVICES = (process.env.DEVICES || "iPhone 15,iPhone SE,iPhone 15 landscape").split(",").map((d) => d.trim());
const SHOT = process.env.SHOTS || "";
if (SHOT) mkdirSync(SHOT, { recursive: true });
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
/* An INFORMATIONAL line: reported, never counted. Used for the one thing this engine answers differently run to run (see PAINT below). */
const note = (l) => console.log(`  ℹ ${l}`);
const excel = loadFixture("excel");

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const BOX_DOC = { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 20, y: 150, w: 300, h: null, aid: "b1" }, content: [para("Intro line")] }, para("")] };
const walk = (n, f) => { if (!n) return; f(n); (n.content || []).forEach((c) => walk(c, f)); };
const firstOf = (doc, t) => { let h = null; walk(doc, (n) => { if (!h && n.type === t) h = n; }); return h; };
const countType = (doc, t) => { let c = 0; walk(doc, (n) => { if (n.type === t) c += 1; }); return c; };
const cellWords = (c) => { const o = []; walk(c, (n) => { if (n.type === "paragraph") { const r = []; walk(n, (m) => { if (m.text) r.push(m.text); else if (m.type === "hardBreak") r.push(" "); }); o.push(r.join("").trim()); } }); return o.filter(Boolean).join(" "); };
const gridOf = (t) => (t?.content || []).map((r) => (r.content || []).map(cellWords));
const marksIn = (n) => { const m = new Set(); walk(n, (x) => (x.marks || []).forEach((k) => m.add(k.type))); return [...m]; };
const tableJson = (d) => JSON.stringify(firstOf(d, "table"));

const WORD_HTML = '<html><body><!--StartFragment--><p style="font-family:Calibri;font-size:11pt">Lead <b>bold word</b> and <i>italic</i> then <span style="color:#C00000;font-family:Georgia;font-size:20pt">big red serif</span> and a <a href="https://example.com/x">link</a>.</p><!--EndFragment--></body></html>';
const WORD_TEXT = "Lead bold word and italic then big red serif and a link.";


/* Back to the page list (a phone shows the list OR an open page) and delete every throwaway page this harness made — now, and any a
 * crashed earlier run left (constraint 15: always cleared, verified gone). */
async function sweepThrowaways(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  if (!(await page.locator('[data-testid="notes-new-page"]').first().isVisible().catch(() => false))) {
    await page.locator('[data-testid="notes-mobile-back"]').first().tap().catch(() => {});
    await wait(900);
  }
  await page.waitForSelector('[data-testid="notes-new-page"]', { state: "visible", timeout: 20000 }).catch(() => {});
  for (let guard = 0; guard < 12; guard++) {
    const row = page.locator('[data-testid^="notes-row-"]:not([data-testid^="notes-row-more"]):not([data-testid="notes-row-menu"])', { hasText: /ZZ throwaway (phone )?paste/ }).first();
    if (!(await row.count())) break;
    const id = (await row.getAttribute("data-testid")).replace("notes-row-", "");
    const more = page.locator(`[data-testid="notes-row-more-${id}"]`);
    /* Centre the row: the app's own "?" help button sits bottom-right and would take the tap on a row scrolled to the very bottom. */
    await more.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await wait(300);
    await more.evaluate((el) => el.click());
    await wait(400);
    await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().evaluate((el) => el.click());
    await wait(500);
    await page.locator(`[data-testid="notes-del-${id}-yes"]`).evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await page.locator(`[data-testid="notes-del-${id}-yes"]`).evaluate((el) => el.click());
    await wait(1200);
  }
  return page.locator('[data-testid^="notes-row-"]', { hasText: /ZZ throwaway (phone )?paste/ }).count();
}

/* ⛔ THE iPhone SE DESCRIPTOR CLAIMS iOS 10.3 (AppleWebKit/603). ProseMirror treats an iOS WebKit older than 604 as having a BROKEN clipboard
 * API and ignores `text/html` entirely, so on that descriptor an Excel paste arrives as plain tab-separated text — no column widths, no
 * fills — and the width/values-format options are correctly absent. No current iPhone reports that version, so the SE descriptor keeps its
 * SCREEN (320 wide) and takes iPhone 15's current-iOS user-agent. Measured 2026-10-29: with the stock SE UA, 7 options and no fills. */
async function openDevice(name) {
  const landscape = / landscape$/.test(name);
  const base = name.replace(/ landscape$/, "");
  const descriptor = landscape ? `${base} landscape` : base;
  for (let i = 0; i < 12; i++) {
    try { return await openSignedIn({ base: BASE, engine: "webkit", device: descriptor, contextOptions: base === "iPhone SE" ? { userAgent: devices["iPhone 15"].userAgent } : {}, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("  sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
  }
  return null;
}

async function runDevice(name) {
  console.log(`\n=== ${name} (emulated iPhone WebKit) ===`);
  const s = await openDevice(name);
  const { page } = s;
  const wait = (ms) => page.waitForTimeout(ms);
  const TITLE = "ZZ throwaway phone paste " + Date.now().toString(36);
  let before = -1;
  try {
    await assertMeasurable(page, "verify-notes-paste-options-phone");
    const engine = await page.evaluate(() => ({ ua: navigator.userAgent, coarse: matchMedia("(pointer: coarse)").matches, touch: navigator.maxTouchPoints, w: innerWidth, h: innerHeight }));
    console.log("  ", JSON.stringify(engine));
    ok("(known-good) the context really is a touch phone in WebKit", /AppleWebKit/.test(engine.ua) && !/Chrome\//.test(engine.ua) && engine.coarse, JSON.stringify(engine));
    const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
    console.log("   signed in as", s.proof.email, "· served build", build.build);

    /* The sign-in reloads the app once on its own; a hash-only route change cannot collide with that. */
    await wait(3500);
    await page.evaluate(() => { location.hash = "#/notes"; });
    await page.waitForSelector('[data-testid^="notes-"]', { timeout: 60000 });
    await wait(2500);
    /* On a phone the page list and an open page are ONE screen at a time: if a page is open, the "‹ Notes" control is the way back. */
    for (let i = 0; i < 8; i++) {
      if (await page.locator('[data-testid="notes-new-page"]').first().isVisible().catch(() => false)) break;
      await page.locator('[data-testid="notes-mobile-back"]').first().tap({ timeout: 4000 }).catch(() => {});
      await wait(1500);
    }
    await page.waitForSelector('[data-testid="notes-new-page"]', { state: "visible", timeout: 30000 });
    for (let i = 0; i < 20; i++) {
      const n = await page.locator('[data-testid^="notes-row-"]').count();
      if (n === before && n > 0) break;
      before = n; await wait(600);
    }
    await page.locator('[data-testid="notes-new-page"]').first().tap();
    await page.waitForSelector('[data-testid="note-title"]', { timeout: 25000 });
    await page.locator('[data-testid="note-title"]').fill(TITLE);
    await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
    await wait(900);
    await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });

    const json = () => page.evaluate(() => window.__noteEditor.json());
    const paste = async (html, text) => {
      await page.evaluate(([h, t]) => {
        const dt = new DataTransfer();
        if (h) dt.setData("text/html", h);
        if (t != null) dt.setData("text/plain", t);
        (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, [html, text]);
      await wait(1500);
    };
    /* A real tap on the box's text — twice (press 1 selects the box, press 2 enters it), the way a finger does. */
    const tapAtEnd = async (needle) => {
      const p = await page.evaluate((n) => {
        const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
        let node;
        while ((node = w.nextNode())) {
          const i = node.nodeValue.indexOf(n);
          if (i < 0) continue;
          const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true);
          const b = r.getBoundingClientRect();
          return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
        }
        return null;
      }, needle);
      if (!p) throw new Error(`could not find "${needle}"`);
      const under = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const mat = document.querySelector('[data-testid="note-mat"]')?.getBoundingClientRect(); return { inEditor: !!e?.closest(".ProseMirror"), tag: e?.tagName, tid: e?.closest("[data-testid]")?.getAttribute("data-testid"), mat: mat ? { t: Math.round(mat.top), b: Math.round(mat.bottom) } : null, vh: innerHeight }; }, [p.x, p.y]);
      if (!under.inEditor) throw new Error(`VOID: the tap point (${p.x},${p.y}) is not over the editor — ${JSON.stringify(under)}`);
      await page.touchscreen.tap(p.x, p.y);
      await wait(300);
    };
    const freshBox = async () => {
      await page.evaluate((d) => window.__noteEditor.setDoc(d), BOX_DOC);
      await wait(700);
      /* Put the box where a finger can reach it: the page is scaled to fit the screen, so a workspace offset is not a screen offset.
       * Measure the box and the visible mat, then shift the box (in workspace units) to sit a little below the mat's top edge. */
      const adj = await page.evaluate(() => {
        const a = document.querySelector(".planyr-anchor")?.getBoundingClientRect(); const m = document.querySelector('[data-testid="note-mat"]')?.getBoundingClientRect();
        return a && m ? { top: a.top, scale: a.width / 300, mTop: m.top, mBottom: m.bottom } : null;
      });
      if (adj && (adj.top < adj.mTop + 12 || adj.top > adj.mBottom - 80)) {
        const dy = (adj.mTop + 40 - adj.top) / (adj.scale || 1);
        const moved = JSON.parse(JSON.stringify(BOX_DOC)); moved.content[0].attrs.y = Math.max(0, Math.round(BOX_DOC.content[0].attrs.y + dy));
        await page.evaluate((d) => window.__noteEditor.setDoc(d), moved);
        await wait(700);
      }
      await tapAtEnd("Intro line"); await wait(650); await tapAtEnd("Intro line");
    };
    const onScreen = (r, vp) => r.left >= -0.5 && r.top >= -0.5 && r.right <= vp.w + 0.5 && r.bottom <= vp.h + 0.5;
    const flyoutFacts = () => page.evaluate(() => {
      const vv = window.visualViewport; const vp = { w: Math.round(vv ? vv.width : innerWidth), h: Math.round(vv ? vv.height : innerHeight) };
      const f = document.querySelector('[data-testid="note-paste-options"]');
      const rect = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const buttons = [...document.querySelectorAll('[data-testid="note-paste-options"] button.planyr-paste-btn')].map((b) => ({ id: b.getAttribute("data-testid").replace("note-paste-", ""), tip: b.getAttribute("data-tip"), pressed: b.getAttribute("aria-pressed"), ...rect(b) }));
      const rows = [...document.querySelectorAll('[data-testid="note-paste-options"] .planyr-paste-row')].map((r) => ({ ...rect(r), sw: r.scrollWidth, cw: r.clientWidth }));
      const groups = [...document.querySelectorAll('[data-testid="note-paste-options"] [data-paste-group]')].map((g) => g.getAttribute("data-paste-group"));
      return { vp, box: f ? rect(f) : null, buttons, rows, groups, hit: buttons.map((b) => { const el = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!el && !!el.closest(`[data-testid="note-paste-${b.id}"]`); }) };
    });
    const tapTab = async () => { await page.locator('[data-testid="note-paste-badge"]').tap(); await wait(450); };
    const pick = async (id) => { if (await page.locator('[data-testid="note-paste-badge"]').count()) await tapTab(); await page.locator(`[data-testid="note-paste-${id}"]`).tap(); await wait(1100); return json(); };
    const undo = async () => { await page.locator('[data-testid="nt-undo"]').first().tap().catch(() => {}); await wait(900); };

    /* ---- [1] table paste: tab + flyout layout ---- */
    console.log("  [1] Excel range → the tab, the flyout layout");
    await freshBox();
    await paste(excel.html, excel.text);
    const landed = await json();
    const lt = firstOf(landed, "table");
    ok("(known-good) the Excel range landed as a 4×3 table", !!lt && gridOf(lt).length === 4 && gridOf(lt)[0].length === 3, JSON.stringify(gridOf(lt)));
    if (!lt) throw new Error("VOID: the table did not land");
    const tabBox = await page.locator('[data-testid="note-paste-badge"]').boundingBox();
    ok("the (Ctrl) ▾ tab is on screen and tappable", !!tabBox && tabBox.width > 0 && tabBox.height > 0 && onScreen({ left: tabBox.x, top: tabBox.y, right: tabBox.x + tabBox.width, bottom: tabBox.y + tabBox.height }, { w: engine.w, h: engine.h }), JSON.stringify(tabBox));
    const tabSize = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-paste-badge"]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    ok("the collapsed tab is a finger-sized target (at least 44 tall)", tabSize.h >= 43.5, JSON.stringify(tabSize));
    await tapTab();
    const ff = await flyoutFacts();
    ok("tapping the tab opens the flyout (eight options)", ff.buttons.length === 8, JSON.stringify(ff.buttons.map((b) => b.id)));
    ok("grouped Paste · Paste Values · Other Paste Options", JSON.stringify(ff.groups) === JSON.stringify(["Paste", "Paste Values", "Other Paste Options"]), JSON.stringify(ff.groups));
    ok("the whole flyout is inside the visible screen", !!ff.box && onScreen(ff.box, ff.vp), JSON.stringify({ box: ff.box, vp: ff.vp }));
    ok("every option is inside the screen", ff.buttons.every((b) => onScreen(b, ff.vp)), JSON.stringify(ff.buttons.filter((b) => !onScreen(b, ff.vp)).map((b) => b.id)));
    ok("every option is a finger-sized target (at least 44 both ways)", ff.buttons.every((b) => b.width >= 43.5 && b.height >= 43.5), JSON.stringify(ff.buttons.map((b) => [b.id, Math.round(b.width), Math.round(b.height)])));
    ok("no row clips its buttons", ff.rows.every((r) => r.sw <= r.cw + 1), JSON.stringify(ff.rows.map((r) => [r.sw, r.cw])));
    ok("every option is the topmost thing at its own centre (nothing lies over it)", ff.hit.every(Boolean), JSON.stringify(ff.hit));
    ok("no two options overlap each other", ff.buttons.every((a, i) => ff.buttons.every((b, j) => i >= j || a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5)));
    ok("Keep Source Formatting shows the pressed state", ff.buttons[0].pressed === "true");
    if (SHOT) await page.screenshot({ path: `${SHOT}/${name.replace(/\s+/g, "-")}-flyout.png` });
    /* the page itself must not have grown sideways because of the flyout */
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok("the flyout does not make the page scroll sideways", overflow.sw <= overflow.cw + 1, JSON.stringify(overflow));

    /* ---- [2] every option by TAP, undo by the toolbar ---- */
    console.log("  [2] every option by tap, then undo");
    const cases = [
      ["transpose", "Transpose", (d) => JSON.stringify(gridOf(firstOf(d, "table"))[0]) === JSON.stringify(["Unit", "A-100", "A-200", "B-300"])],
      ["values", "Values", (d) => marksIn(firstOf(d, "table")).length === 0 && JSON.stringify(gridOf(firstOf(d, "table"))) === JSON.stringify(gridOf(lt))],
      ["valuesFormat", "Values and Source Formatting", (d) => firstOf(d, "table").content[0].content.every((c) => c.attrs.background === "#dbe5f1") && !marksIn(firstOf(d, "table")).includes("link")],
      ["widths", "Keep Source Column Widths", (d) => JSON.stringify(firstOf(d, "table").content[0].content.map((c) => c.attrs.colwidth)) === JSON.stringify([[100], [100], [240]])],
      ["formatting", "Formatting only", (d) => gridOf(firstOf(d, "table")).flat().every((c) => c === "") && firstOf(d, "table").content[0].content.every((c) => c.attrs.background === "#dbe5f1")],
      ["picture", "Picture", (d) => countType(d, "table") === 0 && countType(d, "noteImage") === 1],
    ];
    for (const [id, label, check] of cases) {
      if (id !== "transpose") { await freshBox(); await paste(excel.html, excel.text); }
      const d = await pick(id);
      ok(`${label}: applied by a tap`, check(d), JSON.stringify(gridOf(firstOf(d, "table"))).slice(0, 140) + " images=" + countType(d, "noteImage"));
      if (id === "picture") {
        const info = await page.evaluate(async () => {
          const i = document.querySelector(".ProseMirror figure.planyr-note-image img");
          if (!i) return null;
          if (!i.complete) await new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 6000); });
          const r = i.getBoundingClientRect();
          return { w: i.naturalWidth, h: i.naturalHeight, shownW: Math.round(r.width), shownH: Math.round(r.height), src: (i.currentSrc || i.src || "").slice(0, 30) };
        });
        ok("Picture: a real image was drawn and decoded in WebKit (the canvas export worked)", !!info && info.w > 200 && info.h > 60, JSON.stringify(info));
        ok("Picture: it is visible on the page, not zero-sized", !!info && info.shownW > 30 && info.shownH > 20, JSON.stringify(info));
        const fx = await page.evaluate(async () => {
          const i = document.querySelector(".ProseMirror figure.planyr-note-image img");
          if (!i) return null;
          const c = document.createElement("canvas"); c.width = Math.min(i.naturalWidth, 400); c.height = Math.min(i.naturalHeight, 200);
          const g = c.getContext("2d"); g.drawImage(i, 0, 0, c.width, c.height);
          const px = g.getImageData(0, 0, c.width, c.height).data; let dark = 0, white = 0;
          for (let k = 0; k < px.length; k += 4) { const l = px[k] + px[k + 1] + px[k + 2]; if (l < 300) dark += 1; else if (l > 740) white += 1; }
          return { dark, white, total: px.length / 4 };
        });
        ok("Picture: it holds ink (text and rules) on a white page — not a blank or black square", !!fx && fx.dark > 40 && fx.white > fx.total * 0.3, JSON.stringify(fx));
        /* ⛔ PAINT — reported, NOT gated (B2515969). The checks above prove the picture is a real, decoded, ink-bearing image; they cannot
         * prove WebKit PUT IT ON SCREEN. In this emulated WebKit a picture of any real weight (this one, and a plain 40-KB PNG inserted the
         * ordinary way, measured alike) is sometimes left unpainted — an alt-text pill where the table should be — until the next repaint
         * (a blur, a tap on blank paper). Chromium painted 6 of 6, this engine about 2 of 8; no style nudge, decode-ahead or decoding=sync
         * moved it. It is not Picture-specific, so it does not fail this run; it is counted here so the number is on the record, and the
         * only judge of whether a real iPhone does it is a real iPhone (V1960400). The painted test is the table header's own shading. */
        const painted = await (async () => {
          const rect = await page.evaluate(() => { const i = document.querySelector(".ProseMirror figure.planyr-note-image img"); if (!i) return null; const b = i.getBoundingClientRect(); return { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.min(b.width, innerWidth - Math.max(0, b.left)), height: Math.min(b.height, innerHeight - Math.max(0, b.top)) }; });
          if (!rect || rect.width < 10 || rect.height < 10) return null;
          const im = decodePng(await page.screenshot({ clip: rect })); const q = im.data || im.pixels; const st = im.channels || 4; let f = 0;
          for (let k = 0; k < q.length; k += st) if (Math.abs(q[k] - 219) < 5 && Math.abs(q[k + 1] - 229) < 5 && Math.abs(q[k + 2] - 241) < 5) f += 1;
          return f > 3000;
        })();
        note(`PAINT: the picture is ${painted === null ? "not measurable on screen (cut off)" : painted ? "painted on screen" : "NOT painted yet (alt-text pill) — see B2515969"}`);
        if (SHOT) await page.screenshot({ path: `${SHOT}/${name.replace(/\s+/g, "-")}-picture.png` });
        const tabAfter = await page.locator('[data-testid="note-paste-badge"]').boundingBox().catch(() => null);
        ok("after Picture the tab sits beside the picture, inside the screen", !!tabAfter && onScreen({ left: tabAfter.x, top: tabAfter.y, right: tabAfter.x + tabAfter.width, bottom: tabAfter.y + tabAfter.height }, { w: engine.w, h: engine.h }), JSON.stringify(tabAfter));
      }
      await undo();
      const back = await json();
      ok(`${label}: one tap on Undo returns the table as pasted`, tableJson(back) === tableJson(landed) && countType(back, "noteImage") === 0, JSON.stringify(gridOf(firstOf(back, "table"))).slice(0, 100));
    }

    /* ---- [3] Word text, by tap ---- */
    console.log("  [3] Word-style text: K / M / T by tap");
    await freshBox(); await paste(WORD_HTML, WORD_TEXT);
    const wl = await json();
    ok("Word text arrives with its marks", marksIn(wl).includes("bold") && marksIn(wl).includes("link") && marksIn(wl).includes("textStyle"), JSON.stringify(marksIn(wl)));
    await tapTab();
    const tf = await flyoutFacts();
    ok("the text set: Keep Source Formatting · Merge Formatting · Keep Text Only", JSON.stringify(tf.buttons.map((b) => b.tip)) === JSON.stringify(["Keep Source Formatting (K)", "Merge Formatting (M)", "Keep Text Only (T)"]), JSON.stringify(tf.buttons.map((b) => b.tip)));
    ok("the text flyout is inside the screen with finger-sized targets", !!tf.box && onScreen(tf.box, tf.vp) && tf.buttons.every((b) => b.width >= 43.5 && b.height >= 43.5), JSON.stringify({ box: tf.box, vp: tf.vp }));
    await page.locator('[data-testid="note-paste-merge"]').tap(); await wait(900);
    const wm = await json();
    ok("Merge Formatting: font/size/colour gone, bold/italic/link kept", !marksIn(wm).includes("textStyle") && ["bold", "italic", "link"].every((m) => marksIn(wm).includes(m)), JSON.stringify(marksIn(wm)));
    await tapTab(); await page.locator('[data-testid="note-paste-source"]').tap(); await wait(900);
    ok("Keep Source Formatting: back exactly as pasted", JSON.stringify(await json()) === JSON.stringify(wl));
    await tapTab(); await page.locator('[data-testid="note-paste-text"]').tap(); await wait(900);
    const wt = await json();
    ok("Keep Text Only: plain words, no marks", marksIn(wt).length === 0 && /Lead bold word/.test(JSON.stringify(wt)), JSON.stringify(marksIn(wt)));

    /* ---- [4] dark theme ---- */
    console.log("  [4] dark theme");
    await freshBox(); await paste(excel.html, excel.text);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await tapTab();
    const dark = await page.evaluate(() => { const f = document.querySelector('[data-testid="note-paste-options"]'); const b = f.querySelector('button[aria-pressed="false"]'); return { halo: getComputedStyle(b).getPropertyValue("--paste-halo").trim(), blue: getComputedStyle(b.querySelector("svg")).getPropertyValue("--paste-blue").trim() }; });
    ok("dark theme: the halo follows the surface and the ink uses its dark twin", !!dark.halo && !/^#?f{3,6}$/i.test(dark.halo) && dark.blue === "#6FB4F0", JSON.stringify(dark));
    if (SHOT) await page.screenshot({ path: `${SHOT}/${name.replace(/\s+/g, "-")}-dark.png` });
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  } catch (e) {
    const state = await page.evaluate(() => ({ badge: !!document.querySelector('[data-testid="note-paste-badge"]'), flyout: !!document.querySelector('[data-testid="note-paste-options"] .planyr-paste-btn'), tables: document.querySelectorAll('.ProseMirror table').length, imgs: document.querySelectorAll('.ProseMirror figure.planyr-note-image').length, sel: String(getSelection()).slice(0, 30) })).catch(() => null);
    console.log('  DIAG at failure:', JSON.stringify(state));
    if (SHOT) await page.screenshot({ path: `${SHOT}/${name.replace(/\s+/g, '-')}-failure.png` }).catch(() => {});
    throw e;
  } finally {
    let left = -1;
    try {
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => document.documentElement.removeAttribute("data-theme")).catch(() => {});
      left = await sweepThrowaways(page);
    } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 1500)); }
    ok("the throwaway page is gone from the list", left === 0, `left=${left}`);
    const appErrors = s.errors.filter((e) => !/access control checks|Load failed|Fetch API cannot load|ResizeObserver loop/.test(e)); // WebKit reports a county GIS host that sends no CORS header as a page error; it is the sandbox's blocked GIS, not the notes code
    ok("no page error from the app (blocked GIS hosts aside)", appErrors.length === 0, appErrors.slice(0, 3).join(" | "));
    await s.close();
  }
}

for (const d of DEVICES) {
  try { await runDevice(d); }
  catch (e) { fail++; console.log(`  ✗ ${d}: run did not complete — ${String(e).slice(0, 400)}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
