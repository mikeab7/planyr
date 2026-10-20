/* verify-planner-cursors-live — the Site Planner cursor convention (owner-approved 2026-10-20) on a REAL deploy, signed in as the throwaway
 * test account. Reads `getComputedStyle(document.elementFromPoint(x, y)).cursor` at named points — the browser's own answer for the pointer
 * — and reads /version.json IN THE SAME CALL as each reading (a stale cached bundle makes a reading meaningless).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-planner-cursors-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Seeds a throwaway plan (three buildings, one rotated; a locked callout) on the test account, deletes it at the end and VERIFIES it is
 * gone (owner constraint 15: test artifacts are always cleared). The standing fixtures are never touched.
 * Known-good arms (a reading from an instrument that could not see the effect is not evidence): a toolbar button must read `pointer`;
 * the rotated building's corners must match values worked out by hand. FOREGROUND-OR-VOID: asserted before anything is measured. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-cursors-" + Math.random().toString(36).slice(2, 8);
const bld = (id, o) => ({ z: 1, id, type: "building", rot: 0, ...o });
const SITE = {
  id: ID, groupId: ID, site: "zz Cursor check", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [], els: [bld("cuWide", { cx: 0, cy: 0, w: 600, h: 140 }), bld("cuLocked", { cx: 0, cy: 380, w: 420, h: 120, locked: true }), bld("cuRot", { cx: 0, cy: -380, w: 500, h: 130, rot: 30 })],
  measures: [], markups: [], callouts: [{ id: "cuCo", text: "Locked note", box: { x: -150, y: 200 }, tip: { x: -150, y: 90 }, z: 1, locked: true }],
  settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const cursorAt = (x, y) => page.evaluate(async ([px, py]) => {
  const n = document.elementFromPoint(px, py);
  const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null);
  return { cursor: n ? getComputedStyle(n).cursor : null, build };
}, [x, y]);
const centre = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const bodyPoint = async (id) => { const r = await page.locator(`[data-el-id="${id}"]`).first().boundingBox(); return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.68 }; };
const grips = (kind) => page.evaluate((k) => [...document.querySelectorAll(`[data-handle="${k}"]`)].map((n) => getComputedStyle(n).cursor), kind);
const containerCursor = () => page.locator(".leaflet-container").first().evaluate((n) => getComputedStyle(n).cursor);
let served = null;
const note = (r) => { served = r.build; return r.cursor; };

try {
  await assertMeasurable(page, "verify-planner-cursors-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");

  // ── Map view ──────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  await page.locator(".leaflet-container").first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1500);
  const btn = await page.getByRole("button", { name: "Drop a pin" }).first().boundingBox();
  check("known-good arm: a toolbar button reads pointer", note(await cursorAt(btn.x + btn.width / 2, btn.y + btn.height / 2)) === "pointer");
  check("MAP idle: the open hand", (await containerCursor()) === "grab");
  await page.getByRole("button", { name: "Drop a pin" }).first().click(); await page.waitForTimeout(300);
  check("MAP Drop a pin: crosshair", (await containerCursor()) === "crosshair");
  const mb = await page.locator(".leaflet-container").first().boundingBox();
  const mx = mb.x + mb.width * 0.5, my = mb.y + mb.height * 0.7;
  await page.mouse.move(mx, my); await page.mouse.down(); await page.mouse.move(mx + 90, my - 40, { steps: 8 });
  check("MAP pan while armed: grabbing during", (await containerCursor()) === "grabbing");
  await page.mouse.up(); await page.waitForTimeout(300);
  check("MAP after the pan the pin mode owns the cursor again (not the open hand)", (await containerCursor()) === "crosshair");
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  // ── Planner canvas ────────────────────────────────────────────────────────────────────────────────
  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-el-id]").length >= 3, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.mouse.click(5, 5); await page.keyboard.press("Escape");
  const cb = await page.getByTestId("planner-canvas").boundingBox();
  const far = { x: cb.x + 14, y: cb.y + cb.height - 40 };

  check("idle empty canvas: grab", note(await cursorAt(far.x, far.y)) === "grab");
  const w = await bodyPoint("cuWide"), l = await bodyPoint("cuLocked"), c = await centre('[data-testid="callout-box-cuCo"]');
  check("hover an unlocked building: move", note(await cursorAt(w.x, w.y)) === "move");
  check("hover a LOCKED building: pointer", note(await cursorAt(l.x, l.y)) === "pointer");
  check("hover a locked callout: pointer", note(await cursorAt(c.x, c.y)) === "pointer");

  await page.mouse.click(w.x, w.y); await page.waitForTimeout(300);
  const corners = await grips("corner");
  check("wide building corners are the diagonals (never ew/ns)", JSON.stringify(corners) === JSON.stringify(["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]), corners.join(","));
  const rot = await grips("rotate");
  check("rotate grip is the rotate cursor (not grab)", rot.length === 1 && /^url\(/.test(rot[0]), String(rot[0]).slice(0, 24));
  const rc = await centre('[data-el-id="cuRot"]'); await page.mouse.click(rc.x, rc.y); await page.waitForTimeout(300);
  const rcorners = await grips("corner");
  check("ROTATED 30° building corners follow it (hand-worked ns,ew,ns,ew)", JSON.stringify(rcorners) === JSON.stringify(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]), rcorners.join(","));

  // mid-drag: pointer far from the grip
  await page.mouse.click(w.x, w.y); await page.waitForTimeout(300);
  const g = await centre('[data-handle="corner"] >> nth=2');
  await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 140, g.y + 90, { steps: 8 }); await page.waitForTimeout(120);
  check("MID-DRAG resize: the arrow stays with the pointer far from the grip", note(await cursorAt(far.x, far.y)) === "nwse-resize");
  await page.mouse.up(); await page.waitForTimeout(200);
  check("after release the pin is gone (open hand)", note(await cursorAt(far.x, far.y)) === "grab");
  await page.keyboard.press("Escape");
  await page.mouse.move(far.x, far.y); await page.mouse.down(); await page.mouse.move(far.x + 60, far.y - 30, { steps: 6 }); await page.waitForTimeout(120);
  check("MID-DRAG pan: grabbing", note(await cursorAt(far.x + 60, far.y - 30)) === "grabbing");
  await page.mouse.up(); await page.waitForTimeout(200);

  // armed tool owns everything
  await page.getByTestId("tool-marquee").click(); await page.waitForTimeout(250);
  const w2 = await bodyPoint("cuWide"), l2 = await bodyPoint("cuLocked"), c2 = await centre('[data-testid="callout-box-cuCo"]');
  check("precondition: the callout is on the canvas, not under the tool rail", await page.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); return !!(n && n.closest("svg[data-cursor-mode]")); }, [c2.x, c2.y]));
  for (const [what, p] of [["a building", w2], ["a locked building", l2], ["a locked callout", c2], ["empty canvas", far]]) check(`ARMED tool: crosshair over ${what}`, note(await cursorAt(p.x, p.y)) === "crosshair");
  await page.getByTestId("tool-select").click().catch(() => {}); await page.keyboard.press("Escape");

  // disabled
  const undo = page.locator('button[aria-label="Undo"]').first();
  const dis = await undo.evaluate((n) => ({ d: n.disabled, c: getComputedStyle(n).cursor }));
  if (dis.d) check("disabled Undo is the default arrow (never pointer)", dis.c === "default", JSON.stringify(dis));
  else console.log("⚠ the disabled-control arm is VACUOUS in this state (Undo is enabled) — not scored; the e2e spec covers it on a fresh plan");
  const bad = await page.evaluate(() => [...document.querySelectorAll("*")].filter((n) => getComputedStyle(n).cursor === "not-allowed").length);
  check("nothing on screen shows not-allowed", bad === 0, String(bad));

  if (expectSha) check("the deploy is serving the merge commit", String(served || "").startsWith(expectSha.slice(0, 7)), `served ${served}`);
  console.log("served build at the readings:", served);
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
