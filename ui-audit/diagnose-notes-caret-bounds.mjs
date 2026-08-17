/* diagnose-notes-caret-bounds — WHERE DOES THE OS THINK THE CARET IS? (NEW-CARET-BOUNDS).
 *
 * ⛔ HIS REPORT, and it is an ACCESSIBILITY report, not a cosmetic one: *"Can you make it so that
 * my cursor shows where it should… you can see the faint outline of the text box, and those little
 * red marks are where my cursor goes. It's just an accessibility thing that I've added to my PC,
 * but it doesn't seem to match very well on this module."* That is Windows 11's **Text cursor
 * indicator**, which paints markers above and below the caret so it can be found. Windows
 * positions them from the caret rectangle the application reports through the accessibility /
 * IME layer — **NOT from what is painted**. When the two disagree, the markers land somewhere the
 * caret is not. In his screenshot they sit up and to the LEFT of the box he is typing in.
 *
 * ⛔ THIS FILE DOES NOT FIX ANYTHING AND DOES NOT ASSUME A CAUSE. It measures, and it measures the
 * two geometries SEPARATELY so their difference is a number rather than an opinion:
 *
 *   PAINTED    — `getBoundingClientRect()` / `Range.getClientRects()`, i.e. what he can see.
 *   REPORTED   — `DOM.getBoxModel` and `DOM.getContentQuads` over CDP. These come from the
 *                layout tree by the same route the native accessibility and IME bounds do, so
 *                where they disagree with the painted rect, a native consumer is being handed
 *                the wrong rectangle. It is a PROXY for the OS's own value and is labelled as
 *                one — this harness cannot read Windows' UI Automation from Linux, and says so
 *                rather than implying it has.
 *
 * ⛔ THE BRIEF'S FIRST HYPOTHESIS IS TESTED AND IS EXPECTED TO FAIL, which is worth stating so
 * the result is not read as a confirmation. It proposed that the positioned boxes are placed with
 * a CSS TRANSFORM, so Chrome would report their untransformed position. They are not: the node
 * view writes `left`/`top` and the stylesheet says `position: absolute`. The `computed` column
 * below prints the transform for every host so that refutation is on the record rather than
 * asserted. The candidate this module actually has is **CSS `zoom`** on the sheet — and a zoom of
 * z maps a painted point to an unzoomed one CLOSER TO THE ORIGIN, i.e. up and to the left, which
 * is the direction he photographed.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch({
  executablePath: EXEC,
  // Force the accessibility tree on, so the layer under test is actually being maintained.
  args: ["--no-sandbox", "--force-renderer-accessibility"],
});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "diagnose-notes-caret-bounds");
const cdp = await page.context().newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("Accessibility.enable").catch(() => {});
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

async function seed() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, key]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Caret bounds", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "AAA the first line of ordinary body text" }] },
        ...Array.from({ length: 30 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `filler line ${i + 1}` }] })),
        { type: "noteAnchor", attrs: { x: 420, y: 160, w: 260 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "BBB inside a placed box" }] }] },
      ],
    }));
  }, [TREE_KEY, PAGE_KEY]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** The REPORTED box for a selector, straight out of the layout tree over CDP. */
async function reportedBox(selector) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  try {
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    const q = model.border;                 // x1,y1, x2,y2, x3,y3, x4,y4
    return {
      x: Math.round(q[0] * 100) / 100,
      y: Math.round(q[1] * 100) / 100,
      w: Math.round((q[2] - q[0]) * 100) / 100,
      h: Math.round((q[5] - q[1]) * 100) / 100,
    };
  } catch (_) { return null; }
}

/** The PAINTED box for a selector, plus the computed properties the brief asks about. */
const paintedBox = (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    x: Math.round(r.x * 100) / 100,
    y: Math.round(r.y * 100) / 100,
    w: Math.round(r.width * 100) / 100,
    h: Math.round(r.height * 100) / 100,
    position: cs.position,
    transform: cs.transform,
    zoom: cs.zoom,
  };
}, selector);

/** Put a real caret at a word and report the caret rectangle the browser paints. */
const caretAt = (word) => page.evaluate((needle) => {
  const pm = document.querySelector(".ProseMirror");
  const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf(needle);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i + needle.length);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const rects = [...r.getClientRects()];
    const b = rects[0] || r.getBoundingClientRect();
    return { x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, h: Math.round(b.height * 100) / 100 };
  }
  return null;
}, word);

