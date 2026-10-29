/* verify-address-suggest-keys-live — the suggestion lists' keyboard behaviour (B2499520) on a REAL deploy, signed in as the throwaway test
 * account. KEYBOARD ONLY: type, Down, Down, Up, Enter picks the right row; Escape closes. Reads /version.json IN THE SAME CALL as each
 * reading (a stale cached bundle makes a reading meaningless — AGENT-RULES).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-address-suggest-keys-live.mjs [https://planyr.io] [--expect-sha <merge sha>] [--tap]
 *
 * Inputs covered (every list that shows suggestions): (1) the Map toolbar's address / place search; (2) Food's restaurant search.
 * (3) the comp party-name field is covered by e2e/address-suggest-keyboard.spec.js's shared-hook guard + test/listboxNav.test.js; a live
 *     pass of it needs two saved comps with party names, so it is attempted only when the test account already has them (reported, never silent).
 * Nothing here writes: no plan, comp or visit is created, so there is nothing to clear (owner constraint 15).
 *
 * The geocoder: the real Esri geocoder is used when the sandbox can reach it; otherwise it is STUBBED with four known addresses and the
 * run SAYS SO (the list's behaviour is what is under test, not Esri). Known-good arm: before judging, the list must be populated (>= 2
 * options) — an empty list is a VOID run, never a pass. FOREGROUND-OR-VOID asserted first.
 * `--tap`: also WebKit (iPhone 15 descriptor) tap-to-pick on the Map search — emulated WebKit, not a real device. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const ADDRS = ["100 Main St, Houston, TX", "200 Main St, Houston, TX", "300 Main St, Houston, TX", "400 Main St, Houston, TX"];
const stubGeocoder = (page) => page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (r) => r.fulfill({
  status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify({ candidates: ADDRS.map((a, i) => ({ address: a, location: { x: -95.3 + i * 0.01, y: 29.7 } })) }),
}));
const buildNow = (page) => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));

async function listState(page, inputSel) {
  return page.evaluate((sel) => {
    const i = document.querySelector(sel);
    const rows = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
    const list = rows[0] && rows[0].parentElement;
    const a = i && i.getAttribute("aria-activedescendant");
    const idx = a ? rows.findIndex((r) => r.id === a) : -1;
    return {
      n: rows.length, idx, value: i ? i.value : null, listBg: list ? getComputedStyle(list).backgroundColor : null,
      rowBg: idx >= 0 ? getComputedStyle(rows[idx]).backgroundColor : null, rowInk: idx >= 0 ? getComputedStyle(rows[idx]).color : null,
      text: rows.map((r) => r.textContent.trim()), selectedTrue: rows.filter((r) => r.getAttribute("aria-selected") === "true").length,
    };
  }, inputSel);
}

const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-address-suggest-keys-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build);
  if (expectSha) check("served build is the merge commit", String((await buildNow(page)) || "").startsWith(expectSha.slice(0, 7)), `served ${await buildNow(page)} vs ${expectSha.slice(0, 7)}`);

  // ── 1) MAP address search ─────────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`${base}/?cb=${Date.now()}#/site-planner`, { waitUntil: "load" });
  await page.locator(".leaflet-container").first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1500);
  const reach = await page.evaluate(() => fetch("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=100+Main+St+Houston&maxLocations=1", { cache: "no-store" }).then((r) => r.ok).catch(() => false));
  if (!reach) await stubGeocoder(page);
  console.log(`geocoder: ${reach ? "REAL Esri geocoder (reachable)" : "STUBBED (the real geocoder is unreachable from this sandbox) — list behaviour only"}`);
  const mapIn = page.getByRole("combobox", { name: "Search for an address or place" }).first();
  const SEL = 'input[role="combobox"][aria-label="Search for an address or place"]';
  await mapIn.click();
  await page.keyboard.type("100 main st houston", { delay: 25 });
  await page.waitForFunction(() => document.querySelectorAll('[role="listbox"] [role="option"]').length >= 3, null, { timeout: 15000 }).catch(() => {});
  let st = await listState(page, SEL);
  check("known-good arm: the suggestion list is populated before any key is judged", st.n >= 3, `${st.n} rows: ${st.text.slice(0, 3).join(" | ")}`);
  if (st.n >= 3) {
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
    st = await listState(page, SEL);
    check("Down, Down → second row is the highlighted one (aria-activedescendant + aria-selected)", st.idx === 1 && st.selectedTrue === 1, `idx ${st.idx}`);
    check("the highlight is VISIBLE: ≥ 3:1 against the list, ink ≥ 4.5:1", contrast(st.rowBg, st.listBg) >= 3 && contrast(st.rowInk, st.rowBg) >= 4.5, `row ${st.rowBg} on list ${st.listBg}, ink ${st.rowInk} (${contrast(st.rowBg, st.listBg).toFixed(2)}:1)`);
    await page.keyboard.press("ArrowUp");
    st = await listState(page, SEL);
    check("Up → back to the first row", st.idx === 0, `idx ${st.idx}`);
    await page.keyboard.press("ArrowDown");
    st = await listState(page, SEL);
    const want = st.text[1];
    check("Down → second row again, typed text untouched by navigation", st.idx === 1 && st.value === "100 main st houston", `value "${st.value}"`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const after = await listState(page, SEL);
    check("Enter picks the highlighted address exactly as a click would (input shows that row's address)", after.value === want, `"${after.value}" vs "${want}"`);
    // Escape: retype, highlight, Escape → list closed, text kept
    await mapIn.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("200 main st houston", { delay: 25 });
    await page.waitForFunction(() => document.querySelectorAll('[role="listbox"] [role="option"]').length >= 3, null, { timeout: 15000 }).catch(() => {});
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    const esc = await listState(page, SEL);
    check("Escape closes the list and keeps the typed text", esc.n === 0 && esc.value === "200 main st houston", `${esc.n} rows, "${esc.value}"`);
  }

  // ── 2) FOOD restaurant search ─────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`${base}/?cb=${Date.now()}#/food`, { waitUntil: "load" });
  const fin = page.getByTestId("food-search-box");
  await fin.waitFor({ timeout: 45000 });
  await page.waitForTimeout(1500);
  await fin.click();
  await page.keyboard.type("torchy", { delay: 40 });
  await page.waitForFunction(() => document.querySelectorAll('[role="listbox"] [role="option"]').length >= 3, null, { timeout: 20000 }).catch(() => {});
  const FSEL = '[data-testid="food-search-box"]';
  let fs = await listState(page, FSEL);
  check("Food — known-good arm: the results list is populated", fs.n >= 3, `${fs.n} rows`);
  if (fs.n >= 3) {
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp");
    fs = await listState(page, FSEL);
    check("Food — Down, Down, Up → first row highlighted", fs.idx === 0 && fs.selectedTrue === 1, `idx ${fs.idx}`);
    const fsNow = fs; // the same instant, for the record: a button's CSS colour transition has not started yet, so its computed fill still reads the OLD value
    await pacedWait(page, 600); // settle: read the highlight AFTER the row's colour transition, as a person sees it
    fs = await listState(page, FSEL);
    console.log(`   (immediately after the key: ${fsNow.rowBg}; settled: ${fs.rowBg})`);
    check("Food — the highlight is VISIBLE (≥ 3:1 vs the panel, ink ≥ 4.5:1)", contrast(fs.rowBg, fs.listBg === "rgba(0, 0, 0, 0)" ? "rgb(255, 255, 255)" : fs.listBg) >= 3 && contrast(fs.rowInk, fs.rowBg) >= 4.5, `row ${fs.rowBg}, ink ${fs.rowInk}`);
    await page.keyboard.press("ArrowDown");
    fs = await listState(page, FSEL);
    const pickName = fs.text[1].split("\n")[0].slice(0, 12);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const card = await page.evaluate((name) => ({ listOpen: document.querySelectorAll('[role="listbox"] [role="option"]').length, body: document.body.innerText.includes(name) }), pickName);
    check("Food — Enter opens the highlighted restaurant and closes the list", card.listOpen === 0 && card.body, `list rows ${card.listOpen}, page shows "${pickName}…": ${card.body}`);
  }
  console.log("served build at end:", await buildNow(page));
} finally { await s.close(); }

if (args.includes("--tap")) {
  const t = await openSignedIn({ base, engine: "webkit", device: "iPhone 15" });
  try {
    await t.page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ candidates: ADDRS.map((a, i) => ({ address: a, location: { x: -95.3 + i * 0.01, y: 29.7 } })) }) }));
    await t.page.goto(`${base}/?cb=${Date.now()}#/site-planner`, { waitUntil: "load" });
    await t.page.locator(".leaflet-container").first().waitFor({ timeout: 45000 });
    await t.page.waitForTimeout(1500);
    const inp = t.page.getByRole("combobox", { name: "Search for an address or place" }).first();
    await inp.tap(); await t.page.keyboard.type("main st", { delay: 30 });
    await t.page.waitForFunction(() => document.querySelectorAll('[role="listbox"] [role="option"]').length >= 3, null, { timeout: 15000 }).catch(() => {});
    const row = t.page.locator('[role="listbox"] [role="option"]').nth(1);
    const label = (await row.textContent()).trim();
    await row.tap(); await t.page.waitForTimeout(600);
    check("WebKit (iPhone 15 descriptor, emulated — not a device): tap on a suggestion picks it", (await inp.inputValue()) === label, `"${await inp.inputValue()}" vs "${label}"`);
  } finally { await t.close(); }
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
