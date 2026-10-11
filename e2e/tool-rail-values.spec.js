/* NEW-1 (right tool rail) — each tool's CURRENT size is visible without opening its menu, Measure
 * lives under Tools, headings carry their own rule and sit closer to their own tools, and the rail's
 * margins are equal on both sides. Drives the real planner logged out (seeded local site, no cloud).
 *
 * The three assertions the brief names as the acceptance test:
 *   · no rail label or value overflows its box (light AND dark, armed AND at rest, at the widest real
 *     value — a 10′×20′ stall and a 12′×53′ trailer stall — which is the narrowest real fit),
 *   · every ▾ shares ONE x position,
 *   · each heading's gap above is larger than its gap below (and matches lib/toolRailModel.js's RAIL,
 *     so the page cannot drift from the stated rule).
 * Mutation-checked: dropping `.rail-hdr`'s top margin, or the caret's fixed box, takes the matching test red.
 */
import { test, expect } from "@playwright/test";
import { startBlank } from "./drawKinds.js";
import { RAIL, headingInkGaps } from "../src/workspaces/site-planner/lib/toolRailModel.js";

async function open(page, viewport = { width: 1440, height: 900 }, theme = "light") {
  // The theme is the app's own persisted choice (read at load), so the JS palette AND the CSS tokens flip together.
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch { /* ignore */ } }, theme);
  await startBlank(page);
  await page.setViewportSize(viewport);
  await expect(page.locator('[data-rail-heading]').first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}
/** The widest value a car stall can really show (a 10′×20′ stall). The plan's own stall is 9′×18′, so the
 *  pill's text is swapped IN PLACE for the widest real string and the layout re-measured — the box,
 *  the font and the pill are the real ones; only the digits differ. */
const widenCarStall = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll(".rail-split")].find((e) => e.querySelector(".rail-split-main").textContent.includes("Parking")).querySelector(".rail-pill-val");
  v.textContent = "10′×20′";
});
const rail = (page) => page.locator(".rail-scroll");

/** Every geometry fact the three acceptance assertions read, in one in-page call. */
const measure = (page) => page.evaluate(() => {
  const r = document.querySelector(".rail-scroll");
  const rr = r.getBoundingClientRect();
  const rows = [...r.querySelectorAll(":scope > button, :scope > div > .rail-split, :scope > div > div > .rail-split, .rail-split")];
  const splits = [...r.querySelectorAll(".rail-split")].map((el) => {
    const main = el.querySelector(".rail-split-main"), pill = el.querySelector(".rail-split-pill"), caret = el.querySelector(".rail-caret"), val = el.querySelector(".rail-pill-val");
    const m = main.getBoundingClientRect(), p = pill.getBoundingClientRect(), c = caret.getBoundingClientRect();
    // The label's content (icon + text) must end inside the main button; the value must sit left of the caret inside the pill.
    const range = document.createRange(); range.selectNodeContents(main);
    const content = range.getBoundingClientRect();
    return {
      name: main.textContent.trim(), valueText: val ? val.textContent : null,
      mainOverflow: main.scrollWidth - main.clientWidth, pillOverflow: pill.scrollWidth - pill.clientWidth,
      contentRight: content.right, mainRight: m.right - 1, pillLeft: p.left,
      valRight: val ? val.getBoundingClientRect().right : null, caretLeft: c.left, caretRight: c.right,
      rowTop: m.top, rowH: Math.round(m.height * 10) / 10, gapBetween: Math.round((p.left - m.right) * 10) / 10,
    };
  });
  const plain = [...r.querySelectorAll(":scope > button")].map((b) => ({ name: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height * 10) / 10, left: b.getBoundingClientRect().left, right: b.getBoundingClientRect().right }));
  const heads = [...r.querySelectorAll("[data-rail-heading]")].map((h) => {
    const hb = h.getBoundingClientRect(), prev = h.previousElementSibling, next = h.nextElementSibling;
    const tr = document.createRange(); tr.selectNodeContents(h);
    const text = [...h.childNodes].find((n) => n.nodeType === 3); const tr2 = document.createRange(); tr2.selectNodeContents(text);
    const nextIcon = next && next.querySelector("svg.rbtn-icon");
    return {
      text: h.textContent, top: hb.top, bottom: hb.bottom, height: hb.height,
      above: prev ? hb.top - prev.getBoundingClientRect().bottom : null, below: next ? next.getBoundingClientRect().top - hb.bottom : null,
      textLeft: tr2.getBoundingClientRect().left, iconLeft: nextIcon ? nextIcon.getBoundingClientRect().left : null,
      ruleRight: hb.right, color: getComputedStyle(h).color, afterBg: getComputedStyle(h, "::after").backgroundColor,
    };
  });
  const scrollbarW = r.offsetWidth - r.clientWidth - r.clientLeft;
  const icons = [...r.querySelectorAll("svg.rbtn-icon")].map((i) => i.getBoundingClientRect().left);
  return { railOuterLeft: rr.left, scrollbarW, iconLefts: icons, sbStyle: { width: getComputedStyle(r).scrollbarWidth, color: getComputedStyle(r).scrollbarColor }, railLeft: rr.left + 1 /* the rail's own 1px border */, railRight: rr.right - scrollbarW, railW: rr.width, scrollable: r.scrollHeight > r.clientHeight, splits, plain, heads, rows: rows.length };
});

