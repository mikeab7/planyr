/* verify-spreadsheet-sync-base — B2450528 / V1894032: the Spreadsheet's false "different copy saved in the cloud" bar.
 * SIGNED IN as the throwaway test account on a THROWAWAY project (never a real one); clears everything it makes and re-asks
 * the database.
 *
 *  A  type cells in non-jsonb order, wait for the cloud row                         B  KNOWN-GOOD ARM: the cloud's key order really differs from the device's
 *  C  cache-busted reload → NO bar, the values show, and the reload bumped nothing   D  edit → the cloud version advances
 *  E  stale-but-CLEAN device copy + newer cloud → the cloud copy shows, no bar        F  both sides dirty since the base → the bar DOES appear, nothing is pushed
 * The run is VOID (not scored) if step B's arm does not show the key-order difference — without it a pass proves nothing.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-sync-base.mjs [base] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const PROJECT = `${LIVE_PREFIX}sheetsync-${Date.now().toString(36)}`;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = await openSignedIn({ base: BASE });
const { page } = s;
try {
  await assertMeasurable(page, "verify-spreadsheet-sync-base");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  const uid = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  const lsKey = `planyr:model:sheet:v1:${uid}:${PROJECT}`, metaKey = `planyr:model:sheet:meta:v1:${uid}:${PROJECT}`;
  const url = () => `${BASE}/?cb=${Date.now()}#/project/${PROJECT}/spreadsheet`;
  const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
  const cloudRow = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("model_sheets").select("data, version").eq("id", id).maybeSingle(); return q.data || null; }, PROJECT);
  const waitCloud = async (pred, ms = 25000) => { const t0 = Date.now(); for (;;) { const r = await cloudRow(); if (r && pred(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(500); } };
  const open = async () => { await page.goto(url(), { waitUntil: "load" }); await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 60000 }); await page.waitForTimeout(4000); };
  const bar = () => page.locator('[data-testid="model-diverged-bar"]').count();
  const type = async (r, c, text) => { await cell(r, c).click(); await page.keyboard.type(text); await page.keyboard.press("Enter"); };
  const cellText = async (r, c) => (await cell(r, c).first().innerText()).trim();

  // A — typed in an order whose jsonb order differs (c4:10 typed before c4:2; the longer key before the shorter)
  await open();
  await type(10, 3, "zz Costs"); await type(2, 3, "zz Additional"); await type(0, 0, "zz Land");
  const r1 = await waitCloud((r) => r.data?.sheets?.[0]?.sheet?.cells?.["c1:0"] === "zz Land");
  ok("A  the edits reached the cloud", !!r1 && r1.data.sheets[0].sheet.cells["c1:0"] === "zz Land", `version ${r1?.version}`);
  if (!r1) throw new Error("nothing reached the cloud — cannot continue");

  // B — known-good arm
  const local = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), lsKey);
  const lk = Object.keys(local.sheets[0].sheet.cells).join(","), ck = Object.keys(r1.data.sheets[0].sheet.cells).join(",");
  console.log(`device key order: ${lk}\ncloud  key order: ${ck}`);
  const armLive = lk !== ck;
  ok("B  KNOWN-GOOD ARM: the cloud re-ordered the cell keys (the condition that raised the false bar)", armLive);
  if (!armLive) { console.log("VOID — the fixture did not produce a key-order difference, so a pass below would prove nothing."); failures++; }

  // C — reload: no bar, values present, nothing bumped
  const v1 = r1.version;
  await open();
  ok("C  reload → no 'different copy' bar", (await bar()) === 0);
  ok("C  reload → the values are there", (await cellText(0, 0)) === "zz Land" && (await cellText(2, 3)) === "zz Additional");
  ok("C  an untouched reload did not bump the cloud version", (await cloudRow()).version === v1, `${v1} → ${(await cloudRow()).version}`);

  // D — the next edit uploads
  await type(2, 3, "zz Additional 2");
  const r2 = await waitCloud((r) => r.version > v1);
  ok("D  the next edit uploaded (version advanced)", !!r2 && r2.version > v1 && r2.data.sheets[0].sheet.cells["c4:2"] === "zz Additional 2", `${v1} → ${r2?.version}`);

  // E — stale but CLEAN device copy + newer cloud
  const vE = (await cloudRow()).version;
  await page.evaluate(([k, mk, v]) => { const w = JSON.parse(localStorage.getItem(k)); w.sheets[0].sheet.cells["c1:0"] = "stale device"; localStorage.setItem(k, JSON.stringify(w)); localStorage.setItem(mk, JSON.stringify({ baseVersion: v - 1, dirty: false })); }, [lsKey, metaKey, vE]);
  await open();
  ok("E  stale-but-clean device copy → no bar", (await bar()) === 0);
  ok("E  …and the CLOUD copy is what shows", (await cellText(0, 0)) === "zz Land", await cellText(0, 0));
  ok("E  …and nothing was pushed", (await cloudRow()).version === vE);

  // F — both sides dirty since the base: the one case that should still ask
  await page.evaluate(([k, mk, v]) => { const w = JSON.parse(localStorage.getItem(k)); w.sheets[0].sheet.cells["c1:0"] = "dirty device"; localStorage.setItem(k, JSON.stringify(w)); localStorage.setItem(mk, JSON.stringify({ baseVersion: v - 1, dirty: true })); }, [lsKey, metaKey, vE]);
  await open();
  ok("F  edited here AND in the cloud since the base → the bar appears", (await bar()) === 1);
  ok("F  …and nothing was pushed over the cloud while it is up", (await cloudRow()).version === vE);
  await page.getByTestId("model-diverged-use-cloud").click();
  await page.waitForTimeout(1500);
  ok("F  'Use the cloud copy' clears the bar and shows the cloud value", (await bar()) === 0 && (await cellText(0, 0)) === "zz Land");
} catch (e) {
  console.log("FAIL — harness error: " + (e && e.stack || e)); failures++;
} finally {
  // owner rule 15: clear what this made, then re-ask
  const out = await page.evaluate(async (id) => {
    const c = window.pfSupabase; await c.from("model_sheets").delete().eq("id", id);
    return (await c.from("model_sheets").select("id").eq("id", id)).data?.length ?? "?";
  }, PROJECT).catch((e) => "err " + e);
  const gone = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)] }));
  console.log(`cleanup: model_sheets rows left ${out}; ${JSON.stringify(gone)}`);
  if (out !== 0 || (gone.left && gone.left.site !== 0)) failures++;
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
