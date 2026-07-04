# e2e/fixtures — versioned synthetic fixture set (B278 / B280 / B281 harness)

The recurring **LIVE-VERIFY** repro cases, captured as **synthetic, deterministic** fixtures tied to
the seeded `e2e@planyr.test` account. **No real client data** — every fixture is generated with a fixed
PRNG seed + fixed dates and scrubbed to `E2E …` placeholders. Each fixture ships with a committed
`*.golden.json` of numbers the **real engines** compute from it, so a silent engine/schema change
surfaces as a golden diff, not a lost regression.

## Regenerate

```
node scripts/build-fixtures.mjs           # rewrite every fixture + golden (deterministic)
node scripts/build-fixtures.mjs --check    # CI drift guard — fails if committed ≠ freshly generated
```

CI runs `--check` (build.yml) and the vitest specs on every PR. Fixtures are consumed through the shared
loader `e2e/fixtures/index.js` (`loadFixture` / `loadGolden` / `loadManifest`), which asserts
`fixtureVersion` so a stale spec can't read a regenerated fixture.

## Fixtures

| Fixture | Repro it stands in for | Golden holds |
|---|---|---|
| `ponds/detention-regression` | Goose-Creek-class detention: known geometry → known volume | contour areas + `detentionStorage` (average-end-area) per case |
| `schedules/dense-project` | Pappadoupolos-scale dense Gantt (~119 tasks / ~103 deps), ~33% zoom | task/dep counts, parent rollup dates, export filename |
| `sites/dense-testfit` | Dense industrial test-fit (building + bonded children + truck courts + bump-outs) | yield counts, tombstone-delete survivors, merge-no-resurrect |
| `cloud/two-writer` | Two writers over one row (stale must conflict; un-migrated degrades) | `interpretCas`/`interpretInsert` outcomes |

## LIVE-VERIFY coverage (`manifest.json`)

Every mandatory LIVE-VERIFY class maps to ≥1 harness spec — the goal state that shrinks the manual live
gate over time. Most are deterministic **sandbox** vitest; genuinely live paths carry a `VERIFICATION.md`
`V###` companion.

| LIVE-VERIFY class | Sandbox spec (runs now) | Live companion |
|---|---|---|
| PDF/export parity | `test/scheduleDensityFixture.test.js` | `e2e/gantt-density.spec.js` (V207) |
| zoom-/data-density rendering | — | `e2e/gantt-density.spec.js` (V207) · `e2e/site-testfit.spec.js` |
| real-project-data repros | `test/pondVolumeFixture.test.js` · `test/siteFitFixture.test.js` | — |
| concurrency / multi-writer | `test/twoWriterFixture.test.js` | `VERIFICATION.md` V205 (two signed-in tabs) |
| timing / race bugs | `test/scheduleDensityFixture.test.js` (no throw/hang) | `VERIFICATION.md` V206 (post-sign-in toast race) |
| GIS endpoint behavior | `test/coverage.test.js` · `test/gisFetch.test.js` | `.github/workflows/gis-drift.yml` |

## Seeding the DB fixture

`sites/dense-testfit` can be seeded into the e2e account for the auth-gated `e2e/site-testfit.spec.js`
via `e2e/seed/seed-fixtures.sql` (id `e2e-fixture-testfit`, scoped to the e2e user, delete-then-insert,
never touches real data). It is the owner's one-time SQL step, same as `e2e/seed/seed.sql`.