for (const theme of ["light", "dark"]) {
  test.describe(`right tool rail — layout (${theme})`, () => {
    for (const [label, viewport] of [["tall window", { width: 1440, height: 900 }], ["short window — the rail scrolls", { width: 1440, height: 520 }]]) {
      test(`${label}: nothing overflows, every ▾ shares one x, margins equal, headings attach to their tools`, async ({ page }) => {
        // The widest REAL values: a 10′×20′ car stall here, and a 12′×53′ trailer stall in the next test.
        await open(page, viewport, theme);
        await widenCarStall(page);
        for (const armed of [false, true]) {
          if (armed) await page.getByRole("button", { name: /^Road$/ }).click();
          const m = await measure(page);
          if (label.startsWith("short")) expect(m.scrollable, "a short window must make the rail scroll — that is the owner's case").toBe(true);
          expect(m.railW).toBe(168);

          // 1 — no label or value overflows its box, and the value never touches the tool name
          expect(m.splits.map((x) => x.name.replace(/\s+/g, " ").replace(/ [A-Z⇧]$/, ""))).toEqual(["Parcel tools", "Measure", "Building", "Road", "Parking", "Easement"]);
          for (const s of m.splits) {
            expect(s.mainOverflow, `${s.name}: label overflows its button`).toBeLessThanOrEqual(0);
            expect(s.pillOverflow, `${s.name}: value/caret overflows its pill`).toBeLessThanOrEqual(0);
            expect(s.contentRight, `${s.name}: label runs into its pill`).toBeLessThanOrEqual(s.mainRight + 0.5);
            if (s.valRight != null) expect(s.valRight, `${s.name}: value collides with ▾`).toBeLessThanOrEqual(s.caretLeft + 0.5);
          }
          expect(m.splits.find((s) => /Parking/.test(s.name)).valueText).toBe("10′×20′");

          // 2 — every ▾ in one column, one size
          const rights = m.splits.map((s) => s.caretRight);
          expect(Math.max(...rights) - Math.min(...rights), "carets must share one x").toBeLessThanOrEqual(0.5);
          const lefts = m.splits.map((s) => s.caretLeft);
          expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(0.5);

          // 3 — same row height everywhere, and no gap between label and pill (one shape when armed, one row at rest)
          const hs = [...m.splits.map((s) => s.rowH), ...m.plain.map((p) => p.h)];
          expect(Math.max(...hs) - Math.min(...hs), "every rail row is the same height").toBeLessThanOrEqual(1);
          expect(hs[0]).toBeGreaterThanOrEqual(26); expect(hs[0]).toBeLessThanOrEqual(30);
          for (const s of m.splits) expect(s.gapBetween).toBeLessThanOrEqual(0.5);

          // 4 — the brief's margins: pills start ~6px from the rail's outer edge (was 12), icons ~13px (was ~22),
          //     rows end a small even gap (6px) before the scrollbar strip, and every row ends at the same x
          const row = m.plain[0];
          expect(row.left - m.railOuterLeft, "pill starts nearer the left edge than the old 12px").toBeLessThanOrEqual(7);
          expect(Math.min(...m.iconLefts) - m.railOuterLeft, "icons sit nearer the left edge than the old ~22px").toBeLessThanOrEqual(15);
          expect(m.railRight - row.right, "even gap before the scrollbar strip").toBeCloseTo(RAIL.padR, 0);
          for (const p of m.plain) expect(Math.abs(p.right - row.right), `${p.name}: rows end on one x`).toBeLessThanOrEqual(0.5);
          // 4b — a visible thin scrollbar exactly when the rail overflows (token-coloured, always on)
          if (m.scrollable) {
            expect(m.scrollbarW, "overflowing rail shows a scrollbar strip").toBeGreaterThan(3);
            expect(m.scrollbarW).toBeLessThanOrEqual(12);
          }
          expect(m.sbStyle.width).toBe("thin");
          expect(m.sbStyle.color).not.toMatch(/^auto$/);

          // 5 — headings: Tools · Site elements · Markup; the rule runs to the right edge; above > below
          expect(m.heads.map((h) => h.text.toLowerCase())).toEqual(["tools", "site elements", "markup"]);
          const model = headingInkGaps();
          m.heads.forEach((h, i) => {
            expect(h.ruleRight).toBeCloseTo(m.railRight - RAIL.padR, 0);
            expect(Math.abs(h.textLeft - h.iconLeft), `${h.text}: heading text lines up with the icon column`).toBeLessThanOrEqual(1);
            expect(h.below).toBeCloseTo(RAIL.flexGap + RAIL.hdrMarginBottom, 0);
            if (i === 0) { expect(h.above).toBeNull(); return; }
            expect(h.above, `${h.text}: gap above must exceed gap below`).toBeGreaterThan(h.below);
            expect(h.above).toBeCloseTo(RAIL.flexGap + RAIL.hdrMarginTop, 0);
            expect(model.above / model.below).toBeGreaterThan(1.8);
          });
          expect(m.heads[0].top - m.railLeft).toBeDefined();
        }
        await page.screenshot({ path: test.info().outputPath(`rail-${theme}-${label.split(" ")[0]}-road-armed.png`), clip: { x: 1440 - 168, y: 0, width: 168, height: viewport.height } });
      });
    }

    test("trailer kind: the 12′×53′ value fits too", async ({ page }) => {
      await open(page, undefined, theme);
      await page.getByRole("button", { name: /Parking type/ }).click();
      await page.getByRole("button", { name: /^Trailer parking/ }).click();
      const m = await measure(page);
      const park = m.splits.find((s) => /Parking/.test(s.name));
      expect(park.valueText).toBe("12′×53′");
      expect(park.mainOverflow).toBeLessThanOrEqual(0);
      expect(park.pillOverflow).toBeLessThanOrEqual(0);
      expect(park.contentRight).toBeLessThanOrEqual(park.mainRight + 0.5);
    });
  });
}

