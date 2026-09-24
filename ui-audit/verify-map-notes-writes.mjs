/* Map notes — the WRITE legs, real app code against a STUBBED server (NEW-1, scratch harness).
 *
 * ⛔ WHAT THIS IS AND IS NOT. The owner's requested legs (place · reopen and edit · toggle · soft
 * delete) need a signed-in session, and this sandbox CORS-blocks the Supabase auth handshake. So the
 * SERVER is faked here — every request the app makes to PostgREST is intercepted and answered — and
 * NOTHING ELSE IS: the component tree, the marker layer, the editor, the store and the request
 * bodies are the shipped code. It proves the client half end to end; it does NOT prove RLS, the real
 * schema, or that a row survives a reload on the owner's account. Those stay Blocker: auth in
 * VERIFICATION.md, and this harness does not count them as passed.
 */
import { chromium } from "playwright";
// Two lines rather than one destructure: `test/tabTiming.test.js` requires the precondition's
// import to be present VERBATIM in every browser-driving harness, so it cannot be hidden behind a
// combined import a future edit might quietly drop.
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

const UID = "00000000-0000-4000-8000-000000000001";
let rows = [{
  id: "note-a", user_id: UID, team_id: null, project_id: null,
  title: "Throwaway A", body: "Old fence sits inside the north line.",
  anchor_kind: "pin", lat: 29.76, lon: -95.37, county: "harris",
  parcel_apn: null, parcel_geom: null,
  created_at: "2026-09-08T10:00:00Z", updated_at: "2026-09-08T10:00:00Z",
}, {
  id: "note-b", user_id: UID, team_id: null, project_id: null,
  title: "Throwaway B (parcel)", body: "Quoted six a foot, nothing transacted.",
  anchor_kind: "parcel", lat: 29.86, lon: -95.62, county: "harris",   // deliberately far from note-a: overlapping markers made a click land on whichever painted last
  parcel_apn: "1234567", parcel_geom: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  created_at: "2026-09-08T10:00:00Z", updated_at: "2026-09-08T10:00:00Z",
}];
const seen = [];   // every write request the app actually put on the wire
let subject = null; // which seeded note the marker we clicked turned out to be

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 465 }, deviceScaleFactor: 1 });

await ctx.route("**/stubproj.supabase.co/**", async (route) => {
  const req = route.request();
  const url = req.url();
  const method = req.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.includes("/auth/v1/user")) return json({ id: UID, aud: "authenticated", email: "owner@example.com" });
  if (url.includes("/auth/v1/token")) return json({ access_token: "stub", token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { id: UID } });
  if (url.includes("/rest/v1/map_notes")) {
    let body = null; try { body = req.postDataJSON(); } catch (_) {}
    if (method === "GET") return json(rows.filter((r) => !r.deleted_at));
    // ⛔ HARNESS FIX (round 1): `.single()` / `.maybeSingle()` send
    // `Accept: application/vnd.pgrst.object+json` and PostgREST then answers with a bare OBJECT.
    // Answering with an array made supabase-js hand the store an array, the store prepended it as
    // one "note" with no anchor, and the marker layer correctly skipped it — a stub artifact that
    // read exactly like "saving a new note does not put it on the map".
    const single = (req.headers()["accept"] || "").includes("pgrst.object");
    const shape = (r) => (single ? r : [r]);
    if (method === "POST") { const r = { ...rows[0], ...body, id: `new-${seen.length}` }; rows = [...rows, r]; seen.push({ method, url, body }); return json(shape(r), 201); }
    if (method === "PATCH") {
      seen.push({ method, url, body });
      const m = url.match(/id=eq\.([^&]+)/);
      const id = m ? decodeURIComponent(m[1]) : null;
      rows = rows.map((r) => (r.id === id ? { ...r, ...body } : r));
      return json(shape(rows.find((r) => r.id === id)));
    }
    if (method === "DELETE") { seen.push({ method, url, body }); return json([]); }
  }
  return json([]);
});

const page = await ctx.newPage();
await ctx.addInitScript(({ uid }) => {
  try {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem("sb-stubproj-auth-token", JSON.stringify({
      access_token: "stub", token_type: "bearer", expires_at: exp, expires_in: 3600, refresh_token: "r",
      user: { id: uid, aud: "authenticated", role: "authenticated", email: "owner@example.com" },
    }));
  } catch (e) {}
}, { uid: UID });
await assertMeasurable(page, "verify-map-notes-writes");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await pacedWait(page, 2500);

