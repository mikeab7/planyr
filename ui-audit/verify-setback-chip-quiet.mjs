/* NEW-1 / NEW-2 / NEW-3 / NEW-4 — the setback chip, driven in a real browser.
 *
 * The owner's four remaining reports on the chip surface (2026-07-30, Weld County CO, site
 * sms7v3ua7ksy — the B1184 grouping fix worked, these are what is left):
 *   NEW-1  "the text is bright green… I thought we talked about the text just being black, and the
 *          outline of the thing. When I clicked reset setback line then the text went black."
 *   NEW-2  "the setback chip is showing as the only thing I can see when I zoom out — it's kind of
 *          pointless at this zoom."
 *   NEW-3  "there's too much information almost, or it's just too much."
 *   NEW-4  "it's annoying if I have a building already there because now I can't edit it because
 *          it's behind the building."
 *
 * Logged out, no external GIS, geometry seeded from the local production fixture — so this is
 * Claude-verifiable here rather than a live-verify to park. The plan seeds a BRIGHT GREEN setback
 * line (`sbStroke`, exactly the owner's parcel) and a building sitting hard on the setback line.
 *
 * Run:  npm run build && npx vite preview --port 4178   (separate shell)
 *       BASE_URL=http://localhost:4178/ node ui-audit/verify-setback-chip-quiet.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4178/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const weld = JSON.parse(readFileSync(new URL("../test/fixtures/weldParcelProduction.json", import.meta.url), "utf8"));
const OWNER_GREEN = "#22c55e";   // the bright green the owner's setback line carries

// A building placed ON the setback line, in the interior near the boundary — the NEW-4 repro.
const xs = weld.points.map((p) => p.x), ys = weld.points.map((p) => p.y);
const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
// Big enough to cover the interior AND the setback band on every side — the owner's plan has the
// buildings hard against the setback line, which is what buried the chips under a building's fill.
const building = {
  id: "bldgOverSetback", type: "building", cx: mid.x, cy: mid.y, w: 1340, h: 2320, rot: 0, z: 0,
};

/* A Weld-shaped county record — SYNTHETIC values (no real record rides into the repo), carrying
 * the two owner-ish columns the schema pattern has and a long legal description. This is what
 * NEW-5 (the parcel details panel) is verified against. */
const OWNER = "FORESTAR USA REAL ESTATE GROUP INC";
const ATTRS = {
  OWNER_NAME: OWNER, NAME_CARE: OWNER,
  ADDRESS1: "2221 E LAMAR BLVD STE 790", SITUS: "1234 COUNTY ROAD 17",
  PARCEL_ID: "R8901234", ACRES: 62.66, LAND_VALUE: 0, IMP_VALUE: 0, MARKET_VALUE: 0,
  LAND_USE: "VACANT LAND",
  LEGAL: "LOT 1 BLK 2 HIGHLAND MEADOWS FILING NO 3 BEING A REPLAT OF TRACT A, TOGETHER WITH THAT "
    + "PORTION OF THE NE1/4 OF SECTION 14, T3N, R67W OF THE 6TH P.M., COUNTY OF WELD, STATE OF "
    + "COLORADO, MORE PARTICULARLY DESCRIBED AS BEGINNING AT THE NORTHEAST CORNER THEREOF…",
};

const sites = {
  weldchip: {
    id: "weldchip", groupId: "weldchip", site: "weldchip", name: "Concept A",
    origin: { lat: 40.34612498, lon: -104.97788964 }, county: "weld",
    parcels: [{ id: weld.parcelId, points: weld.points, sbStroke: OWNER_GREEN, attrs: ATTRS }],
    els: [building], measures: [], callouts: [], markups: [],
    settings: { showSetback: true, setback: weld.defaultSetbackFt }, underlay: null, status: "active", updatedAt: now,
  },
};

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