test.describe("right tool rail — values, menus, states", () => {
  test("Measure is under Tools, in order, and nothing was removed or renamed", async ({ page }) => {
    await open(page);
    const names = await page.evaluate(() => {
      const r = document.querySelector(".rail-scroll"); const out = []; let sec = null;
      for (const el of r.querySelectorAll("[data-rail-heading], button.rbtn.rail-split-main, :scope > button.rbtn, :scope > div > button.rbtn")) {
        if (el.hasAttribute("data-rail-heading")) { sec = el.textContent; out.push({ sec, items: [] }); } else out.push({ item: el.textContent.replace(/\s+/g, " ").trim().replace(/ [A-Z⇧]{1,2}$/, "") });
      }
      return out;
    });
    const flat = names.map((n) => n.sec ? `#${n.sec}` : n.item).join(" | ");
    expect(flat).toContain("#Tools | Select | Select multiple | Parcel tools | Measure | #Site elements | Building | Paving | Road | Parking | Detention Pond | Easement | #Markup");
    expect(flat).not.toContain("#Measure");
    for (const t of ["Polyline", "Line", "Rectangle", "Ellipse", "Polygon", "Cloud", "Callout", "Text"]) expect(flat).toContain(t);
  });

  test("Road pill: shows the width, follows the menu, names itself in words; the menu checks the current width", async ({ page }) => {
    await open(page);
    const pill = page.getByRole("button", { name: /^Road presets/ });
    await expect(pill).toHaveAttribute("data-rail-pill", "value");
    await pill.click();
    await page.getByRole("button", { name: /^30′/ }).click();
    await expect(pill).toContainText("30′");
    await expect(pill).toHaveAttribute("title", "Road width: 30′ · click to change");
    await expect(pill).toHaveAttribute("aria-label", "Road presets, current width 30 feet");
    await pill.click();
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('[aria-current="true"]')).toContainText("30′");
    await expect(page.locator('[aria-current="true"] [aria-hidden="true"]')).toHaveText("✓");
    await page.getByRole("button", { name: /^Custom width/ }).click();
    const input = page.getByLabel("Custom road width (ft)");
    await input.fill("28"); await input.press("Enter");
    await expect(pill).toContainText("28′");
    await expect(pill).toHaveAttribute("aria-label", "Road presets, current width 28 feet");
  });

  test("Parking pill shows the stall from the plan's own standards", async ({ page }) => {
    await open(page);
    const pill = page.getByRole("button", { name: /^Parking type/ });
    await expect(pill).toContainText("9′×18′");
    await expect(pill).toHaveAttribute("title", "Parking stall: 9′ × 18′ · click to change");
    await expect(pill).toHaveAttribute("aria-label", "Parking type, stall 9 by 18 feet");
  });

  test("Building icon draws the dock layout; the ▾ stays plain; Parcel tools / Measure / Easement stay plain ▾", async ({ page }) => {
    await open(page);
    const iconD = () => page.locator('[data-rail-split] , .rail-split').filter({ has: page.getByRole("button", { name: /^Building/ }) }).locator("svg.rbtn-icon path").evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
    const pickDock = async (label) => { await page.getByRole("button", { name: /^Dock layout/ }).click(); await page.getByRole("button", { name: label }).click(); };
    await pickDock(/^Cross-dock/);
    expect(await iconD()).toEqual(["M5 2 H11 M5 14 H11"]);
    await pickDock(/^Single-load/);
    expect(await iconD()).toEqual(["M5 14 H11"]);
    await pickDock(/^No docks/);
    expect(await iconD()).toEqual([]);
    for (const n of ["Parcel tools", "Measure modes", "Easement options", "Dock layout"]) {
      await expect(page.locator(`button.rail-split-pill[aria-label^="${n}"]`)).toHaveAttribute("data-rail-pill", "plain");
    }
  });

  test("armed = one flat shape: shared fill, no gap, no shadow, a faint divider", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Road$/ }).click();
    const s = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".rail-split")].find((e) => e.querySelector(".rail-split-main").textContent.includes("Road"));
      const m = el.querySelector(".rail-split-main"), p = el.querySelector(".rail-split-pill");
      const cm = getComputedStyle(m), cp = getComputedStyle(p);
      return { bgM: cm.backgroundColor, bgP: cp.backgroundColor, shM: cm.boxShadow, shP: cp.boxShadow, gap: p.getBoundingClientRect().left - m.getBoundingClientRect().right, divider: cp.borderLeftColor, dividerW: cp.borderLeftWidth, inkM: cm.color, inkP: cp.color };
    });
    expect(s.bgM).toBe(s.bgP);
    expect(s.shM).toBe("none"); expect(s.shP).toBe("none");
    expect(s.gap).toBeLessThanOrEqual(0.5);
    expect(s.dividerW).toBe("1px");
    expect(s.divider).not.toBe("rgba(0, 0, 0, 0)");
    expect(s.inkM).toBe(s.inkP);
  });

  test("shortcut letters: hidden at rest, shown on hover; keyboard focus ring is visible", async ({ page }) => {
    await open(page);
    const row = page.getByRole("button", { name: /^Select\b/ }).first();
    const hint = row.locator(".rbtn-hint");
    await expect(hint).toHaveText("V");
    await expect(hint).toHaveCSS("opacity", "0");
    await row.hover();
    await expect(hint).toHaveCSS("opacity", "1");
    // a tool with no shortcut gains none
    await expect(page.getByRole("button", { name: /^Road$/ }).locator(".rbtn-hint")).toHaveCount(0);
    // real keyboard focus on a value pill shows the ring
    await page.mouse.move(5, 5);
    await page.keyboard.press("Shift");
    await page.getByRole("button", { name: /^Road presets/ }).focus();
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, w: cs.outlineWidth }; });
    expect(ring.style).not.toBe("none");
    expect(parseFloat(ring.w)).toBeGreaterThanOrEqual(2);
  });
});
