# Schedule page (audit J3, B2671308)

The Schedule is ES modules here, bundled by esbuild into the committed page bundle in the sequence folder (never hand-edit it;
`npm run build:sequence-page`, `--check` in CI). the sequence folder's index.html holds NO application code: markup, CSS tokens,
`<script src>` tags and the `planar-data` seed (a JSON data blob). Early-boot scripts live in the sequence folder's boot script.

- `main.jsx` App + shell wiring; `layout.js`, `viewState.js`, `common.jsx` shared leaves; `pinCursor.js` drag cursor pin.
- `grid/`, `gantt/` (+ `pdfExport.jsx`), `taskReport/`, `dialogs/`, `panels/`, `menus/`, `suggestions/`, `common/`.
- `harnessGlobals.js` `exposeToHarness` publishes bindings on `window` for the ui-audit drivers; a cross-file `let`
  assignment needs a setter (`setRowH`) or an install function, never a direct assignment.
- Source-reading tests use the sequenceSource test helper (index.html plus every page module).
- Open follow-ups: B2671325 (token sweep, lifts the design-drift exemption), B2671326 (shared Supabase client).