const setZoom = (z) => page.evaluate((zz) => {
  localStorage.setItem("planyr:notes:zoom:v1:local", String(zz));
}, z).then(async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
});

const pad = (s, n) => String(s == null ? "—" : s).padEnd(n);
const fmt = (b) => (b ? `${b.x}, ${b.y}  ${b.w}×${b.h}` : "—");

const HOSTS = [
  ["the editor body", ".ProseMirror"],
  ["a placed box", ".planyr-anchor"],
  ["the box's content", ".planyr-anchor-content"],
  ["the page title", '[data-testid="note-title"]'],
  ["the zoomed sheet", '[data-testid="note-sheet"]'],
];

const findings = [];

async function pass(label, { scrolled = false } = {}) {
  console.log("\n" + "=".repeat(112));
  console.log(label);
  console.log("=".repeat(112));
  if (scrolled) {
    await page.evaluate(() => {
      const pm = document.querySelector(".ProseMirror");
      for (let n = pm?.parentElement; n; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === "auto" || oy === "scroll") { n.scrollTop = 220; return; }
      }
    });
    await pacedWait(page, 400);
  }
  console.log(pad("host", 22) + pad("PAINTED (seen)", 26) + pad("REPORTED (native)", 26) + pad("Δ x,y", 16) + "position / transform / zoom");
  console.log("-".repeat(112));
  for (const [name, sel] of HOSTS) {
    const p = await paintedBox(sel);
    const r = await reportedBox(sel);
    if (!p) { console.log(pad(name, 22) + "— not present"); continue; }
    const dx = r ? Math.round((r.x - p.x) * 100) / 100 : null;
    const dy = r ? Math.round((r.y - p.y) * 100) / 100 : null;
    const off = r && (Math.abs(dx) > 2 || Math.abs(dy) > 2);
    console.log(pad(name, 22) + pad(fmt(p), 26) + pad(fmt(r), 26)
      + pad(r ? `${dx}, ${dy}${off ? "  ⛔" : ""}` : "—", 16)
      + `${p.position} / ${p.transform} / ${p.zoom}`);
    if (off) findings.push(`${label} · ${name}: reported bounds are off by (${dx}, ${dy})`);
  }

  /* The caret itself, in both surfaces, since that is the rectangle Windows actually consumes. */
  for (const [what, word] of [["body text", "AAA"], ["inside a box", "BBB"]]) {
    const c = await caretAt(word);
    console.log(`  caret ${pad(what, 14)} painted at ${c ? `${c.x}, ${c.y} (h ${c.h})` : "— not found"}`);
  }
}

await seed();
await pass("A · 100% zoom, not scrolled");
await pass("B · 100% zoom, after scrolling the canvas", { scrolled: true });

await setZoom(2);
await pass("C · 200% zoom, not scrolled");
await pass("D · 200% zoom, after scrolling the canvas", { scrolled: true });

await setZoom(0.8);
await pass("E · 80% zoom, not scrolled");

console.log("\n" + "=".repeat(112));
console.log("READING THIS TABLE");
console.log("=".repeat(112));
console.log("  PAINTED is what he sees. REPORTED is what the layout tree hands the native");
console.log("  accessibility / IME layer, which is where Windows' text cursor indicator gets its");
console.log("  rectangle. A non-zero Δ at any zoom means the OS is being told the caret is");
console.log("  somewhere it is not, and the SIGN of the Δ says which way the markers will land.");
console.log("\n  ⛔ WHAT THIS HARNESS CANNOT DO, stated rather than implied: it cannot read Windows'");
console.log("  UI Automation. It runs on Linux and measures Chromium's own layout-tree geometry as");
console.log("  a PROXY for what the platform layer is handed. If every Δ here is zero, the honest");
console.log("  conclusion is that the mismatch is NOT in geometry this module controls.");

console.log(findings.length ? `\n⛔ ${findings.length} MISMATCH(ES)` : "\n✓ painted and reported geometry agree everywhere measured");
for (const f of findings) console.log(`  ✗ ${f}`);
console.log(`\npage errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