const markerCount = () => page.evaluate(() => document.querySelectorAll(".map-note-feature").length);

// ── A · MARKERS RENDER, AND ARE THEIR OWN SILHOUETTE ─────────────────────────────────────────
{
  const n = await markerCount();
  ok("A · both seeded notes render as markers", n === 2, `${n} markers`);
  const shape = await page.evaluate(() => {
    const m = document.querySelector(".map-note-feature");
    const comp = document.querySelector(".map-comp-feature");
    return { note: m ? m.innerHTML : "", isBubble: !!m && /<path d="M /.test(m.innerHTML) && !/rotate\(45/.test(m.innerHTML), comps: !!comp };
  });
  ok("A · a note marker is a bubble, never the comp's rotated tag", shape.isBubble);
  const count = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Imagery & layers/i.test(b.textContent || ""));
    if (btn && !document.querySelector('[data-testid="map-show-notes"]')) btn.click();
    return null;
  });
  await pacedWait(page, 400);
  const label = await page.evaluate(() => document.querySelector('[data-testid="map-show-notes"]').closest("label").textContent.trim());
  ok("A · the layer toggle shows the live count", label === "Notes (2)", label);
}

// ── B · THE LAYER TOGGLE REALLY HIDES AND SHOWS THEM ─────────────────────────────────────────
{
  await page.click('[data-testid="map-show-notes"]');
  await pacedWait(page, 500);
  ok("B · unticking Notes removes every note marker from the map", (await markerCount()) === 0);
  const sitesStill = await page.evaluate(() => document.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon").length);
  await page.click('[data-testid="map-show-notes"]');
  await pacedWait(page, 500);
  ok("B · re-ticking brings them back", (await markerCount()) === 2);
}

// ── C · CLICK A MARKER → READ IT → EDIT IT → SAVE ────────────────────────────────────────────
{
  const box = await page.evaluate(() => {
    const m = [...document.querySelectorAll(".map-note-feature")][0];
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await pacedWait(page, 600);
  const opened = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="map-note-editor"]');
    if (!el) return null;
    return {
      title: document.querySelector('[data-testid="map-note-title"]').value,
      body: document.querySelector('[data-testid="map-note-body"]').value,
      hasDelete: !!document.querySelector('[data-testid="map-note-delete"]'),
    };
  });
  ok("C · clicking a note marker opens it", !!opened);
  // ⛔ HARNESS FIX (round 1): marker DOM order is not the seed order, so "marker[0] is note-a" was
  // the harness's own assumption, not a fact about the app. Identify the subject from what the
  // editor actually shows and drive THAT note — the assertion is that a marker opens ITS OWN note,
  // which is the property under test either way.
  subject = rows.find((r) => opened && r.body === opened.body && r.title === opened.title) || null;
  ok("C · it reads back that marker's own note, title and body together", !!subject,
     opened ? `${opened.title} / ${opened.body.slice(0, 24)}` : "");
  ok("C · a SAVED note offers Delete (a new one does not)", !!opened && opened.hasDelete);

  await page.click('[data-testid="map-note-body"]');
  await page.keyboard.press("End");
  await page.keyboard.type(" Re-shot 8 Sep.");
  await page.click('[data-testid="map-note-save"]');
  await pacedWait(page, 800);
  const patch = seen.filter((s) => s.method === "PATCH").pop();
  ok("C · saving issues an UPDATE carrying the edited text", !!patch && String(patch.body?.body || "").includes("Re-shot 8 Sep"),
     patch ? String(patch.body?.body).slice(-24) : "no PATCH seen");
  ok("C · the update is scoped to that one note's id", !!patch && !!subject && patch.url.includes(`id=eq.${subject.id}`), patch ? patch.url.split("?")[1] : "");
  ok("C · the editor closes on a successful save", (await page.evaluate(() => !document.querySelector('[data-testid="map-note-editor"]'))) === true);
}

