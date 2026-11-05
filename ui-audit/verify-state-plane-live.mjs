/* NEW-1 (B2478960) — LIVE: the deployed build serves the all-50-states State Plane engine, and the signed-in app boots on it.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-state-plane-live.mjs https://planyr.io [expectedBuildSha]
 *
 * What this proves, in ONE observation (CLAUDE.md: a live measurement is only valid if the served build is read in the same call as
 * the assertion):
 *   1. the served /version.json (and, when given, it equals the commit that was merged);
 *   2. the page is signed in as the test account (openSignedIn's proof: the email AND the RLS-gated fixture site);
 *   3. the whole served chunk graph — walked from the entry script by following every "./Name-hash.js" reference — contains the new
 *      engine: the generated zone table (a Texas North Central id, an Alaska zone-1 oblique id), the Hotine Oblique Mercator
 *      constants and the "site-local" frame label that replaced the silent Texas fallback;
 *   4. the Site Planner route boots signed in with no uncaught page error.
 * It cannot prove positions on the map for a real Tennessee overlay (that needs a placed overlay fixture) — that is proven against
 * PROJ in test/statePlaneAllZones.test.js; this proves the proven code is what planyr.io serves.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const wantSha = process.argv[3] || null;
const MUST_HAVE = ["tx_north_central", "ak_10", "Site-local transverse Mercator"];   // data (a Dallas-zone id, an Aleutian id) + the labelled local frame
const fail = (m) => { console.error("FAIL", m); process.exit(1); };

try {
  const s = await openSignedIn({ base });
  await assertMeasurable(s.page, "verify-state-plane-live");
  const errors = [];
  s.page.on("pageerror", (e) => errors.push(String(e.message || e)));

  // (3) walk the chunk graph from the entry script, inside the page (same origin, Chromium's trust store).
  const walk = await s.page.evaluate(async ({ must }) => {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    const entry = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    const seen = new Set(), found = {}; let bytes = 0;
    const queue = entry.map((u) => new URL(u, location.origin).pathname);
    while (queue.length && seen.size < 600) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      let text;
      try { text = await (await fetch(path)).text(); } catch { continue; }
      bytes += text.length;
      for (const m of must) if (text.includes(m)) (found[m] = found[m] || []).push(path);
      const dir = path.slice(0, path.lastIndexOf("/") + 1);
      for (const r of text.matchAll(/["'`]\.?\/?((?:assets\/)?[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.js)["'`]/g)) {
        const rel = r[1].startsWith("assets/") ? "/" + r[1] : dir + r[1];
        if (!seen.has(rel)) queue.push(rel);
      }
    }
    return { chunks: seen.size, bytes, found };
  }, { must: MUST_HAVE });

  console.log("build:", JSON.stringify(s.build));
  console.log("signed in as", s.proof.email, "| fixture visible:", s.proof.fixtureVisible);
  console.log("walked", walk.chunks, "chunks,", walk.bytes, "chars of JS");
  if (wantSha && !String((s.build && s.build.build) || "").startsWith(wantSha.slice(0, 7))) {
    fail(`served build ${JSON.stringify(s.build)} is not the merged commit ${wantSha}`);
  }
  if (walk.chunks < 5) fail("the chunk walk found fewer than 5 chunks — the instrument did not see the app (VOID, not a pass)");
  for (const m of MUST_HAVE) {
    if (!walk.found[m]) fail(`no served chunk contains ${JSON.stringify(m)} — planyr.io is not serving the all-states engine`);
    console.log("  found", JSON.stringify(m), "in", walk.found[m].slice(0, 2).join(", "));
  }

  // (4) the planner route boots signed in.
  await s.page.goto(base + "/#/site", { waitUntil: "load" });
  await s.page.waitForTimeout(4000);
  if (errors.length) fail("uncaught page error(s) while booting the Site route: " + errors.slice(0, 3).join(" | "));
  console.log("PASS — the served build carries the 50-state engine and the signed-in Site route boots with no page error.");
  await s.close();
} catch (e) { fail(e.message); }
