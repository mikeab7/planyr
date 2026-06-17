# ui-audit — UI screenshot harness

Dev tooling for the UI workstream (see `../UI_AUDIT.md`). **Not** part of the app
build or deploy.

- `capture.mjs` — drives a headless Chromium (Playwright) over `vite preview` and
  writes screenshots to `screens/`. It seeds a representative all-element-types site
  into `localStorage` so the app boots straight into the planner — no Supabase
  credentials and no map tiles required.
- `screens/` — the captured screenshots (a point-in-time snapshot; re-run to refresh).

## Run
```bash
npm run build
npm run preview &                 # serves dist on :4173
npm install --no-save playwright  # kept out of package.json on purpose (dev-only)
node ui-audit/capture.mjs
```
If the environment's managed Chromium revision differs from the Playwright package's
expected one, point it at the installed binary:
```bash
PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node ui-audit/capture.mjs
```

## Scope / limits
- Auth-gated cloud views are out of scope (no backend credentials here).
- Map basemap tiles are blocked by the environment network policy, so `map.png`
  shows chrome only (expected, not a defect).
- Document Review's measure/markup/takeoff tools only render with a PDF loaded, so
  only its empty state is captured here; audit those from code or a future PDF pass.