// ── D · REOPEN SHOWS THE EDIT (the list really updated, not just the screen) ──────────────────
{
  // Re-open by the note's OWN tooltip text, so this cannot silently open the other note.
  // ⛔ HARNESS FIX (round 2): a Leaflet tooltip is NOT a `title` attribute, so the previous lookup
  // silently fell back to marker[0] and reopened the OTHER note while reporting the edit missing.
  // The marker now carries its own id, so the subject is addressed rather than guessed.
  const target = await page.evaluate((id) => {
    const el = document.querySelector(`[data-note-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, subject ? subject.id : "");
  ok("D · the edited note's own marker is addressable by id", !!target);
  const resolvesTo = target ? await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-note-id]")?.getAttribute("data-note-id") || null, target) : null;
  ok("D · that point really answers to that marker (nothing overlaps it)", resolvesTo === (subject && subject.id), `elementFromPoint → ${resolvesTo}`);
  await page.mouse.click(target.x, target.y);
  await pacedWait(page, 600);
  const body = await page.evaluate(() => document.querySelector('[data-testid="map-note-body"]')?.value || "");
  ok("D · reopening the note shows the edit", body.includes("Re-shot 8 Sep"), body.slice(-24));
}

// ── E · SOFT DELETE, ON A SECOND CLICK, AND IT IS A PATCH — NEVER A DELETE ───────────────────
// B1372144-HARDENING-1 — the confirm step REPLACES the action row (Delete/Cancel/Save) with a
// dedicated Confirm/Keep-it row, rather than relabeling the Delete button in place. The relabel
// version grew "Delete" into "Delete — sure?" inside the SAME fixed-width row as Cancel/Save,
// shrinking the flex spacer between them — a second click aimed at the (now wider) button could
// land on the shifted Cancel/Save instead, closing the editor with ZERO network traffic and no
// error, which reads exactly like "I clicked Delete and it just worked." This block asserts the
// row is genuinely swapped (the old Delete button is gone, not just relabeled) and — closing a
// real gap in the old assertion here — that the PATCH is scoped to THIS note's own id, not just
// "some PATCH with deleted_at happened to go out."
{
  const before = seen.length;
  await page.click('[data-testid="map-note-delete"]');
  await pacedWait(page, 300);
  const armed = await page.evaluate(() => ({
    oldButtonGone: !document.querySelector('[data-testid="map-note-delete"]'),
    confirmButtonPresent: !!document.querySelector('[data-testid="map-note-delete-confirm"]'),
  }));
  ok("E · the first Delete click swaps the row for a Confirm/Keep-it pair (no dialog box, inline)",
     armed.oldButtonGone && armed.confirmButtonPresent && seen.length === before,
     JSON.stringify(armed));
  await page.click('[data-testid="map-note-delete-confirm"]');
  await pacedWait(page, 800);
  const del = seen.filter((s) => s.method !== "GET").pop();
  ok("E · deleting stamps deleted_at — it is never a hard DELETE", !!del && del.method === "PATCH" && !!del.body?.deleted_at,
     del ? `${del.method} ${JSON.stringify(del.body).slice(0, 40)}` : "nothing sent");
  ok("E · the delete is scoped to THIS note's own id", !!del && !!subject && del.url.includes(`id=eq.${subject.id}`),
     del ? del.url.split("?")[1] : "");
  ok("E · no hard DELETE request was ever issued", seen.every((s) => s.method !== "DELETE"));
  ok("E · the marker leaves the map", (await markerCount()) === 1);
  ok("E · the count follows", (await page.evaluate(() => document.querySelector('[data-testid="map-show-notes"]').closest("label").textContent.trim())) === "Notes (1)");
}

// ── F · PLACE A NEW NOTE BY PIN, AND SAVE IT ─────────────────────────────────────────────────
{
  const mapBox = await page.evaluate(() => { const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.click('[data-testid="map-toolbar-drop-pin"]');
  await pacedWait(page, 300);
  await page.mouse.click(mapBox.x + mapBox.w * 0.35, mapBox.y + mapBox.h * 0.6);
  await pacedWait(page, 600);
  // B1892544 (2026-09-24) — "Add a note" moved off the bar into "Record info ▾".
  await page.click('[data-testid="map-decide-record-info"]');
  await pacedWait(page, 300);
  await page.click('[data-testid="map-decide-verb-note"]');
  await pacedWait(page, 600);
  await page.click('[data-testid="map-note-body"]');
  await page.keyboard.type("Throwaway C — placed by pin.");
  await page.click('[data-testid="map-note-save"]');
  await pacedWait(page, 900);
  const post = seen.filter((s) => s.method === "POST").pop();
  ok("F · placing by pin issues an INSERT with a pin anchor and real coordinates",
     !!post && post.body?.anchor_kind === "pin" && typeof post.body?.lat === "number",
     post ? `lat ${post.body.lat?.toFixed(4)}` : "no POST seen");
  ok("F · the insert carries the typed text and NO project_id (a note never creates a site)",
     !!post && post.body.body.includes("Throwaway C") && post.body.project_id === null);
  const after = await markerCount();
  const dump = await page.evaluate(() => ({
    err: document.querySelector('[data-testid="map-note-error"]')?.textContent || null,
    editorOpen: !!document.querySelector('[data-testid="map-note-editor"]'),
    label: document.querySelector('[data-testid="map-show-notes"]')?.closest("label")?.textContent?.trim(),
  }));
  ok("F · the new note appears on the map immediately", after === 2, `${after} markers · ${JSON.stringify(dump)}`);
  // ⛔ REGRESSION ARM, and it is the reason this harness exists rather than a note in a PR. The
  // marker above must be on the map ALREADY — before any further interaction. It was not: a press
  // that ended outside the map container (a menu or a card mounting under the cursor) latched
  // MapFinder's "don't rebuild mid-press" flag, so every deferred layer rebuild — sites and comps
  // too, not just notes — waited for the next map click. A subsequent click must therefore change
  // NOTHING here; if it does, the latch is back.
  const mb = await page.evaluate(() => { const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.3 }; });
  await page.mouse.click(mb.x, mb.y);
  await pacedWait(page, 700);
  ok("F · and a later map click changes nothing — the paint was not merely DEFERRED", (await markerCount()) === after);
}

// ── G · THE ADJACENT CASE: A PARCEL-ANCHORED NOTE DELETES THE SAME WAY A PIN-ANCHORED ONE DOES ──
// The reported defect was on a parcel anchor specifically ("select a parcel, decide bar -> Add a
// note"); section E above proved the fix on note-a, a PIN anchor. `deleteMapNote`/`confirmRemove`
// never read `anchor_kind`, so there is no reason to expect a difference — but that is exactly the
// kind of assumption this repo's own WRONG-CASE rule says to verify rather than take on faith.
{
  const target = await page.evaluate(() => {
    const el = document.querySelector('[data-note-id="note-b"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  ok("G · the parcel-anchored note's own marker is addressable by id", !!target);
  await page.mouse.click(target.x, target.y);
  await pacedWait(page, 600);
  const opened = await page.evaluate(() => ({
    editorOpen: !!document.querySelector('[data-testid="map-note-editor"]'),
    anchorText: document.querySelector('[data-testid="map-note-editor"]')?.textContent || "",
  }));
  ok("G · it reopens as the parcel anchor it was seeded as", opened.editorOpen && /On a parcel/.test(opened.anchorText), JSON.stringify({ editorOpen: opened.editorOpen }));
  const before = seen.length;
  await page.click('[data-testid="map-note-delete"]');
  await pacedWait(page, 300);
  const armed = await page.evaluate(() => ({
    oldButtonGone: !document.querySelector('[data-testid="map-note-delete"]'),
    confirmButtonPresent: !!document.querySelector('[data-testid="map-note-delete-confirm"]'),
  }));
  ok("G · the same Confirm/Keep-it swap arms for a parcel anchor", armed.oldButtonGone && armed.confirmButtonPresent && seen.length === before);
  await page.click('[data-testid="map-note-delete-confirm"]');
  await pacedWait(page, 800);
  const del = seen.filter((s) => s.method !== "GET").pop();
  ok("G · deleting a parcel-anchored note stamps deleted_at, scoped to note-b",
     !!del && del.method === "PATCH" && !!del.body?.deleted_at && del.url.includes("id=eq.note-b"),
     del ? `${del.method} ${del.url.split("?")[1]}` : "nothing sent");
  ok("G · the marker leaves the map", (await markerCount()) === 1);
}

ok("· no page errors during the run", errs.length === 0, errs[0] || "");
const pass = results.filter((r) => r.pass).length;
console.log(`\n  ${pass}/${results.length} write-path checks passed (server stubbed, app code real)`);
await ctx.close(); await browser.close();
process.exit(pass === results.length ? 0 : 1);
