# End-to-end tests (B278)

Playwright drives the **real, built app** in a browser. This is the automated verifier for
the shared-markup refinement loop (B421 / NEW-9): it proves each tool in
`src/shared/markup/tools.matrix.js` is actually implemented — armed from the rail, drawing the
right markup, exposing the right property controls — not merely specified.

## What's here

| File | Coverage | Needs the seeded account? |
|---|---|---|
| `smoke.spec.js` | App boots, shell renders, workspace switcher moves between Site and Review. | No — runs anywhere. |
| `markup-tools.spec.js` | Signs in, opens Review, asserts the tool rail; **the per-tool NEW-9 groups grow here** as tools land (B425+). | Yes (skips cleanly without it). |
| `helpers.js` | `signIn`, `openModule`, and the `hasAccount` guard. | — |

## Running it

```bash
# Local: Playwright builds the app and serves it on :4173 itself.
npm run e2e                       # all specs
npm run e2e -- smoke.spec.js      # just the logged-out smoke

# Against a deploy (how CI runs it): point BASE_URL at the preview/prod origin.
BASE_URL=https://<preview>.planyr.pages.dev npm run e2e
```

In this sandbox (and CI) outbound HTTPS is TLS-inspected, so Chromium launches with
`--ignore-certificate-errors` + `ignoreHTTPSErrors` (already set in `playwright.config.js`,
matching every `ui-audit/*.mjs` harness). If Playwright can't find a browser, set
`PLAYWRIGHT_BROWSERS_PATH` to the managed browser dir (e.g. `/opt/pw-browsers`).

## The seeded account (B280) — owner action

The auth-gated specs need a real Supabase test user and a fixture project. That account can't
be created from code (no admin key in the browser), so it's the **one owner setup step**, done
once. The owner runs the B280 seed file and adds three CI secrets:

- `E2E_EMAIL` / `E2E_PASSWORD` — the seeded test user's credentials.
- `BASE_URL` — the preview/production origin the suite runs against.

Until those exist, `markup-tools.spec.js` skips (never a false failure) and `smoke.spec.js`
still runs. See `e2e/seed/` for the SQL + step-by-step.

## How the loop uses it (B281)

The `e2e.yml` workflow runs this suite against each preview. On failure it opens (or bumps) a
single deduped `@claude` issue with the report and auto-closes it when green again — the same
idempotent pattern as `gis-drift.yml`. That issue is what drives the autonomous
implement→test→fix→advance loop for the remaining tool rows.
