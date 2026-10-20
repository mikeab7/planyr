/* NEW-1 (site-record panel V1, owner-approved 2026-10-19) — drives the REAL Records rail and checks the
 * single-record view against the approved layout, in a real browser:
 *
 *   • top row (← All comps + deal-type badge), name with the location under it, 2px rule
 *   • DEAL / BUILDING / PARTIES / DOCUMENTS headers, hairlines between rows, none after the last
 *   • no Site dropdown anywhere in the record, no "Recently deleted", no "Zoomed out too far"
 *   • a document row: thumbnail · filename · "date · p.N · Zoom to" · ⋮, and "Add" on the Documents rule
 *   • a sparse comp: only its rows, no dash rows, no empty section, Documents still there with Add
 *   • a comp with no document: the Documents header with Add only
 *   • sale / land comps: badge reads SALE / LAND and the Deal rows are that type's fields
 *   • the comps LIST still has "Recently deleted"
 *   • body text is ONE size (every record row measures the same computed font-size / line-height)
 *
 * KNOWN-GOOD ARM (CLAUDE.md → DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the full-lease record is opened first
 * and must show every section; a run that cannot find that is void, not green.
 *
 * Two modes: default mocks Supabase (sandbox, `ctx.route`, same idiom as verify-site-plan-adjust-panel);
 * `--live <base>` signs in as the e2e test account via the shared helper and checks whatever comps that
 * account has (the fixtures below are only used to know what the mock mode should see).
 *   BASE_URL=http://localhost:4173/ node ui-audit/verify-comp-record-layout.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const OUT = process.env.SHOTS_DIR || new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const VIEWPORT = { width: 1440, height: 900 };
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const blank = {
  user_id: "fake-user-1", team_id: null, project_id: null, lease_commencement_date: null, notes: null, anchor_kind: "pin",
  lat: 29.87, lon: -95.55, county: "harris", parcel_apn: null, parcel_geom: null, site_plan_overlay_id: null, site_plan_point: null,
  land_price: null, land_size_value: null, land_size_unit: null, bldg_price: null, bldg_size_sf: null, bldg_noi: null, bldg_cap_rate: null,
  lease_rate: null, lease_rate_period: null, lease_rate_expense: null, lease_ti: null, lease_term: null, lease_size_sf: null,
  lease_free_rent_months: null, lease_escalation_pct: null, lease_opex: null, comp_party_provider: null, comp_party_acquirer: null,
  clear_height_ft: null, year_built: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
const COMPS = [
  { ...blank, id: "c-lease", comp_type: "lease", comp_date: "2026-08-20", title: "Core 5 - West Hardy", project_id: "p1", site_plan_overlay_id: "ov1", site_plan_point: { x: 300, y: 200 },
    lease_rate: 0.67, lease_rate_period: "monthly", lease_rate_expense: "nnn", lease_term: "60 mo", lease_ti: 3.5, lease_free_rent_months: 2,
    lease_escalation_pct: 3, lease_commencement_date: "2026-10-01", lease_opex: 1.2, lease_size_sf: 52000, clear_height_ft: 32, year_built: 2022,
    comp_party_provider: "Core5", comp_party_acquirer: "Acme Logistics" },
  { ...blank, id: "c-sparse", comp_type: "lease", comp_date: "2026-07-01", title: "Sparse Lease", project_id: "p2", lease_rate: 8.4, lease_rate_period: "annual", lease_rate_expense: "nnn" },
  { ...blank, id: "c-sale", comp_type: "building_sale", comp_date: "2026-06-15", title: "Sale Bldg", bldg_price: 9000000, bldg_size_sf: 100000, comp_party_provider: "Seller LP", comp_party_acquirer: "Buyer LLC" },
  { ...blank, id: "c-land", comp_type: "land", comp_date: "2026-05-02", title: "Land Tract", land_price: 850000, land_size_value: 3.2, land_size_unit: "ac" },
];
const OVERLAY = {
  id: "ov1", user_id: "fake-user-1", team_id: null, project_id: "p1", site_link_declined: false, review_id: "fake-review-1", page: 1,
  doc_title: "Core5 flyer", doc_date: "2026-09-01", source_file_name: "core5-flyer.pdf", img_w: 1200, img_h: 900, raster_key: "k", thumb_data_url: null,
  center_lat: 29.87, center_lon: -95.55, ft_per_px: 1.2, rotation_deg: 0, crop: null, opacity: 0.85, visible: true, locked: false, version: 1,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const LIVE = process.env.LIVE_BASE || null;
let browser, ctx, page, liveSession;
const jsonOf = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
if (LIVE) {
  // LIVE MODE — the real deployed app, signed in as the e2e test account (shared helper). Reads are the real
  // service's, with the fixtures above APPENDED to the comps / overlays answers (read-only: nothing is written).
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  liveSession = await openSignedIn({ base: LIVE });
  console.log("served build:", JSON.stringify(liveSession.build));
  page = liveSession.page; ctx = page.context();
  await ctx.route("**/rest/v1/comps*", async (route) => {
    const req = route.request();
    if (req.method() !== "GET" || req.url().includes("deleted_at=not.is.null")) return route.continue();
    const res = await route.fetch(); const real = await res.json().catch(() => []);
    return route.fulfill(jsonOf([...(Array.isArray(real) ? real : []), ...COMPS]));
  });
  await ctx.route("**/rest/v1/site_plan_overlays*", async (route) => {
    const req = route.request();
    if (req.method() !== "GET" || req.url().includes("deleted_at=not.is.null")) return route.continue();
    const res = await route.fetch(); const real = await res.json().catch(() => []);
    return route.fulfill(jsonOf([...(Array.isArray(real) ? real : []), OVERLAY]));
  });
  await page.setViewportSize(VIEWPORT);
  await page.reload({ waitUntil: "load" });
} else {
browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.route("**/*.supabase.co/**", (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (path === "/auth/v1/user") return json({ id: "fake-user-1", aud: "authenticated", role: "authenticated", email: "throwaway@example.com" });
  if (path === "/rest/v1/rpc/list_my_teams") return json([]);
  if (req.method() !== "GET") return json({});
  if (path === "/rest/v1/site_plan_overlays") return json(req.url().includes("deleted_at=not.is.null") ? [] : [OVERLAY]);
  if (path === "/rest/v1/comps") return json(req.url().includes("deleted_at=not.is.null") ? [] : COMPS);
  if (path.startsWith("/rest/v1/")) return json([]);
  return json({});
});
  page = await ctx.newPage();
}
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(LIVE || BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await assertMeasurable(page, "verify-comp-record-layout");
const tab = page.locator('[data-testid="module-tab-site-planner"]');
await tab.waitFor({ state: "visible", timeout: 15000 });
await tab.click();
await page.waitForTimeout(1500);
await page.locator("button", { hasText: /^Records/ }).first().click();
await page.waitForTimeout(1200);

const rec = () => page.locator('[data-testid="comp-record"]');
const open = async (title) => {
  const back = page.locator('[data-testid="comp-record-back"]');
  if (await back.count()) { await back.click(); await page.waitForTimeout(400); }
  await page.locator("button", { hasText: title }).first().click();
  await rec().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(500);
};
const recordText = () => page.evaluate(() => {
  const r = document.querySelector('[data-testid="comp-record"]');
  const d = document.querySelector('[data-testid="comp-record-documents"]');
  return ((r && r.innerText) || "") + "\n" + ((d && d.innerText) || "");
});
const sectionHeaders = () => page.evaluate(() => {
  const root = document.querySelector('[data-testid="map-sites-panel"]') || document;
  return Array.from(root.querySelectorAll("span")).filter((s) => getComputedStyle(s).textTransform === "uppercase" && s.parentElement.style.borderBottom.includes("1px solid"))
    .map((s) => s.textContent.trim());
});

// ---- list state: Recently deleted is there ----
const listText = await page.evaluate(() => document.body.innerText);
check("the comps LIST has Recently deleted", /Recently deleted/.test(listText));
await page.screenshot({ path: OUT + "comp-record-00-list.png" });

// ---- full lease (also the known-good arm) ----
console.log("\n=== full lease ===");
await open("Core 5 - West Hardy");
const full = await recordText();
check("KNOWN-GOOD ARM: the full lease shows Rate, Term, TI, Leased SF, Clear height, Owner/Developer, Tenant",
  ["Rate", "Term", "TI allowance", "Leased SF", "Clear height", "Owner/Developer", "Tenant"].every((w) => full.includes(w)));
check("top row: ← All comps and the LEASE badge", /All comps/.test(full) && /LEASE/.test(full));
check("name with the location line under it, name semibold", await page.evaluate(() => {
  const n = document.querySelector('[data-testid="comp-record-name"]');
  return !!n && n.textContent.includes("Core 5") && Number(getComputedStyle(n).fontWeight) >= 600;
}));
const rule = await page.evaluate(() => {
  const n = document.querySelector('[data-testid="comp-record-name"]');
  return getComputedStyle(n.parentElement.parentElement).borderBottomWidth;
});
check("the title block is capped by a 2px rule", rule === "2px", rule);
const heads = await sectionHeaders();
check("headers in order: DEAL, BUILDING, PARTIES, DOCUMENTS", JSON.stringify(heads.map((h) => h.toUpperCase())) === JSON.stringify(["DEAL", "BUILDING", "PARTIES", "DOCUMENTS"]), heads.join(" | "));
check("dates are ISO", /2026-10-01/.test(full) && /2026-08-20/.test(full) && !/\b\d\d\/\d\d\/\d\d\b/.test(full));
check("no Site dropdown anywhere in the record", (await page.locator('[data-testid="comp-record"] select, [data-testid="comp-record-documents"] select').count()) === 0
  && !/No site \(detached\)/.test(await page.evaluate(() => document.body.innerText)));
check("no Recently deleted inside the record", !/Recently deleted/.test(full));
check("no 'Zoomed out too far' sentence", !/Zoomed out too far/.test(await page.evaluate(() => document.body.innerText)));
const docRow = page.locator('[data-testid="comp-record-document"]').first();
check("a document row with the filename, date · p.N and a Zoom to link", (await docRow.count()) === 1
  && /Core5 flyer/.test(await docRow.innerText()) && /2026-09-01 · p\.1 ·/.test(await docRow.innerText()) && (await page.locator('[data-testid="comp-record-zoom-to"]').count()) === 1);
check("Add sits on the Documents rule", (await page.locator('[data-testid="comp-record-add-doc"]').count()) === 1);
await page.screenshot({ path: OUT + "comp-record-01-lease-full.png" });
check("Documents sits in the SAME scroll area as the record's own sections (one panel, scrolls together)", await page.evaluate(() => {
  const scroller = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") return n; } return null; };
  const a = scroller(document.querySelector("[data-record-section]"));
  const b = scroller(document.querySelector('[data-testid="comp-record-documents"]'));
  return !!a && a === b;
}));
check("scrolled to the bottom, the Documents row and Add are fully on screen", await page.evaluate(async () => {
  const add = document.querySelector('[data-testid="comp-record-add-doc"]');
  const doc = document.querySelector('[data-testid="comp-record-document"]');
  doc.scrollIntoView({ block: "end" });
  await new Promise((r) => setTimeout(r, 100));
  const vh = window.innerHeight;
  const ra = add.getBoundingClientRect(), rd = doc.getBoundingClientRect();
  return ra.top >= 0 && ra.bottom <= vh && rd.top >= 0 && rd.bottom <= vh;
}));
const rows = await page.evaluate(() => Array.from(document.querySelectorAll("[data-record-row]")).map((r) => {
  const cs = getComputedStyle(r);
  return { fs: cs.fontSize, lh: cs.lineHeight, hair: cs.borderBottomWidth, bg: cs.backgroundColor, text: r.innerText.replace(/\s+/g, " ") };
}));
check("every row is 14px / 20px", rows.length > 8 && rows.every((r) => r.fs === "14px" && r.lh === "20px"), `${rows.length} rows`);
check("no row has a gray fill", rows.every((r) => r.bg === "rgba(0, 0, 0, 0)"));
const lastOfSections = await page.evaluate(() => Array.from(document.querySelectorAll("[data-record-section]")).map((s) => {
  const rs = s.querySelectorAll("[data-record-row]");
  return { n: rs.length, last: getComputedStyle(rs[rs.length - 1]).borderBottomWidth, first: rs.length > 1 ? getComputedStyle(rs[0]).borderBottomWidth : "1px" };
}));
check("hairline under every row except the last of its section", lastOfSections.every((s) => s.last === "0px" && s.first === "1px"), JSON.stringify(lastOfSections));
check("no '—' placeholder rows", !rows.some((r) => /—\s*$/.test(r.text)));
await page.screenshot({ path: OUT + "comp-record-01b-lease-full-scrolled.png" });

// ---- sparse lease, no document ----
console.log("\n=== sparse lease (no document) ===");
await open("Sparse Lease");
const sparse = await recordText();
const sheads = await sectionHeaders();
check("only the Deal section + Documents render", JSON.stringify(sheads.map((h) => h.toUpperCase())) === JSON.stringify(["DEAL", "DOCUMENTS"]), sheads.join(" | "));
check("Documents has Add and no document rows", (await page.locator('[data-testid="comp-record-add-doc"]').count()) === 1 && (await page.locator('[data-testid="comp-record-document"]').count()) === 0);
check("no dash rows", !(await page.evaluate(() => Array.from(document.querySelectorAll("[data-record-row]")).some((r) => /(^|\s)—\s*$/.test(r.innerText)))));
await page.screenshot({ path: OUT + "comp-record-02-lease-sparse.png" });

// ---- sale ----
console.log("\n=== building sale ===");
await open("Sale Bldg");
const sale = await recordText();
check("badge SALE and sale Deal rows", /SALE/.test(sale) && /Price/.test(sale) && /\$\/SF/.test(sale) && /Close date/.test(sale) && !/Rate\b/.test(sale));
check("Building and Parties sections present", /Building size/.test(sale) && /Seller/.test(sale) && /Buyer\/User/.test(sale));
await page.screenshot({ path: OUT + "comp-record-03-sale.png" });

// ---- land ----
console.log("\n=== land ===");
await open("Land Tract");
const land = await recordText();
check("badge LAND and land Deal rows", /LAND/.test(land) && /Price/.test(land) && /Size/.test(land) && /3\.2 AC/.test(land));
await page.screenshot({ path: OUT + "comp-record-04-land.png" });

// ---- back to the list ----
await page.locator('[data-testid="comp-record-back"]').click();
await page.waitForTimeout(400);
check("All comps returns to the list, which still has Recently deleted", /Recently deleted/.test(await page.evaluate(() => document.body.innerText)));

if (liveSession) await liveSession.close(); else await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
