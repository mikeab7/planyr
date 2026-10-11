/* verify-food-typo-search (NEW-1, 2026-10-10) — read-only check against the REAL production
 * `food_places_search_by_name` RPC, fed through the real client ranker (lib/searchProximity.js).
 * Prints the position of the nearest correct place for misspelled queries from a Katy / Cinco Ranch
 * centre, plus no-typo controls. Exit 1 if any REQUIRED case is not #1.
 *   FOOD_ANON_KEY=<anon key> node ui-audit/verify-food-typo-search.mjs [--ranker path] [--rpc food_places_search_by_name_raw] */
import { pathToFileURL } from "node:url";
const URL_ = process.env.FOOD_URL || "https://lyeqzkuiwngunutlkkmi.supabase.co";
const KEY = process.env.FOOD_ANON_KEY;
if (!KEY) { console.error("set FOOD_ANON_KEY (the public anon key)"); process.exit(2); }
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const rankerPath = arg("--ranker", "../src/workspaces/food/lib/searchProximity.js");
const rpc = arg("--rpc", "food_places_search_by_name");
const { rankByProximity } = await import(rankerPath.startsWith("/") ? pathToFileURL(rankerPath).href : rankerPath);

const CENTER = { lat: 29.74, lon: -95.77 };
const BOUNDS = { south: 29.70, north: 29.78, west: -95.83, east: -95.71 }; // Cinco Ranch viewport
const FRY = "a285ad1f-3e6e-4f85-99c4-7bb92b7a66db";
const SHOWN = 10;
// [query, test: nameRegex of a correct place (must be nearest one), required #1?]
const CASES = [
  ["Carabas", /carrabba/i, true], ["Carrabas", /carrabba/i, true], ["Carrabbas", /carrabba/i, true],
  ["Carrabba's", /carrabba/i, true], ["carrab", /carrabba/i, true],
  // NEW-1 (2026-10-11): a stray row spelled exactly like the typo ("Chik Fila", city-only "Chik-fil-a | Plano",
  // "Whataburgr Restaurant | Irving", a far "Fadi's") must not beat the nearby real chain.
  ["Chikfila", /chick-?\s?fil/i, true], ["Chikfilla", /chick-?\s?fil/i, true], ["Chikfil-a", /chick-?\s?fil/i, true],
  ["Chick fil a", /chick-?\s?fil/i, true], ["Chickfila", /chick-?\s?fil/i, true], ["Chick-fil-A", /chick-?fil/i, true],
  ["Whataburgr", /whataburger/i, true], ["Whatburger", /whataburger/i, true],
  ["Fadis", /^fadi.s/i, true], ["Popeys", /popeyes/i, true],
  ["Chipolte", /chipotle/i, true], ["Five Guy", /five guys/i, true], ["Torchys", /torchy/i, true], ["Zoes", /zo[eë]s kitchen/i, true],
  ["Chipotle", /chipotle/i, true],
  // far-exact controls: uniquely named places in Austin / Dallas, typed exactly from Katy — must still lead
  ["Copperhead Club", /^copperhead club$/i, true], ["Stein's Bakery", /^stein's bakery$/i, true],
];
let bad = 0;
for (const [q, re, required] of CASES) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${rpc}`, {
    method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ p_query: q, p_cap: 60, p_center_lat: CENTER.lat, p_center_lon: CENTER.lon }),
  });
  if (!r.ok) { console.error(q, r.status, await r.text()); process.exit(2); }
  const rows = await r.json();
  const ranked = rankByProximity(q, rows, BOUNDS);
  // nearest correct location = the matching row closest to the centre
  const match = rows.filter((x) => re.test(x.name)).sort((a, b) => a.distance_km - b.distance_km)[0];
  const pos = match ? ranked.findIndex((x) => x.id === match.id) + 1 : 0;
  const ok = pos === 1;
  if (required && !ok) bad++;
  console.log(`${ok ? "✓" : required ? "✗" : "·"} ${q.padEnd(12)} pool=${String(rows.length).padStart(3)} nearest-correct=${match ? `${match.name} (${match.distance_km.toFixed(1)} km${match.id === FRY ? ", Fry Rd" : ""})` : "NOT IN POOL"} position=${pos || "-"}${pos > SHOWN ? " (below the fold)" : ""}`);
}
console.log(bad ? `\nFAIL: ${bad} required case(s) not #1` : "\nPASS");
process.exit(bad ? 1 : 0);
