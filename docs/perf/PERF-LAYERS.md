# Every perf measurement in this repo ran with zero layers. He runs four. (B265538 / B265539)

**Standing note. Read before quoting any performance number from this repo as if it described the
owner's session.**

## The fact

From his own telemetry, 2026-08-07 → 08, one long-lived tab, plan *Bain Concept - Original*,
`event:perf` rows on builds `4a77211`:

```
el 47 · ly 4 · pn 0 · dpr 2.15 · vw 1600 · cv 523 · dom 2007 · tl 248
```

`ly` is the count of Leaflet layers on the map. **Every fixture in `ui-audit/lib/planFixture.mjs`,
every arm of every standing battery, the growth harness, the pan/zoom probes, the pond invocation
counter, and the one live signed-in drive taken on his own machine all ran at `ly 0`.**

**B1435 measured per-frame cost as scaling with elements × panels × LAYERS.** So the scenes this
programme benchmarks are materially lighter than the one he actually has the symptom in, and a null
result from a lighter scene is not evidence about a heavier one. That is the
instrument-on-trial clause of **NEVER-PARK**, and it is recorded here as a fixture property rather
than left as a caveat in a report nobody re-reads.

## What changed

- `OWNER_SCENE` in `ui-audit/lib/planFixture.mjs` records the measured numbers above, with their
  provenance, so no arm has to re-derive them from a chat message.
- `LAYER_ARMS` + `withLayerArm(fixture, arm)` stamp a layer set onto any fixture through the site
  model's existing sparse `layerOverrides` field. Two arms: `none` (the historic default) and
  `owner-4`.
- **`ui-audit/count-pond-invocations.mjs` now defaults to `--layers owner-4`**, and prints the
  layer count it actually measured off the page (`.leaflet-layer`, the same counter the telemetry
  reports). `--layers none` restores the old arm for a controlled A/B.

## Two honest limits

**1 — WHICH four is not known from the telemetry, and the arm says so.** `ly` was a COUNT.
`OWNER_LAYER_SET` (`fema`, `contours`, `txrrc_pipe`, `jur_county`) is a plausible four for a
Houston-area industrial site — **not his**. An arm using it proves *"four layers mounted"*, never
*"his four layers"*.

**This is being closed by measurement rather than by asking him (B265539):** the perf row and the
capture now both carry the layer **keys** — `noteLayerContext` in
`src/shared/telemetry/perfRecorderHandle.js`, surfacing as `lyk` on `event:perf` and `layers` on a
capture. They are GIS registry keys (public service names out of this app's own table), sanitised
to `[a-z0-9_]`, sorted, and bounded with a trailing `+` when cut, so a reader can never mistake a
truncated list for a complete one. Once one row arrives from his browser, `OWNER_LAYER_SET` becomes
a measurement and this paragraph goes away.

**2 — A mounted layer here never FETCHES.** Every GIS host is egress-blocked in the sandbox, so a
seeded layer creates its Leaflet pane and layer object — which *are* re-transformed on every pan
frame, a real and measurable share of the cost — but paints no tiles and no features. **The
`owner-4` arm is therefore a lower bound on the layer amplifier and must be reported as one.**
