# County-parcel verification — one runner, one table

`node ui-audit/verify-county-parcels.mjs` verifies, in a batch, that a known point in a county or city
resolves to a real parcel through the **shipped** code (`candidateCountiesForPoint` picks the sources the app
would ask, `queryAtPoint` asks each, against the live county server). The cases live in
**`cases.mjs`** — a plain table. **Adding the next county is adding a row. If you are writing a new script for
a county, stop: you have the wrong tool.**

Engine: `../lib/countyParcelRunner.mjs` (pure verdict logic, unit-tested offline in
`test/countyParcelRunner.test.js`, which also checks every table row against the shipped registry in CI —
no network). CLI: `../verify-county-parcels.mjs`.

## Add county number eight (the whole recipe)

1. **Find a point that sits inside a real lot** — not a county-seat coordinate (those often land on a road
   and the server correctly answers "nothing here"). Query the county's layer for a small envelope around the
   town, take a returned parcel's centroid, and confirm `queryAtPoint` hits it. (Four of eleven Georgia
   "obvious" points missed for exactly this reason.)
2. **Append a row to `CASES` in `cases.mjs`:**

```js
{
  id: "oh-franklin-columbus", covers: ["V0000000"],      // ledger V# this row closes when it PASSes
  place: "Franklin County, OH (Columbus)",
  live: true,
  answeredBy: "oh_franklin",                              // the COUNTIES_MAP key whose layer must answer
  layer: /services\d?\.arcgis\.com\/.*Parcels\/FeatureServer\/0$/,   // which layer (guards a wrong-layer wiring)
  pin: /^\d{3}-\d{6}-\d{2}$/,                             // PIN shape; read from the row's idField (override: field: "Name")
  points: [
    { label: "Columbus (lot interior)", lat: 39.96118, lng: -82.99879, routes: ["oh_franklin"] },
  ],
}
```

3. **Run it:** `node ui-audit/verify-county-parcels.mjs --only oh-franklin-columbus --prove-red`
   (`--only` takes the row id or the ledger id). Then `npx vitest run test/countyParcelRunner.test.js`.
4. **Record it:** PASS → `npm run ledger -- move V<id> done --file <text with the dated PASS + the run's output>`.
   FAIL → it is a finding about coverage; record it (see "Reading a verdict"), never loosen the row until it
   goes green. VOID → leave the V# pending and say which host was unreachable.

Row fields are documented at the top of `cases.mjs`. The useful ones beyond the example: `routes` (the EXACT
source set the app will ask — also how you assert "one query, not two"), `routesNot` / `routesInclude`,
`requests` (max parcel requests fired), `noRequestTo` (hosts that must stay silent — e.g. the county layer
must not be asked inside a city that has its own), `distinct` (PINs must differ across the row's points),
`attrs: { OWNER: /./ }` (extra attributes), per-point `live: false` (a pure routing claim), and
`interior: false` (point not yet confirmed inside a lot — an empty answer there is VOID, not FAIL).

## Reading a verdict

| Verdict | Meaning | What you do |
|---|---|---|
| **PASS** | every stated expectation held | close the V# with the run output |
| **FAIL** `[routing]` | our router asked the wrong source(s), or too many | our code — fix, or the row's claim is wrong |
| **FAIL** `[source]` | the county answered an error, or no parcel at a point proven to be inside a lot | a coverage/outage finding — file it against the county's B#, do **not** loosen the row |
| **FAIL** `[shape]` | a parcel came back but the PIN/layer/attribute is not what the row says | the wiring points at the wrong layer or field |
| **VOID** | the live half could not run from this machine (host unreachable). The runner asks the egress proxy directly and says whether it was a policy refusal (a sandbox fact, not evidence about the county) or the host itself not answering | run it where the host is reachable; never count VOID as a pass |

Exit code: 0 all PASS · 1 any FAIL · 2 no FAIL but some VOID (`--allow-void` → 0).

## Flags
`--only <id|V#>` · `--routing-only` (no network) · `--prove-red` (re-judges every passing point against
deliberately wrong expectations and requires each to FAIL — a runner that cannot go red is not evidence) ·
`--json <path>` · `--list`.

## TLS and the proxy
The runner never disables certificate checks and takes no certificate-bypass flag (B2154048 is about removing
those from older harnesses — do not copy that pattern). In a sandbox with an egress proxy it re-launches itself
with Node's own proxy support (`NODE_USE_ENV_PROXY=1`) and the CA bundle the environment already installed.

## What it is not
A source-level run: it executes the shipped modules against the live county servers. It is **not** a click on
planyr.io — it proves the mechanism (the right sources are asked, a real parcel comes back through the exact
function the app calls), not that the Map Finder UI renders or selects it. Items whose steps are about the UI
(outlines on zoom, an acknowledgement ring, add-to-plan, KMZ, print) are not rows and stay with their own harnesses.

## Which pending verification items this table can take next
From `docs/verification-triage-2026-11-11.json` (bucket A2, tool "extend verify-…-second-pass-… with rows"):
point → county layer → parcel/PIN, the exact shape of a row.

- **Georgia:** V1335600, V1337408, V1338880, V1747248 (V1335600's points are already in `verify-ga-county-batch-20260923.mjs` — copy them in)
- **Louisiana:** V1747856 · **Missouri:** V1748208 · **Idaho:** V1748448 · **South Dakota:** V1774464 (the other 15 SD counties) · **New Mexico:** V1776416
- **Oregon:** V1778224 · **Kansas:** V1778528 · **South Carolina:** V1779328 · **Washington:** V1779888 · **Iowa:** V1780432
- **Oklahoma:** V1780640 (point half only) · **Michigan:** V1797184 · **Pennsylvania:** V1803728 · **Illinois:** V1808320 (owner/address via `attrs`)
- **Texas routing/request-count:** V1168544, V1168545 (`routes` + `requests`; Harris = exactly one query, no statewide layer alongside)
- **Partly:** V1345744 (the Kissimmee point; the Duval planner-search half is UI)

That is 21 (20 whole + 1 partly), not 24 — the triage's "parcel/county" family also contains items that are about outlines, rings, add-to-plan,
KMZ, print, ETJ and theme, which are browser-UI checks and not rows. Re-read each item's live text before relying on this list; it is a snapshot.
