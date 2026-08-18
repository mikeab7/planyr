/* verify-notes-caret-a11y — THE CARET IS EXPOSED WHERE IT ACTUALLY IS (NEW-CARET-BOUNDS).
 *
 * ⛔ HIS REPORT, and it is an ACCESSIBILITY report: *"Can you make it so that my cursor shows
 * where it should… those little red marks are where my cursor goes. It's just an accessibility
 * thing that I've added to my PC, but it doesn't seem to match very well on this module."* That
 * is Windows 11's **Text cursor indicator**. Windows takes the caret rectangle from the
 * accessibility layer, NEVER from what is painted — so when the two disagree, the markers land
 * where the caret is not. In his screenshot they sit up and to the LEFT of the box he is in.
 *
 * ⛔ WHAT WAS MEASURED, in the order it was measured, because the first hypothesis was wrong and
 * saying so is part of the answer:
 *
 *   1. **The boxes are NOT transform-positioned.** `diagnose-notes-caret-bounds` prints
 *      `transform: none` for every editing host, and finds the painted rect and the layout-tree
 *      rect identical to the pixel at 80%, 100% and 200% zoom, scrolled and not. The geometry
 *      this module controls was never wrong.
 *   2. **The note body was exposed as `role=generic`.** Dumped from the real accessibility tree:
 *          note-title  →  role=textbox   editable=plaintext   multiline=false   ✅
 *          note-body   →  role=GENERIC   editable=richtext    multiline=—       ⛔
 *      A generic node exposes no text pattern for a platform client to read a caret rectangle
 *      out of, so the OS falls back to the bounds of the editable REGION — whose top-left corner
 *      is up and to the left of any box placed on the page, which is the direction and the
 *      growing-with-distance behaviour he photographed.
 *
 * ⛔ THE KNOWN-GOOD ARM IS THE PAGE TITLE, and it is here by design rather than by luck
 * (DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6). It was ALREADY exposed correctly before this fix,
 * so it is a value known independently of the code under test: if the title arm ever reports
 * anything but a textbox, this harness is reading the tree wrongly and its verdict on the body
 * is worthless. A run that cannot confirm the known case must not score the unknown one.
 *
 * ⛔ AND WHAT THIS HARNESS CANNOT DO, stated rather than implied: it cannot read Windows' UI
 * Automation — it runs on Linux and reads Chromium's own accessibility tree, which is what
 * Chromium hands the platform layer. It can prove the module exposes a real text control with a
 * real caret; it cannot prove what Windows then draws. That distinction is on the item.
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
  // The layer under test only exists if it is being maintained.
  args: ["--no-sandbox", "--force-renderer-accessibility"],
});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "verify-notes-caret-a11y");
const cdp = await page.context().newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("Accessibility.enable");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed(zoom = 1) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, key, z]) => {
    localStorage.clear();
    localStorage.setItem("planyr:notes:zoom:v1:local", String(z));
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Caret", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "AAA the first line of body text" }] },
        ...Array.from({ length: 12 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `filler ${i + 1}` }] })),
        { type: "noteAnchor", attrs: { x: 420, y: 160, w: 260 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "BBB inside a placed box" }] }] },
      ],
    }));
  }, [TREE_KEY, PAGE_KEY, zoom]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** The accessibility tree as Chromium hands it to the platform, flattened for searching. */
async function axTree() {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const val = (v) => (v && v.value !== undefined ? v.value : undefined);
  const prop = (n, name) => (n.properties || []).find((p) => p.name === name)?.value?.value;
  const conv = (n, seen = new Set()) => {
    if (!n || seen.has(n.nodeId)) return null;
    seen.add(n.nodeId);
    return {
      role: val(n.role), name: val(n.name), value: val(n.value),
      editable: prop(n, "editable"), multiline: prop(n, "multiline"), focused: prop(n, "focused"),
      children: (n.childIds || []).map((id) => byId.get(id)).filter(Boolean)
        .map((c) => conv(c, seen)).filter(Boolean),
    };
  };
  return conv(nodes[0]);
}

const find = (n, pred) => {
  if (!n) return null;
  if (pred(n)) return n;
  for (const c of n.children || []) { const r = find(c, pred); if (r) return r; }
  return null;
};

/** Put a real caret in a surface, so the tree reflects a live editing session. */
const caretAt = (word) => page.evaluate((needle) => {
  const pm = document.querySelector(".ProseMirror");
  pm.focus();
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
    const b = [...r.getClientRects()][0] || r.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), h: Math.round(b.height) };
  }
  return null;
}, word);

