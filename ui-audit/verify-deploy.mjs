#!/usr/bin/env node
/* B1119 — "is my change actually SERVED?", answered correctly.
 *
 * WHY THIS EXISTS
 * ---------------
 * The obvious check — fetch the site, note `assets/index-*.js`, grep it for a string you added —
 * is WRONG for this app, and it produced a confident false "never deployed" that cost a whole
 * verification round (2026-07-29: 2.5 hours of chasing a deploy that had in fact shipped on time).
 *
 * Two facts make it wrong:
 *   1. Vite content-hashes EVERY CHUNK SEPARATELY. `assets/index-*.js` keeps the SAME hash across
 *      a deploy whenever its own bytes did not change. A stable index hash is therefore evidence of
 *      NOTHING — not of a stale deploy, not of a missing build.
 *   2. Almost all planner code lives in the LAZY `SitePlannerApp-*.js` chunk, not the entry. A
 *      string added to `lib/elementApi.js` was never going to appear in `index-*.js` at all.
 *
 * So this walks the real module graph — index.html → entry chunk → every hashed chunk the entry
 * names — and reports WHICH chunk carries each marker. It fails loudly when a required marker is
 * absent anywhere, which is the only honest form of "not deployed yet".
 *
 * USAGE
 *   node ui-audit/verify-deploy.mjs p_atomic                       # one marker, default origin
 *   node ui-audit/verify-deploy.mjs --origin=https://x.pages.dev A B
 *   node ui-audit/verify-deploy.mjs --json p_atomic
 * Exit 0 = every marker found live. Exit 1 = at least one is missing (or the site is unreachable).
 *
 * NOTE ON MINIFICATION — choose markers that SURVIVE it. Safe: wire-level object KEYS (`p_atomic`),
 * user-visible copy ("out of date"), and property names on a returned public API object. NOT safe:
 * local function/variable names (`closeAssemblies` is renamed away). A marker that is minified out
 * will read as "not deployed" forever, which is the same false negative in a new costume — so the
 * report says explicitly which markers it could not find AND reminds you of this.
 */
const args = process.argv.slice(2);
const origin = (args.find((a) => a.startsWith("--origin=")) || "--origin=https://planyr.io").slice(9).replace(/\/$/, "");
const asJson = args.includes("--json");
const markers = args.filter((a) => !a.startsWith("--"));
if (!markers.length) {
  console.error("usage: node ui-audit/verify-deploy.mjs [--origin=URL] [--json] <marker> [marker…]");
  process.exit(2);
}

const NO_STORE = { headers: { "Cache-Control": "no-store", Pragma: "no-cache" }, redirect: "follow" };
const get = async (url) => {
  const r = await fetch(url, NO_STORE);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
};

const out = { origin, fetchedAt: new Date().toISOString(), chunks: [], markers: {}, ok: false };
try {
  const html = await get(`${origin}/`);
  // Every hashed asset the document itself names (script src + modulepreload).
  const named = new Set([...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]));
  if (!named.size) throw new Error("no assets/*.js referenced by index.html — is this the app?");

  // Follow one level out: the entry chunk names its lazy children as literal paths.
  const seen = new Map(); // path -> body
  const queue = [...named];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    const body = await get(`${origin}/${path}`);
    seen.set(path, body);
    for (const m of body.matchAll(/["'`](?:\.\/|\/)?(assets\/[A-Za-z0-9_.-]+\.js)["'`]/g)) {
      if (!seen.has(m[1]) && !queue.includes(m[1])) queue.push(m[1]);
    }
  }

  for (const [path, body] of seen) out.chunks.push({ path, bytes: body.length, entry: named.has(path) });
  for (const marker of markers) {
    const found = [...seen.entries()].filter(([, body]) => body.includes(marker)).map(([p]) => p);
    out.markers[marker] = { found: found.length > 0, chunks: found };
  }
  out.ok = markers.every((m) => out.markers[m].found);
} catch (e) {
  out.error = (e && e.message) || String(e);
}

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else if (out.error) {
  console.log(`✗ ${origin} — ${out.error}`);
} else {
  console.log(`${origin}  ·  ${out.chunks.length} chunk(s) walked  ·  ${out.fetchedAt}`);
  for (const c of out.chunks.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`   ${c.entry ? "entry" : "lazy "}  ${String(c.bytes).padStart(9)} B  ${c.path}`);
  }
  console.log("");
  for (const m of markers) {
    const r = out.markers[m];
    console.log(r.found
      ? `   ✓ "${m}" IS SERVED — in ${r.chunks.join(", ")}`
      : `   ✗ "${m}" NOT FOUND in any served chunk`);
  }
  if (!out.ok) {
    console.log("\n   Before concluding \"not deployed\": is the marker MINIFY-SAFE? A local function or");
    console.log("   variable name is renamed by the build and can never be found here. Use a wire-level");
    console.log("   object key, user-visible copy, or a public API property name instead.");
  }
  console.log(out.ok ? "\n✓ every marker is live" : "\n✗ at least one marker is not live");
}
process.exit(out.ok ? 0 : 1);