// WCAG contrast, the same formula ui-audit/contrast-audit.mjs uses for the CSS tokens.
const rgb = (css) => {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(",").slice(0, 3).map((v) => parseFloat(v));
  const h = String(css).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (css) => {
  const ch = rgb(css).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const readChips = (page) => page.evaluate(() => {
  const groups = [...document.querySelectorAll('[data-testid="setback-chip"]')].map((rect) => {
    const g = rect.parentElement;
    const t = g.querySelector("text");
    const cs = getComputedStyle(t);
    const rs = getComputedStyle(rect);
    const box = rect.getBoundingClientRect();
    return {
      text: (t.textContent || "").trim(),
      textFill: cs.fill, fontSize: cs.fontSize,
      plateFill: rs.fill, borderStroke: rs.stroke, borderOpacity: rs.strokeOpacity,
      cx: box.left + box.width / 2, cy: box.top + box.height / 2,
    };
  });
  return groups;
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const jsErrors = [];

async function run(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(`(()=>{try{
    localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));
    localStorage.removeItem('planarfit:currentSite:v1');
    localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
  }catch(e){}})();`);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("weldchip")').first().click();
  await page.waitForTimeout(1400);
  await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await page.waitForTimeout(400);

  /* Select the parcel from the PARCELS panel list, not by clicking its boundary: the whole point
     of this fixture is that a building covers the lot, so a canvas click would land on the
     building. (That the panel row still works is itself the reason the chips, not the boundary,
     are the thing that had to move layer.) */
  await page.locator('button:has-text("Parcel 1")').first().click();
  await page.waitForTimeout(600);

  return { ctx, page };
}

for (const theme of ["light", "dark"]) {
  console.log(`\n── ${theme} theme ──────────────────────────────────────────`);
  const { ctx, page } = await run(theme);
  await page.screenshot({ path: `${OUT}chip-quiet-${theme}-plan.png` });

  const chips = await readChips(page);
  console.log(`  · chips: ${chips.map((c) => c.text).join(" | ")}`);

  // --- NEW-1: black text on the plate, the colour only on the border --------------------------
  ok(`${theme} · chips render at plan zoom`, chips.length > 0, `${chips.length} chips`);
  if (chips.length) {
    const c = chips[0];
    ok(`${theme} · NEW-1 chip TEXT is not the user's bright-green line colour`,
       contrast(c.textFill, OWNER_GREEN) > 2, `text ${c.textFill} vs line ${OWNER_GREEN}`);
    ok(`${theme} · NEW-1 chip text clears WCAG AA on its plate`,
       contrast(c.textFill, c.plateFill) >= 4.5, `${contrast(c.textFill, c.plateFill).toFixed(1)}:1 (${c.textFill} on ${c.plateFill})`);
    ok(`${theme} · NEW-1 the setback colour IS on the chip border`,
       contrast(c.borderStroke, OWNER_GREEN) < 1.2, `border ${c.borderStroke}`);
    // --- NEW-3: quieter — smaller type and a softened border ----------------------------------
    ok(`${theme} · NEW-3 the numerals are smaller than the old plate's`,
       parseFloat(c.fontSize) <= 10, `${c.fontSize}`);
    ok(`${theme} · NEW-3 the border is softened, not saturated`,
       parseFloat(c.borderOpacity) < 1, `stroke-opacity ${c.borderOpacity}`);
    // --- NEW-3: no repeated role word on a uniform parcel -------------------------------------
    ok(`${theme} · NEW-3 a uniform 25′ parcel shows bare values, no repeated role word`,
       chips.every((x) => /^\d+′$/.test(x.text)), chips.map((x) => x.text).join(" | "));
  }

  // --- NEW-4: a chip over a building is still clickable ----------------------------------------
  const layering = await page.evaluate(() => {
    const b = document.querySelector('[data-el-id="bldgOverSetback"], [data-testid="building"]')
      || [...document.querySelectorAll("rect,polygon")].find((n) => (n.getAttribute("data-id") || "") === "bldgOverSetback");
    const bb = b ? b.getBoundingClientRect() : null;
    return [...document.querySelectorAll('[data-testid="setback-chip"]')].map((r) => {
      const box = r.getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const el = document.elementFromPoint(cx, cy);
      return {
        top: el ? (el.getAttribute("data-testid") || el.tagName) : "none",
        overBuilding: !!bb && cx >= bb.left && cx <= bb.right && cy >= bb.top && cy <= bb.bottom,
      };
    });
  });
  const CHIP_PARTS = ["setback-chip", "setback-chip-text"];
  ok(`${theme} · NEW-4 a chip really does sit over the building (the repro is set up)`,
     layering.some((h) => h.overBuilding), `${layering.filter((h) => h.overBuilding).length}/${layering.length} chips over it`);
  ok(`${theme} · NEW-4 every chip is the TOPMOST element at its own centre — nothing paints over it`,
     layering.length > 0 && layering.every((h) => CHIP_PARTS.includes(h.top)),
     [...new Set(layering.map((h) => h.top))].join(", "));

  if (chips.length) {
    // …and clicking one still opens the inline value editor (never a dialog box) even though the
    // building is painted over that exact spot. This is the owner's actual complaint.
    await page.mouse.click(chips[0].cx, chips[0].cy);
    await page.waitForTimeout(400);
    const editorOpen = await page.evaluate(() =>
      [...document.querySelectorAll("input")].some((i) => i.closest("foreignObject")));
    ok(`${theme} · NEW-4 clicking a chip that sits over a building opens its inline editor`, editorOpen);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // --- NEW-5: the parcel details panel ---------------------------------------------------------
  const panel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="parcel-row"]')];
    const visible = rows.filter((r) => r.offsetParent !== null && !r.closest("details[data-testid=\"parcel-more\"]"));
    const owner = document.querySelector('[data-testid="parcel-owner"]');
    const more = document.querySelector('[data-testid="parcel-more"]');
    return {
      ownerText: owner ? owner.textContent.trim() : null,
      ownerOccurrences: owner ? (document.querySelector('[data-testid="parcel-owner"]').closest("div[style]")?.parentElement?.textContent || "").split(owner.textContent.trim()).length - 1 : 0,
      visibleLabels: visible.map((r) => r.querySelector("span")?.textContent.trim()),
      moreOpen: more ? more.open : null,
      moreCount: more ? more.querySelectorAll('[data-testid="parcel-row"]').length : 0,
    };
  });
  console.log(`  · panel rows: ${panel.visibleLabels.join(", ")} (+${panel.moreCount} folded)`);
  ok(`${theme} · NEW-5 the owner appears ONCE — as the headline, never also as a row`,
     panel.ownerText === "FORESTAR USA REAL ESTATE GROUP INC" && panel.ownerOccurrences === 1
       && !panel.visibleLabels.includes("Owner"),
     `headline "${panel.ownerText}" · ${panel.ownerOccurrences}× · rows ${panel.visibleLabels.join("/")}`);
  ok(`${theme} · NEW-5 the default view is the three short rows`,
     panel.visibleLabels.join("|") === "Situs address|Account / ID|Acreage", panel.visibleLabels.join(", "));
  ok(`${theme} · NEW-5 the rest — incl. the Legal blob — is behind a CLOSED disclosure`,
     panel.moreOpen === false && panel.moreCount >= 4, `${panel.moreCount} folded rows, open=${panel.moreOpen}`);

  // --- NEW-2: chips leave at overview zoom and come back on zoom-in -----------------------------
  const zoomOut = async (n) => { for (let i = 0; i < n; i++) { await page.locator('button[aria-label="Zoom out"]').first().click(); await page.waitForTimeout(120); } };
  const zoomIn = async (n) => { for (let i = 0; i < n; i++) { await page.locator('button[aria-label="Zoom in"]').first().click(); await page.waitForTimeout(120); } };
  await zoomOut(12);
  await page.waitForTimeout(500);
  const atCounty = await readChips(page);
  await page.screenshot({ path: `${OUT}chip-quiet-${theme}-overview.png` });
  ok(`${theme} · NEW-2 no setback chip survives at overview zoom`, atCounty.length === 0, `${atCounty.length} chips`);
  const ringStillThere = await page.locator('[data-testid="parcel-outline"]').count();
  ok(`${theme} · NEW-2 the parcel itself is still drawn — only the annotation left`, ringStillThere > 0);

  await zoomIn(12);
  await page.waitForTimeout(600);
  const back = await readChips(page);
  await page.screenshot({ path: `${OUT}chip-quiet-${theme}-zoomed-in.png` });
  ok(`${theme} · NEW-2 they return on zoom-in`, back.length > 0, `${back.length} chips`);

  await ctx.close();
}

ok("no JS errors during the whole run", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed  ·  screenshots in ui-audit/screens/`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.n).join("; ")); process.exit(1); }
console.log("ALL PASS");