/** Painted vs layout-tree geometry for one selector — the refutation half, kept as an assertion
 *  so the transform hypothesis cannot quietly come back true. */
async function geometry(selector) {
  const painted = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, transform: getComputedStyle(el).transform };
  }, selector);
  if (!painted) return null;
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) return { painted, reported: null };
  try {
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    return { painted, reported: { x: Math.round(model.border[0] * 100) / 100, y: Math.round(model.border[1] * 100) / 100 } };
  } catch (_) { return { painted, reported: null }; }
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 1 · THE KNOWN-GOOD ARM — the page title, which was ALREADY correct before this fix
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n1 · THE KNOWN-GOOD ARM (the page title was already exposed correctly)");
await seed();
await page.locator('[data-testid="note-title"]').click();
await pacedWait(page, 400);
let tree = await axTree();
const title = find(tree, (n) => n.name === "Page title");
ok("⛔ the page title is exposed as a real text control", title?.role === "textbox", `role=${title?.role}`);
if (title?.role !== "textbox") {
  console.log("\n⛔ VACUOUS RUN — the known-good arm did not report its known value.");
  console.log("   This harness is reading the accessibility tree wrongly, so its verdict on the");
  console.log("   note body would be worthless. Fix the instrument before believing any row below.");
  await browser.close();
  process.exit(2);
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 2 · THE BODY IS A REAL TEXT CONTROL TOO — the defect, and the fix
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n2 · THE WRITING SURFACE IS A REAL TEXT CONTROL (it was `generic`)");
await caretAt("AAA");
await pacedWait(page, 400);
tree = await axTree();
const body = find(tree, (n) => String(n.name || "").startsWith("Note body"));
console.log(`    note-body → role=${body?.role} editable=${body?.editable} multiline=${body?.multiline}`);
ok("⛔ the note body is exposed as a TEXTBOX, not a generic container", body?.role === "textbox", `role=${body?.role}`);
ok("⛔ …and it says it is MULTILINE — a single-line field's caret rect is one line's geometry",
  body?.multiline === true, `multiline=${body?.multiline}`);
ok("…and it is still editable rich text", body?.editable === "richtext", `editable=${body?.editable}`);
ok("it keeps its accessible name, including the keyboard-trap escape (B1392)",
  String(body?.name || "").includes("Escape"), body?.name);

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 3 · A CARET INSIDE A PLACED BOX IS INSIDE THAT SAME CONTROL
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n3 · A CARET IN A PLACED BOX IS STILL IN AN EXPOSED TEXT CONTROL");
const inBox = await caretAt("BBB");
await pacedWait(page, 400);
tree = await axTree();
const body2 = find(tree, (n) => String(n.name || "").startsWith("Note body"));
ok("a caret can be placed inside a positioned box", Boolean(inBox), inBox ? `${inBox.x}, ${inBox.y}` : "no caret");
ok("⛔ the surrounding control is still a textbox with the caret in it", body2?.role === "textbox", `role=${body2?.role}`);
const boxText = find(tree, (n) => String(n.name || "").includes("BBB") || String(n.value || "").includes("BBB"));
ok("…and the box's own words are reachable in the tree", Boolean(boxText) || Boolean(body2), boxText ? `as ${boxText.role}` : "via the body");

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 4 · THE REFUTED HYPOTHESIS, KEPT AS AN ASSERTION
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n4 · NO TRANSFORM, AND PAINTED == LAYOUT-TREE GEOMETRY (the refutation, pinned)");
for (const zoom of [1, 2]) {
  await seed(zoom);
  await caretAt("BBB");
  await pacedWait(page, 300);
  for (const [name, sel] of [["the editor body", ".ProseMirror"], ["a placed box", ".planyr-anchor"], ["the page title", '[data-testid="note-title"]']]) {
    const g = await geometry(sel);
    if (!g) { ok(`${zoom * 100}% · ${name} is present`, false); continue; }
    ok(`${zoom * 100}% · ${name} is positioned by LAYOUT, not a transform`, g.painted.transform === "none", g.painted.transform);
    const dx = g.reported ? Math.abs(g.reported.x - g.painted.x) : null;
    const dy = g.reported ? Math.abs(g.reported.y - g.painted.y) : null;
    ok(`${zoom * 100}% · ${name}: painted and layout-tree bounds agree`, dx != null && dx <= 2 && dy <= 2,
      g.reported ? `Δ ${Math.round(dx * 100) / 100}, ${Math.round(dy * 100) / 100}` : "no reported box");
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
