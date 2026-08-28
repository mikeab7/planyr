/* FoodMap — pan/zoom a map, see food places as pins, click one to log a visit.
 *
 * Deliberately simple: one Leaflet map, one canvas-rendered marker layer (canvas, not SVG —
 * the snapshot query can return up to a couple thousand points, and an SVG node per pin is the
 * wrong tool at that count). Pins are colour-coded: logged vs not-yet-logged vs a manual pin,
 * per the brief's "places he has logged render differently from ones he has not."
 *
 * ⛔ THE ZOOMED-OUT MODEL (owner redesign, 2026-08-18, SUPERSEDING an earlier clustering attempt
 * — read this before adding anything back). The first pass at "the pins are unreadable at low
 * zoom" tried clustering AND spreading the 34,000-place reference snapshot evenly across the
 * viewport at every zoom. The owner rejected the whole model, not the tuning, verbatim: "i dont
 * think the idea is to show all the places at this zoom level, i also dont want to lump things
 * together, the better thing would be to show places that we have rated at a more zoomed out
 * level." So: **no clustering, ever — one pin per point, at every zoom.** And below
 * `MIN_PIN_ZOOM`, the map shows ONLY his own places (`loggedPlaces` + `manualPins`) — the
 * reference snapshot (`places`, from Overture) simply does not draw at all until he zooms in.
 * His own places are the CONTENT of this map; the 34,000-place table is a lookup he reaches
 * into once zoomed to a neighbourhood, never something to sample or spread evenly at metro
 * scale. His own places draw at EVERY zoom, always, and are never hidden or merged into
 * anything — that's the one invariant this file must not break again.
 *
 * ⛔ BASEMAP (NEW-5, revised 2026-08-18 — "i want some color on the map, its too grey"). Positron
 * (the light-grey CARTO style) delivered "muted" so thoroughly it read as a flat wash — water,
 * parks and built-up land all nearly the same tone, no way to orient at a glance. Landed on
 * CARTO's **Voyager** style instead: still the SAME free, key-less service at the SAME domain
 * (`basemaps.cartocdn.com`) and the SAME terms already vetted for Positron (see
 * https://github.com/CartoDB/basemap-styles — `rastertiles/voyager` is one of the documented
 * style values on the identical `{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{scale}.png`
 * endpoint), just a different `style` parameter — genuine cartographic colour (green parks,
 * blue water, warm building fill) with roads/labels still kept quiet. Checked the Site Planner's
 * own free registry again first, as instructed (`site-planner/lib/basemaps.js`, Esri/USGS) —
 * still the wrong content type: aerial PHOTOGRAPHY has no "muted" setting, it's real-world photo
 * detail, and would reintroduce the "too busy" problem in a different shape. A tile URL, not a
 * package — no new dependency.
 * ⛔ SUPERSEDED (B811520, 2026-08-27) — CARTO began watermarking these exact keyless Voyager
 * tiles ("API KEY REQUIRED", stamped across the map). Moved to Esri's `World_Topo_Map` — see the
 * `STREET_TILES` header comment below for the full reasoning, including why `World_Topo_Map` was
 * picked over `World_Street_Map` (the "quiet roads, real colour" balance this note describes is
 * what `World_Topo_Map` was chosen to preserve). The rest of this note is history — CARTO/Voyager
 * are no longer used anywhere in this file.
 *
 * ⛔ SATELLITE TOGGLE (B632177, owner, 2026-08-19: "also add an option for a satellite view"). ONE toggle,
 * two states — never a basemap gallery. Reuses the Site Planner's Esri World Imagery source
 * (`site-planner/lib/basemaps.js`'s `esri` entry — free, key-less, no account, no billing,
 * already vetted and already paid for at zero) — the URL/maxZoom/attribution are DUPLICATED
 * here rather than imported, the same reasoning as this module's own `lib/supabaseClient.js`:
 * BUNDLE ISOLATION forbids importing anything under `src/workspaces/site-planner/`, and a
 * shared edge would hoist this module's bytes onto the Site route. Esri over USGS: native to
 * z19 vs USGS's z16, so it stays sharp at the neighbourhood zoom this map already favours.
 * The two tile sources are swapped WHOLE (a fresh `L.tileLayer`, old one removed) rather than
 * `setUrl` on a shared layer — `setUrl` alone doesn't carry a new `maxZoom`/`attribution`,
 * and this way the two can never end up with one's URL and the other's ceiling.
 *
 * PIN LEGIBILITY ON IMAGERY. Satellite backdrops are dark and visually busy — rooftops, shadows,
 * pavement, tree canopy all compete with a small filled circle — where Voyager's pale, quiet
 * palette left plenty of contrast on its own. Every pin already carries a white keyline stroke
 * (the halo that makes the fill colour read against ANY backdrop); satellite mode widens it
 * (2px -> 3px) so the same 1-10 rating ramp stays legible over photo detail instead of just over
 * a street map's calm tones.
 *
 * ⛔ B634981 — THE SATELLITE TOGGLE SHIPPED CRASHING THE WHOLE MODULE, and this is the actual fix
 * (owner, with a live console stack trace, 2026-08-19: clicking Satellite threw
 * "Cannot read properties of undefined (reading 'length')" inside Leaflet's `_getSubdomain`,
 * caught by the workspace error boundary — the entire /food route blanked to an error screen).
 * ROOT CAUSE: the tile-layer options were built as `{ subdomains: source.subdomains, ... }`
 * unconditionally — for SATELLITE_TILES, which declares no `subdomains` key, that evaluates to
 * `subdomains: undefined`, and passing that EXPLICIT `undefined` clobbers Leaflet's own internal
 * default (`'abc'`) rather than leaving it alone. `_getSubdomain` reads
 * `this.options.subdomains.length` UNCONDITIONALLY on every tile request — not gated on whether
 * `{s}` appears in the URL template, contrary to what the URL alone would suggest — so the very
 * first tile threw, synchronously, inside the mount effect. Fix: `subdomains` is only added to the
 * options object AT ALL when the source actually declares one (STREET_TILES's `"abcd"`); Esri gets
 * no key, exactly as the Site Planner's own imagery layer already does it (`MapFinder.jsx` never
 * passes `subdomains` for its Esri layer either — this was the exact bug an explicit-undefined
 * introduces that an omitted key does not).
 * MIRRORED FROM THE PLANNER, PER INSTRUCTION, rather than re-derived: `maxZoom: 21` +
 * `maxNativeZoom: 19` (not a flat `maxZoom: 19`) so Leaflet upscales past Esri's native ceiling
 * instead of just refusing to zoom further; a second, faint LABELS overlay
 * (`Reference/World_Transportation`, opacity 0.4, added ONLY in satellite mode) so street names
 * still read over the photography — satellite imagery with no labels is much harder to navigate.
 * Axis order `{z}/{y}/{x}` (Y before X — Esri's convention, backwards from Leaflet's own default)
 * was already correct here; flagged in case a future edit "corrects" it back to `{z}/{x}/{y}` and
 * silently starts requesting the wrong tiles.
 * GUARDED SO A BAD TILE CONFIG CAN NEVER TAKE THE MODULE DOWN AGAIN: the tile-layer mount is
 * wrapped in try/catch; a thrown error degrades to a small "Imagery unavailable" state instead of
 * propagating into the workspace error boundary.
 *
 * ⛔ SELECTED-PIN HIGHLIGHT + PANEL-AWARE CENTRING (B634976, owner, 2026-08-19, after searching "soto" and
 * opening it: "it's not exactly clear once a spot is selected via map or search that it is
 * selected... give the selected pin its own state"). `selectedKey` (computed once in FoodApp,
 * shared verbatim with VisitList's row highlight and VisitPanel's own key) drives TWO things
 * here: (1) the matching pin draws noticeably larger, with an accent-coloured ring AND a soft
 * halo behind it — never just a bigger version of the same white-stroke look the unrated/rated
 * states already use, so it reads as a genuinely different state at a glance; (2) `flyToTarget`'s
 * pan offsets the destination so the pin lands centred in the area the user can actually SEE, not
 * the raw map element centre — `VisitPanel` covers roughly the right third once a place is
 * selected (`PANEL_WIDTH` below, matching its own literal width), so panning to the raw centre
 * can leave the pin behind the panel or crammed against its edge. Computed via
 * `map.project`/`unproject` (the standard Leaflet pixel-offset-pan pattern): shift the target
 * point right by half the panel's width before flying, so it re-centres left of true-centre by
 * exactly that much — i.e. the middle of the VISIBLE (unobstructed) region. This one flyTo path
 * is shared by search AND by list-driven selection (FoodApp's List `onSelect` now sets
 * `flyToTarget` too), so both get the same corrected centring for free.
 *
 * ⛔ B651872 (×2) — RECURRENCE: the flyTo fix above cured the STALE ORIGIN (owner-confirmed
 * live: `.leaflet-tile-container` is now `translate3d(0,0,0) scale(1)`, not the old ~-2.73e6px
 * offset) but exposed a SECOND, independent staleness underneath it — GridLayer's tile FADE-IN
 * (`_tileReady`/`_updateOpacity`, driven by ONE shared `requestAnimFrame` handle per layer,
 * `this._fadeFrame`) freezing partway, leaving tiles stuck around 30% opacity indefinitely.
 * Measured live: forcing every `.leaflet-tile`'s opacity to 1 in the console repainted the map
 * PERFECTLY — nothing else was wrong, so this is purely the fade animation's own rAF chain never
 * completing. Fix, per the owner's explicit instruction (turn the fade off rather than keep
 * patching around it): `fadeAnimation: false` on the map at construction — Leaflet's own
 * `GridLayer._tileReady` branches on `this._map._fadeAnimated`; with it false, a loaded tile is
 * marked active immediately with NO opacity dance and nothing to ever get stuck (see
 * `node_modules/leaflet/dist/leaflet-src.js`'s `_tileReady`). Deliberately NOT a
 * setTimeout/setInterval forcing opacity — that would hide a still-broken fade loop rather than
 * removing the loop.
 *
 * ⛔ B651872 (×3) — RECURRENCE: the fade fix above cured the opacity freeze (owner-confirmed live:
 * every tile opaque, `naturalWidth>0`, unchanged across polls) but a Houston→Maui search jump
 * STILL painted flat grey for several seconds after the camera landed, with two
 * `.leaflet-tile-container` levels present — a live one at a fractional scale (e.g. 0.9118, not
 * 1) and a dead one at 0 children. The owner's own hypothesis (a fractional landing zoom from a
 * bounds-fit) does NOT hold for this code path: `zoomSnap`/`zoomDelta` are Leaflet's untouched
 * defaults (1), and the zoom `flyTo` is given here is always a literal integer
 * (`Math.max(map.getZoom(), FLY_TO_ZOOM)`, never a `fitBounds`-derived fraction) — verified by
 * instrumenting a real Leaflet map (not a paraphrase) and logging every `_move`/`_setView` call
 * through the flight.
 * THE ACTUAL CAUSE, found by that same instrumentation: `map.flyTo` with no `duration` computes
 * one from real-world distance via its own van-Wijk/Nuutinen curve — measured directly:
 * ~1.6s for a same-neighbourhood hop, ~4.2s Houston→Austin, **~7.8s Houston→Maui**. For a jump
 * that long, the animation continuously sweeps through EVERY integer zoom between start and
 * destination (12 down to ~5, back up to 16), and GridLayer creates/tears down a tile level at
 * each one it passes — the "two levels, one fractional-scale, one 0-children" snapshot is not a
 * stuck state, it's a NORMAL mid-flight frame of an animation still running when it was
 * measured. Confirmed by re-running the identical flight to its true, natural end, over and
 * over (both with the tile server's realistic latency AND its jitter): it always settles to
 * exactly one level, `scale(1)`, an integer zoom — the existing hard-reset above is not flaky.
 * The bug is that the flight simply takes too long for the user to perceive as "landed" before
 * it visibly is — matching the owner's own words, "flat grey for several seconds."
 * FIX: cap `flyTo`'s duration at a fixed 1.5s (measured to match what a LOCAL jump already takes
 * naturally, so a same-neighbourhood search feels unchanged) rather than letting distance blow it
 * out to several seconds. This is not a redraw or a timer patched over the symptom — it directly
 * shortens the window the animation spends sweeping through unnecessary intermediate zoom
 * levels, so the destination's own tiles start loading sooner and the whole flight settles
 * before the user is watching for it to. Verified via the same instrumented harness: capped,
 * Houston→Maui and the short Uchi→Uchiko-style hop both land in ~1.5s wall-clock, every time,
 * clean (single level, `scale(1)`, integer zoom) — see the session's `.scratch-repro/` notes.
 * SELECTED PIN: also checked, per the owner's explicit ask, whether the searched/selected place's
 * OWN pin renders once landed — it does not, until FoodApp's places-in-bounds snapshot (fetched
 * only on 'moveend', per the "reference snapshot is bounds-scoped, his own places are always
 * drawn" architecture below) refetches for the new area, IF the place is unvisited/unflagged (so
 * it isn't in `loggedPlaces`/`manualPins`/`wishlistPlaces`, none of which are bounds-gated). The
 * duration cap makes 'moveend' — and so that refetch — fire far sooner, but there's still a real
 * network round-trip in between. Rather than leave that gap, `selectedPlaceInfo` (FoodApp) now
 * carries the selected place's own lat/lon/name through, and this file draws ONE fallback pin
 * for it whenever `selectedKey` isn't already covered by one of the always-drawn sets — so the
 * selected pin is never simply absent, regardless of the refetch's timing.
 *
 * ⛔ B651872 (×4) — THE OWNER MEASURED WHY: THE FLIGHT ITSELF FETCHES TILES AT EVERY ZOOM LEVEL
 * IT PASSES THROUGH, AND RETINA TILES COST 2-5x MORE THAN THEY'RE WORTH HERE. His own live
 * capture during a Houston→Maui jump showed tile REQUESTS at zoom 5 mid-flight
 * (`World_Imagery/MapServer/tile/5/12/6`) before the camera ever reached zoom 16 — the (×3)
 * duration cap made that sweep FASTER, it never stopped it, so a long jump was still fetching a
 * full screen of tiles at a dozen zoom levels it was only going to look at for a few hundred ms,
 * all competing with the DESTINATION tiles for the same ~6 connections. Separately measured:
 * `@2x` retina tiles average 45.7 KB / 129 ms median vs 21.4 KB / 23 ms for `1x`, cold — 2.1x the
 * bytes and ~5.6x the latency for a screen that, at a fractional landing zoom, gets resampled by
 * the compositor anyway (upgraded to always land on an integer zoom below, so that waste is gone
 * too). FIX, three parts:
 *   1. **Stop sweeping through intermediate zooms on a long jump.** `LONG_JUMP_METERS` gates a
 *      DIRECT `map.setView(dest, zoom, {animate:false})` instead of `flyTo` once the real-world
 *      distance crosses the threshold — no animation at all, so the destination's own tiles are
 *      the FIRST thing requested, not the last. Threshold measured, not guessed: reimplementing
 *      flyTo's own van-Wijk/Nuutinen curve and finding the MINIMUM zoom each jump sweeps down to
 *      (`.scratch-repro/measure-zoom-depth.html` this session) — Katy (~48km, same metro) only
 *      dips to z11.7 from z12, negligible; Austin (~235km) dips to z9.6; Maui (~6128km) dips to
 *      z5, matching the owner's own live capture exactly. 100km sits cleanly between "same-metro,
 *      basically a plain pan" and "genuinely sweeps multiple zoom levels." A short jump keeps the
 *      existing capped `flyTo` (still worth having — it looks better and the sweep is negligible
 *      there).
 *   2. **1x tiles on a narrow viewport, for the street basemap only.** Retina URL substitution
 *      (`{r}` → `@2x`) is unconditional in Leaflet whenever `Browser.retina` is true — every
 *      iPhone — regardless of any `detectRetina` option, confirmed from `TileLayer.getTileUrl`'s
 *      own source. `STREET_TILES.url1x` drops the `{r}` token entirely on
 *      `useNarrowViewport()`(same breakpoint `VisitPanel.jsx` already uses). Esri's satellite
 *      layer never had a `{r}` token to begin with — this waste was street-basemap-only.
 *      **Not independently visually verified against real CARTO tiles here** — this sandbox's
 *      egress proxy blocks the real tile hosts outright, so there's no way to fetch-and-diff a
 *      real @2x vs 1x tile; flagged honestly rather than claimed proven, per the owner's own
 *      "measure before deciding" instruction.
 *      ⛔ MOOT since B811520 (2026-08-27) — the street basemap moved to Esri, whose tile URLs
 *      have no `{r}` retina token at all (same as satellite already had none), so there is no
 *      retina-byte question left to solve here. History only.
 *   3. **A real loading treatment instead of silent grey.** "Keep the previous tiles" doesn't
 *      apply to a jump to a genuinely different place — there's nothing relevant to keep. Instead:
 *      a small "Loading imagery…" pill tied to the CURRENT tile layer's own `loading`/`load`
 *      events, so grey reads as "in progress," not "broken."
 * ALSO: nothing in this file previously told Leaflet when its CONTAINER's own size changed
 * outside of a flyTo/setView (the only `invalidateSize()` calls lived inside that one effect) —
 * a device rotation or an iOS Safari dynamic-toolbar resize between those moments would leave
 * Leaflet's cached size stale with nothing to correct it. A `ResizeObserver` on the host div now
 * calls `invalidateSize()` the INSTANT the container's real size changes, never on a timer —
 * closes that whole class regardless of what triggers it. **Investigated but could NOT reproduce
 * the reported "clean horizontal grey band, tiles below" specifically from the bottom sheet
 * mounting**: `BottomSheet.jsx` renders `position:fixed`, which Flexbox does not allocate space
 * for, so it cannot resize `FoodMap`'s own container by CSS mechanics alone — confirmed by
 * instrumenting the real `FoodMap/VisitPanel` pair at iPhone width through the exact sequence
 * (map mounts alone → sheet mounts later → snap settles): Leaflet's own `_size` and the
 * container's real `getBoundingClientRect()` stayed IDENTICAL throughout, every sample. Saying so
 * plainly rather than claiming a fix for a mechanism that didn't reproduce — the tile-loading
 * fixes above are the better-evidenced explanation for a partially-painted screen (an iPhone on
 * cellular is exactly where the retina + intermediate-zoom cost bites hardest), and the
 * ResizeObserver hardening is shipped anyway because it is correct regardless of which mechanism
 * is real, and because the owner's own checklist named it an acceptable tool.
 *
 * ⛔ B668193 — CANVAS PINS ARE TOO SMALL TO TAP ON TOUCH (owner report, live DOM measurement:
 * canvas-rendered markers, zero `.leaflet-interactive`/`.leaflet-marker-icon` DOM nodes, so the
 * tap target is exactly the drawn circle radius — ~10-12px against a ~44px finger). Leaflet's own
 * canvas hit-test (`Canvas._onClick`) resolves overlaps by DRAW ORDER (last-added/topmost wins),
 * never by proximity — measured directly against a local repro (`_fireDOMEvent`'s `canvasTargets`
 * filtering) — so simply raising the renderer's `tolerance` option would make the WRONG pin win
 * in a dense cluster more often, not less. Fix: on a coarse pointer (`pointer: coarse`, i.e.
 * touch/no-hover — desktop mice are untouched, so PRECISION THERE IS BYTE-IDENTICAL), skip
 * attaching a `click` listener to each circleMarker (confirmed via the same repro: an
 * `interactive:true` canvas layer with NO listener does not consume the click — `map`'s own
 * `click` event still fires normally) and resolve the tap centrally instead: every pin drawn this
 * pass is recorded in `pinIndexRef` with its real screen radius, and ONE `map.on('click', …)`
 * handler picks whichever candidate's centre is CLOSEST to the tap point, among those within
 * `TOUCH_MIN_TAP_RADIUS` — genuine nearest-centre resolution, not draw-order. `TOUCH_MIN_TAP_RADIUS`
 * only WIDENS the invisible hit area; it never touches a pin's drawn radius, so density on screen
 * is untouched (satisfies "must not turn to mush").
 *
 * ⛔ B681520 — ATTRIBUTION WAS PAINTING THROUGH THE SHEET (owner screenshot: the "Leaflet | ©
 * OpenStreetMap contributors © CARTO" strip sat on top of the detail sheet's score tiles).
 * Leaflet auto-creates a bottom-right attribution control unless `attributionControl:false` is
 * passed — that control's own z-index was never coordinated with `BottomSheet.jsx`'s (`zIndex:
 * 700`), so it painted over the sheet content. THE LICENCE REQUIREMENT IS NOT NEGOTIABLE — OSM
 * data is ODbL-licensed and CARTO's/Esri's tile terms both require visible attribution, so this
 * is never simply deleted. Fix: `attributionControl:false` at construction, replaced with this
 * file's OWN React-rendered control — a collapsed circular "i" affordance (the standard pattern
 * every commercial map uses) that expands the CURRENT basemap's real credit text (still sourced
 * from `STREET_TILES.attribution`/`SATELLITE_TILES.attribution`, never re-typed) into the map
 * area on tap. Owner amendment, verbatim, after seeing the first pass just shrink it in place at
 * the bottom-right corner: "we can relocate it then because it's kinda getting in the way of the
 * stuff that's at the bottom" — the bottom is the sheet's territory now, permanently, so the
 * control moved to the TOP-right, tucked directly under the Satellite/Street toggle, where
 * nothing else on this screen competes. Dropping Leaflet's own "Leaflet |" prefix falls out for
 * free — that text was Leaflet's own control's default `prefix` option, never anything this file
 * wrote; building a plain React element instead never had a prefix to drop.
 * SAME SWEEP, THE "SEARCH LIVE FOR MORE HERE" PILL: bottom-centre, same collision risk with the
 * sheet at every snap point on a phone. Rather than track the sheet's own live height (a moving
 * target, and the exact kind of continuous-position-syncing this repo's VIEWPORT-STABLE rule
 * warns against reaching for when a static placement solves it just as well), it moves to a
 * fixed TOP position on `useNarrowViewport()`, comfortably inside the space `BottomSheet.jsx`'s
 * own `TOP_INSET` already guarantees stays clear of the sheet at every snap including "full" —
 * desktop (a right-rail panel, never covering the bottom) is untouched.
 * ⛔ SUPERSEDED by NEW-1 (2nd owner block, 2026-08-23) below — the pill moved back to the bottom,
 * consolidated with the two zoom/capped notices, and now DOES track the sheet's live height.
 * VIEWPORT-STABLE's "prefer static when it solves it just as well" still holds in general; it
 * just no longer applies here, because a BOTTOM placement genuinely can't be statically clear of
 * a sheet whose own height is content- and drag-driven — unlike the TOP placement above, which
 * had an actual static guarantee (`TOP_INSET`) to lean on.
 *
 * ⛔ B681520 (×2) — RECURRENCE, two owner corrections. (1) SCOPE: "I'm fine with the full credit
 * showing in the bottom-right on desktop... the busy-and-in-the-way complaint was always about
 * mobile. He also said the icon does not have to be an 'i' at all." The collapse-to-a-toggle
 * pattern above was applied to EVERY viewport width; it should only ever have applied to mobile,
 * where the bottom sheet actually crowds the screen — desktop has room, nothing collides there,
 * and a fully visible credit is also the more conservative reading of the licence. Fix: desktop
 * (`!narrowViewport`) now renders a plain, small, muted, ALWAYS-VISIBLE text line bottom-right —
 * never collapsed; only mobile keeps the collapsed toggle+panel, moved from a fixed top offset to
 * `ATTRIBUTION_TOGGLE_TOP`/`ATTRIBUTION_TOGGLE_SIZE` (see below). (2) THE ICON WAS VISUALLY
 * BROKEN — owner's own live DOM measurement of the shipped build (not a report he was relaying):
 * 28x28, flex-centred, a literal `fontStyle: "italic"` "i" character. Off-centre on BOTH axes BY
 * CONSTRUCTION: horizontally, an italic lowercase "i" leans its ink right of its own glyph advance
 * width, so centring the character's BOX does not centre what the eye sees; vertically, flex
 * centring centres the LINE BOX, which reserves descender space a no-descender glyph like "i"
 * never uses, so the ink sits high. Neither is fixable by nudging padding — both are properties of
 * the CHARACTER, not the button. Fix: `InfoGlyph` (below) — a plain inline SVG (a centred dot +
 * rounded stem, not a font character) whose ink is centred in its own viewBox on both axes, so
 * centring the SVG element genuinely centres what renders. Also brought the box itself up to the
 * 44x44 minimum touch target this module already adopted elsewhere (`TOUCH_MIN_TAP_RADIUS`,
 * B668193) — the old 28x28 was below it.
 *
 * ⛔ "WANT TO TRY" (B669312, owner chat block, 2026-08-22: "flag places he has not been to yet, so
 * the map doubles as a shortlist"). A flagged-but-unvisited place/pin draws HOLLOW (a coloured
 * ring, no fill — see `addHollowPin` and `COLORS.wishlist`) rather than the filled dot every
 * visited/rated state uses, so it never competes with the 1-10 rating ramp for meaning. Drawn in
 * the SAME "his own places" section as `loggedPlaces`/`manualPins` — outside the `tooSmall` gate —
 * so a shortlist stays visible at the zoom it's actually useful for; FoodApp excludes anything
 * already visited before it ever reaches this file, so "flagged and visited" never renders twice.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { colorForRating } from "../lib/ratingColor.js";
import { RADIUS } from "../../../shared/ui/radius.js";

// ⛔ B811520 — CARTO STARTED WATERMARKING KEYLESS VOYAGER TILES ("API KEY REQUIRED", stamped
// diagonally across the map, owner screenshot 2026-08-27). The tiles still return HTTP 200 —
// confirmed live, `image/png` — so this is CARTO changing its keyless-usage terms, not an outage
// to wait out, and it will not clear on its own. The owner's constraint is unchanged and
// non-negotiable: zero cost, no CARTO account of any kind, free tier included ("a free tier that
// requires an account is a bill waiting to happen"). Fix: moved to Esri's `World_Topo_Map`, on
// the SAME `server.arcgisonline.com` host `SATELLITE_TILES` below already uses — no new
// dependency, no new attribution relationship, no new failure mode. Same axis-order trap as
// satellite (`{z}/{y}/{x}`, y before x — opposite of Leaflet's own default, and exactly what
// crashed the satellite toggle the first time it was built, see B634981 below) and the same
// no-`subdomains`-key rule.
// PICKED World_Topo_Map OVER World_Street_Map, checked against a real dense-Houston tile with
// synthetic pins overlaid at every rating-ramp colour (not just eyeballing the bare basemap):
// World_Street_Map's interstate shields and saturated orange/red arterial-road styling visually
// competed with the SAME orange/red end of the pin colour ramp (`ratingColor.js`) and the manual-
// pin orange (`COLORS.manual`) — a red pin and a red highway shield read as the same kind of mark
// at a glance. World_Topo_Map keeps genuine colour (soft greens/tans, not the grey the owner
// rejected in the B168/NEW-5 header note below) while roads render as plain, muted grey/white
// lines with no shields — the SAME "quiet roads, real colour" balance Voyager was originally
// chosen for. `maxZoom`/`maxNativeZoom` mirror `SATELLITE_TILES` below (confirmed live: Esri
// serves genuine, non-extrapolated detail for Houston through z19). No `url1x` — Esri's tile URLs
// have no `{r}` retina token to begin with, same as satellite already had no retina variant.
const STREET_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 21, maxNativeZoom: 19,
  // Esri's own published credit for World_Topo_Map (`?f=json`'s `copyrightText`) lists many
  // upstream data sources, INCLUDING OpenStreetMap contributors as one of several inputs baked
  // into Esri's own composite basemap — that is Esri's credit to make, not a standalone OSM
  // relationship this app now has (it fetches no OSM tiles directly). Shortened to the same
  // convention `SATELLITE_TILES.attribution` below already uses for Esri's own longer imagery
  // credit list, not the full multi-line string.
  attribution: "&copy; Esri, HERE, Garmin, and the GIS User Community",
};
// ⛔ FALLBACK, DOCUMENTED BUT NOT WIRED IN — if Esri ever does what CARTO just did (starts
// watermarking or otherwise degrading keyless usage), the next keyless option is OpenStreetMap's
// own standard tiles (`tile.openstreetmap.org`, confirmed live 2026-08-27: HTTP 200, ~38.9 KB/
// tile at Houston, no key). Kept as a fallback, not a first choice, because OSM's own tile usage
// policy (operations.osmfoundation.org/policies/tiles) discourages heavy automated/production use
// of that specific server — it's a volunteer-funded service, not a CDN meant for this. Reach for
// it only if BOTH CARTO and Esri stop working keyless:
//   const OSM_FALLBACK_TILES = {
//     url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19,
//     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
//   };
// Esri World Imagery — mirrors the Site Planner's own layer verbatim (MapFinder.jsx), including
// maxZoom 21 with maxNativeZoom 19 (upscale past Esri's native ceiling rather than hard-refuse),
// and NO `subdomains` key at all — see the B634981 header comment for why an explicit
// `subdomains: undefined` (a single ArcGIS host has none) is what crashed this the first time.
const SATELLITE_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 21, maxNativeZoom: 19,
  attribution: "Imagery &copy; Esri, Maxar",
};
// Faint road/place labels, overlaid ONLY in satellite mode (owner: "a satellite view with no
// street labels is much harder to navigate") — same source + same opacity the planner already
// uses for the identical reason.
const LABELS_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 21, maxNativeZoom: 19, opacity: 0.4,
};

// Houston, so a first-ever visit opens somewhere useful rather than on the world map.
const DEFAULT_CENTER = [29.76, -95.37];
const DEFAULT_ZOOM = 12;

// ⛔ MIN_PIN_ZOOM (corrected 2026-08-19, B623728 recurrence — read before nudging this constant again).
// Shipped at 12 first, which is STILL the whole-metro view: measured against a typical
// 1440px-wide browser window centred on Houston, z12 shows ~30 miles across (Katy toward
// Baytown, exactly the view the owner screenshotted and rejected twice) and the reference
// snapshot query already returns 13,000-22,000+ matches there — so the "only his own places
// at low zoom" rule NEVER actually engaged at the zoom people look at Houston from by default.
// Below this now-corrected value, only HIS OWN places draw; the reference snapshot doesn't.
//
// Chosen at 15, not nudged — MEASURED against Houston's own density, not guessed:
//   - Ground scale is zoom-level-intrinsic (independent of any one screen's pixel width):
//     at z12, 1 screen px covers ~33 m at this latitude; at z15, ~4 m — z15 is the first
//     zoom where a city block reads as more than a few pixels, the "neighbourhood you could
//     actually drive to and recognise" scale, not "half the metro."
//   - On a 1440px-wide window, z15 shows ~3.7 miles across — comparable to a single named
//     Houston neighbourhood (the Heights, Montrose), not several stitched together (z14, the
//     next step down, is already ~7.4 miles — multiple neighbourhoods at once).
//   - THE STRONGEST reason: at z15, even DOWNTOWN/MIDTOWN — the single densest food_places
//     cluster in the whole metro — returns only 1,251 places, comfortably under the RPC's
//     2,000 cap (measured directly against production). At z14 the same box already returns
//     2,641 — OVER the cap. So z15 is the tightest zoom where the reference snapshot is
//     GENUINELY COMPLETE everywhere in the metro, never sampled, not even in the one place
//     dense enough to matter — no proportional-share algorithm needed to be "fair" once
//     nothing is ever left out to begin with.
const MIN_PIN_ZOOM = 15;

// Literal (not theme tokens) DELIBERATELY: these are Leaflet canvas-renderer fill/stroke
// values, not CSS applied to a DOM element — a canvas 2D context has no cascade to resolve
// var(--x) against, so a token here would just paint as the literal string "var(--accent)".
// Same reasoning as the Notes toolbar's content palette (see its header). `logged`/`manual` are
// the FALLBACK for a place he's visited but not yet rated — a RATED place uses colorForRating's
// 1-10 ramp instead (see lib/ratingColor.js), so "the colour means something" rather than being
// decoration (owner redesign, 2026-08-18).
const COLORS = {
  unlogged: "#8a8f98",
  logged: "#1D9E75",
  manual: "#E2572B",
  // "Want to try" (B669312) — a cool blue, deliberately outside the warm cream->deep-red-brown
  // 1-10 rating ramp (lib/ratingColor.js) and distinct from manual's warm orange, so a hollow
  // wishlist ring can never be mistaken for a rated step. Drawn HOLLOW (see addHollowPin below),
  // never filled — visited places keep the rating ramp untouched (owner: "do not touch that
  // scale"); a flagged-and-visited place never gets this treatment at all (FoodApp already
  // excludes it from wishlistPlaces/wishlistManualPins).
  wishlist: "#3B7DDE",
};

// Matches VisitPanel's own literal width (`position: absolute`, `width: 340`) — the pixel
// amount the panel-aware fly-to offset shifts the pan by. Duplicated as a literal for the same
// canvas/no-cascade reason as COLORS above, and because sharing it would mean importing across
// two components for one number — not worth a new shared-constants module for this module's size.
const PANEL_WIDTH = 340;
// --accent-food, literal for the same canvas reason as COLORS — ties the selected pin's ring
// and halo to the panel's own accent dot (VisitPanel.jsx), "the eye connects them."
const SELECTED_ACCENT = "#BE3B22";

function boundsOf(map) {
  const b = map.getBounds();
  return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
}

// Above MIN_PIN_ZOOM so a search result reliably lands somewhere the reference snapshot
// already draws — "arrived at this one restaurant" scale, not just "past the threshold."
const FLY_TO_ZOOM = 16;

// B651872 (×3) — fixed flyTo duration, MEASURED to match what a same-neighbourhood jump already
// takes naturally (Leaflet's own distance-based formula gives ~1.6s there) so a local search
// feels unchanged; a cross-metro/city/country jump would otherwise balloon to several seconds
// (measured: ~4.2s Houston->Austin, ~7.8s Houston->Maui) while the animation sweeps through
// every intermediate integer zoom level along the way. See the header comment for the full trace.
const FLY_DURATION_SEC = 1.5;

// B651872 (×4) — real-world distance (metres) beyond which a search-select jump goes straight to
// the destination (map.setView, no animation) instead of flyTo. MEASURED, not guessed: reimplementing
// flyTo's own zoom curve and finding the minimum zoom each jump sweeps down to
// (.scratch-repro/measure-zoom-depth.html) — same-metro (~48km) only dips ~0.3 zoom levels,
// negligible; 235km+ dips 2+ levels and keeps growing. 100km sits cleanly between the two.
const LONG_JUMP_METERS = 100_000;

// B668193 — the minimum tap-target RADIUS on a coarse (touch) pointer, in screen px. 22 gives a
// 44px-diameter target, the common minimum touch-target guideline, regardless of how small the
// pin itself is drawn (5-7px radius) — a hit-test allowance only, never applied to the drawn
// circle, so the map's visual density is unaffected.
const TOUCH_MIN_TAP_RADIUS = 22;

// NEW-1 (2nd owner block) — the gap between the bottom-anchored notice/search stack and whatever
// its floor is: the mobile sheet's live top edge (sheetHeightPx) or the plain viewport bottom (0).
const BOTTOM_STACK_GAP = 12;

// B681520 (×2) — the mobile attribution toggle's own touch target (see the render below for why
// 44 rather than the old 28): a real circle, not just a hit-test allowance like
// TOUCH_MIN_TAP_RADIUS above (that one widens invisible canvas hit-testing without changing what's
// drawn; this button IS the drawn thing, so its box itself is 44x44).
const ATTRIBUTION_TOGGLE_SIZE = 44;
// Directly under the basemap toggle (top:12, ~30px tall) with a real gap — never the bottom edge.
const ATTRIBUTION_TOGGLE_TOP = 54;

// Mirrors AppHeader.jsx's `useNarrow` pattern: a reactive `matchMedia` read, no touch/mouse
// event guessing. `pointer: coarse` is true for a touch-primary device (no hover) and false for
// a mouse/trackpad, which is the actual distinction that matters here — screen WIDTH is not (a
// touch-capable laptop is still precise; a narrow desktop window is still a mouse).
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() => {
    try { return window.matchMedia("(pointer: coarse)").matches; } catch (_) { return false; }
  });
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(pointer: coarse)"); } catch (_) { return undefined; }
    const on = () => setCoarse(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  return coarse;
}

// The same breakpoint VisitPanel.jsx already uses for its own bottom-sheet-vs-right-rail switch
// — reused verbatim rather than picking a second number, so the whole module agrees on what
// "mobile" means (VisitPanel.jsx's own comment on this exact reasoning).
const NARROW_BREAKPOINT = "(max-width: 760px)";

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(() => {
    try { return window.matchMedia(NARROW_BREAKPOINT).matches; } catch (_) { return false; }
  });
  useEffect(() => {
    let mq; try { mq = window.matchMedia(NARROW_BREAKPOINT); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  return narrow;
}

// B681520 (×2) — a hand-drawn "i" glyph whose ink is centred in its own 24x24 viewBox on BOTH
// axes, replacing the old text "i" character (see the render below for the owner's exact live
// measurement of why an italic text glyph can never be centred by nudging padding). A dot + a
// rounded stem, deliberately not a font character — nothing here depends on any font's metrics.
// MODULE-SCOPE-COMPONENTS: defined here, not inside FoodMap's render body.
function InfoGlyph({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="12" cy="7.6" r="1.6" />
      <rect x="10.4" y="10.4" width="3.2" height="7.6" rx="1.6" />
    </svg>
  );
}

export default function FoodMap({
  places, placesCapped, placesTotalMatched, loggedPlaces, loggedIds, manualPins,
  wishlistPlaces, wishlistManualPins, overpassPlaces,
  onSelectPlace, onSelectManualPin, pinMode, onDropPin, onViewChanged, onRequestSearchHere,
  flyToTarget, selectedKey, selectedPlaceInfo, sheetHeightPx = 0,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const labelsLayerRef = useRef(null);
  // B668193 — every currently-drawn pin's {lat, lon, radius, onClick}, rebuilt on every marker
  // redraw pass; consumed only by the coarse-pointer click resolver below (a plain ref because a
  // click is read at event time, not something the resolver effect needs to re-subscribe over).
  const pinIndexRef = useRef([]);
  const [tooSmall, setTooSmall] = useState(false);
  const [basemap, setBasemap] = useState("street"); // "street" | "satellite"
  const [basemapError, setBasemapError] = useState(false);
  // B651872 (×4) — tied to the CURRENT tile layer's own 'loading'/'load' events (basemap effect
  // below); drives the "Loading imagery…" pill so a genuinely-in-progress screen never reads as
  // simply broken.
  const [tilesLoading, setTilesLoading] = useState(false);
  // B681520 — the attribution credit panel's open/closed state; the CONTENT it shows is computed
  // fresh from `basemap` on every render, so leaving it open across a basemap toggle just shows
  // the newly-current credit, never a stale one.
  const [attributionOpen, setAttributionOpen] = useState(false);
  const coarsePointer = useCoarsePointer();
  const narrowViewport = useNarrowViewport();

  // Mount once. The tile layer itself is NOT created here — see the basemap effect below —
  // so toggling satellite never tears down/recreates the map, the marker layer or its handlers.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;
    // B651872 (×2) — fadeAnimation:false, see the header comment: Leaflet's own tile fade-in was
    // freezing partway after a search-select flyTo, and the owner's explicit direction was to
    // remove the animation rather than patch around a still-broken fade loop.
    // B681520 — attributionControl:false: Leaflet's own default control is replaced below (this
    // file's React-rendered credit affordance), see the header comment.
    // B651872 (×5) — trackResize:false. Leaflet's OWN default (`trackResize:true`) independently
    // binds `window`'s 'resize' event straight to `this.invalidateSize({debounceMoveend:true})` —
    // no `pan:false`, and no way to pass it one. REPRODUCED live: with the mount effect's
    // ResizeObserver already fixed to `pan:false` below, the grey band still appeared, because
    // Leaflet's own untouched window-resize handler ran too and re-applied the bad half-delta pan.
    // trackResize's job is now fully superseded by that ResizeObserver, which watches the actual
    // host container (not just `window`) and calls invalidateSize with the correct `pan:false` for
    // this always-top-anchored layout — see its comment for the full mechanism and measurement.
    const map = L.map(hostRef.current, {
      center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true, fadeAnimation: false, attributionControl: false,
      trackResize: false,
    });
    const canvasRenderer = L.canvas();
    layerRef.current = L.layerGroup([], { renderer: canvasRenderer }).addTo(map);
    mapRef.current = map;

    const report = () => {
      setTooSmall(map.getZoom() < MIN_PIN_ZOOM);
      onViewChanged?.(boundsOf(map));
    };
    map.on("moveend", report);
    report();

    // B651872 (×5) — nothing else in this file ever tells Leaflet the CONTAINER's own size
    // changed outside of the flyTo/setView effect below (a search-select). A device rotation or
    // an iOS Safari dynamic-toolbar resize at any OTHER moment would leave Leaflet's cached size
    // stale with nothing to correct it. Call invalidateSize the INSTANT the container's real size
    // changes, not on a timer.
    // `pan: false` — REPRODUCED live (real Playwright `devices['iPhone 14 Pro']` context, real
    // dev build, real `100dvh` CSS): growing the real viewport height by 120px (simulating
    // Safari's chrome collapsing, or a rotation — index.css:379's `100dvh` genuinely resizes
    // `#root`, and this host's own real `getBoundingClientRect().top` never moved, confirmed
    // 122->122) left `.leaflet-map-pane`'s transform at `translate(0, 60px)` afterward — Leaflet's
    // DEFAULT `invalidateSize` pans by HALF the size delta (`oldCenter.subtract(newCenter)`,
    // `leaflet-src.js`'s own `invalidateSize`), which assumes the resize is symmetric around the
    // container's centre. This app's layout never is: the fixed-height `AppHeader` sits above a
    // `flex:1, minHeight:0` map host, so the host's top-left edge is permanently anchored and only
    // its BOTTOM edge moves — exactly what a `100dvh` change or a rotation does here. The
    // half-delta pan shifts already-rendered tiles inside a container whose own top edge never
    // moved, which is the "clean horizontal line, grey on top" the owner described: the pane's new
    // top lands inside the container with nothing painted above it. `pan: false` leaves the pane
    // exactly where it is — correct for a top-anchored container — and lets GridLayer's own
    // moveend/resize handling fill in the newly-revealed area with real tiles, same as any other
    // pan-free resize. See `.scratch-repro/verify-grey-band-real.mjs` for the full repro/measurement.
    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false, pan: false }));
      resizeObserver.observe(hostRef.current);
    }

    return () => { resizeObserver?.disconnect(); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap tile layer — swapped whole on toggle (see header comment for why not `setUrl`).
  // React runs this effect's cleanup (removing the PREVIOUS tile layer) before re-running the
  // body on a `basemap` change, so there is never a moment with two tile layers stacked.
  //
  // ⛔ B634981 — WRAPPED IN TRY/CATCH ON PURPOSE. A bad tile-layer config (this file's own crash,
  // see the header comment) must degrade to "Imagery unavailable" rather than throwing out of a
  // useEffect and taking the whole module down through the workspace error boundary — a basemap
  // toggle is never worth losing the map, the pins, and every other feature on this route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const source = basemap === "satellite" ? SATELLITE_TILES : STREET_TILES;
    // B811520 — both sources are Esri now, and Esri's tile URLs carry no {r} retina token, so
    // there is no narrow-viewport 1x/2x gate left to apply (the old CARTO street layer's own
    // url1x is gone — see STREET_TILES's header comment).
    const url = source.url;
    const layers = [];
    let onLoading, onLoad, loadingLayer;
    try {
      // `subdomains` is only added to the options object when the source actually declares one —
      // never pass an explicit `subdomains: undefined`, which clobbers Leaflet's own internal
      // default and is exactly what crashed this the first time (see the header comment).
      const opts = { maxZoom: source.maxZoom, attribution: source.attribution };
      if (source.subdomains) opts.subdomains = source.subdomains;
      if (source.maxNativeZoom) opts.maxNativeZoom = source.maxNativeZoom;
      const layer = L.tileLayer(url, opts).addTo(map);
      layer.bringToBack(); // stays under the marker layer regardless of add order
      tileLayerRef.current = layer;
      layers.push(layer);

      // B651872 (×4) — the loading-treatment pill (below in the render), tied to THIS layer's
      // own lifecycle so it never reports stale state from a previous (torn-down) basemap.
      loadingLayer = layer;
      onLoading = () => setTilesLoading(true);
      onLoad = () => setTilesLoading(false);
      loadingLayer.on("loading", onLoading);
      loadingLayer.on("load", onLoad);
      setTilesLoading(loadingLayer.isLoading());

      if (basemap === "satellite") {
        const labelsLayer = L.tileLayer(LABELS_TILES.url, {
          maxZoom: LABELS_TILES.maxZoom, maxNativeZoom: LABELS_TILES.maxNativeZoom, opacity: LABELS_TILES.opacity,
        }).addTo(map);
        labelsLayerRef.current = labelsLayer;
        layers.push(labelsLayer);
      } else {
        labelsLayerRef.current = null;
      }
      setBasemapError(false);
    } catch (err) {
      console.error("FoodMap: basemap tile layer failed to mount", err);
      setBasemapError(true);
    }
    return () => {
      if (loadingLayer) { loadingLayer.off("loading", onLoading); loadingLayer.off("load", onLoad); }
      setTilesLoading(false);
      for (const layer of layers) { try { map.removeLayer(layer); } catch (_) { /* already gone */ } }
    };
  // B811520 — narrowViewport dropped from the deps: it was only ever read for the now-gone
  // url1x gate above. Keeping it here would re-tear-down and rebuild the tile layer on every
  // viewport-width crossing for no reason (Esri's tile URL never varies by viewport width).
  }, [basemap]);

  // ⛔ B842528 (2026-08-28) — REVERTED: continuous marker scaling during a zoom animation
  // (B707841/NEW-2, 2026-08-23) is REMOVED. It drew markers at WRONG geographic positions during
  // an active zoom, not just the wrong SIZE it was built to fix.
  //
  // OWNER REPORT: "when I zoom in or out on mobile or desktop the markers jump oddly" — a pin
  // rendered well southeast of Austin, toward Houston, with no real place there; his eleven real
  // Austin-area visits (queried live against production) span 0.033° of latitude and should
  // collapse to a single dot at a whole-Texas zoom, not scatter. Later clarified: he captured this
  // MID-PINCH, not at rest.
  //
  // ROOT CAUSE, traced into Leaflet's own source, then MEASURED — not stopped at the theory.
  // `CircleMarker.setRadius()` (what the old per-frame compensation loop called every frame to
  // counteract the ambient CSS scale) is NOT radius-only: it calls `redraw()` ->
  // `Canvas.prototype._updatePath()`, which unconditionally calls `layer._project()` — RECOMPUTING
  // the marker's screen position from the map's CURRENT (already-jumped-to-final) zoom — before
  // repainting. That reprojected, ALREADY-CORRECT position then gets the renderer's own ambient
  // CSS transform applied ON TOP of it (Leaflet's `Renderer._onAnimZoom` re-applies that transform
  // on every 'zoomanim' frame too, computed from the RENDERER's last fully-settled zoom/centre) —
  // a genuine double transform. Confirmed with real, ground-truth pixel measurement
  // (`.scratch-repro/verify-marker-position.mjs`, a real headless build, real Leaflet, synthetic
  // markers at the owner's real Austin cluster plus Dallas/San Antonio test points at different
  // distances from Houston — his selected place and the map's default centre): drawn marker
  // position vs `map.latLngToContainerPoint()` for the same lat/lon, sampled DURING real animated
  // zooms (both the +/- control buttons and a real multi-touch pinch via CDP). Mid-animation
  // deltas of 100-300px+ while the container's live `getComputedStyle().transform` was non-
  // identity, and — the distance signature the owner's own hypothesis named — the farther test
  // point (Dallas) consistently showed a LARGER error than the closer one (San Antonio) at
  // matching sample times. After the gesture fully settles, the SAME markers measured within
  // ~1px of correct — so this was a mid-animation-only artifact, not a resting-state one, but a
  // real one: a tap during that window could open the wrong place's panel.
  //
  // THE FIX, per the owner's own explicit instruction ("Michael would rather have a pin that pops
  // than a pin that lies"): revert to transform-then-settle. Markers are no longer touched at all
  // during the animation — Leaflet's own ambient CSS transform alone carries them smoothly from
  // frame to frame (visually correct, since the transform's whole job is to make an unmodified,
  // still-correctly-positioned bitmap track the new view), and they settle to their true radius
  // and position in ONE step the instant Leaflet's own `zoomend`/`_reset()` runs — exactly
  // Leaflet's stock, unmodified CircleMarker behaviour. The "pop" B707841 set out to smooth away
  // is back; a wrong resting *position* never existed and a wrong *size* mid-animation is a
  // correctness-neutral cosmetic regression, not a new defect. `lib/zoomAnimTier.js` (the now-
  // unused perf-degrade state machine) and `readContainerScale` are deleted along with this
  // effect, rather than left disabled-but-present — dead, unreachable code that already caused
  // one confirmed correctness bug is not something to leave for a future session to rediscover.
  //
  // A "reproject every frame AND neutralise the stale ambient transform on the frames that do"
  // fix was considered — it would have kept the smooth sizing — but its correctness depends on
  // getting the interaction with the existing skip-frame/bail perf-degrade tiers exactly right in
  // every case, which could not be fully verified in the time available; the risk of a new, subtler
  // position bug outweighed the polish this session, so the plain revert is what shipped.

  // Search or list result selected — fly to it, offset so it lands centred in the area the user
  // can actually SEE (see header comment: the detail panel covers roughly the right third).
  // Keyed on flyToTarget.nonce (not just lat/lon) so re-selecting the SAME result twice in a row
  // still flies — two identical lat/lon values wouldn't otherwise re-trigger a dependency-array
  // effect.
  //
  // ⛔ B651872 — WHY A HARD RESET FOLLOWS EVERY flyTo (owner report: the map painted flat grey
  // the instant a search result landed, until one manual zoom/pan click). Traced into Leaflet's
  // own source (GridLayer + Map.flyTo), not guessed:
  //   1. `GridLayer._updateLevels()` only computes a zoom level's pixel `origin` the FIRST time
  //      that level is created — never again while the level object survives. `flyTo`'s own
  //      animation frame loop can create the destination zoom's level mid-flight (or reuse one
  //      created long before this flight even started, for a same-zoom hop), baking `origin`
  //      from a not-yet-settled camera position.
  //   2. `GridLayer._onMoveEnd` no-ops entirely while `map._animatingZoom` is true — a flag
  //      `flyTo()` never checks or waits for, unlike `setView`, which calls `_stop()` first.
  //      A zoom gesture (wheel/+−/double-click) still finishing when a search result is picked
  //      can leave that flag set into the flyTo, silently dropping the tile-grid update.
  // Both are races only `flyTo` can hit (a direct pin click never moves the camera; a manual
  // zoom/pan is exactly what "fixes" it live, because `setView`'s non-animated path forces a
  // full `_resetView`). Rather than chase each race individually, force the SAME hard reset a
  // manual interaction gets, once, when the flight settles: `setView(sameCenter, sameZoom,
  // {reset:true})` fires Leaflet's own 'viewprereset' → 'viewreset' pair, which wipes every
  // cached tile level and rebuilds it fresh from the truly-final view — no polling, no interval,
  // one call per selection. `invalidateSize()` alongside it is belt-and-braces for the case the
  // container itself was resized while off-screen (Leaflet never learns of a resize on a hidden
  // element). Verified in an isolated Leaflet harness (real img tileLayer, real async tile
  // loads, long + short hops, concurrent marker redraws) that this never errors, never loops,
  // and doesn't meaningfully change tile request volume — see the session's repro notes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget) return;
    const targetZoom = Math.max(map.getZoom(), FLY_TO_ZOOM);
    // Standard Leaflet pixel-offset-pan pattern: project the target at the destination zoom,
    // shift it RIGHT by half the panel's width, then unproject back — flying to that shifted
    // point puts the ORIGINAL target left-of-true-centre by the same amount, i.e. dead centre of
    // the visible (unobstructed) region. Clamped to 40% of the map's own width so a narrow/phone
    // viewport (where the panel can approach the map's full width) never shifts the target off
    // the visible area entirely in the other direction.
    const containerWidth = map.getSize().x;
    const panelOffsetPx = Math.min(PANEL_WIDTH, containerWidth * 0.8) / 2;
    const targetPoint = map.project([flyToTarget.lat, flyToTarget.lon], targetZoom);
    const shiftedLatLng = map.unproject(targetPoint.add([panelOffsetPx, 0]), targetZoom);

    // B651872 (×4) — beyond LONG_JUMP_METERS, skip the animation entirely: setView with
    // animate:false goes straight through Leaflet's own hard-reset path (_resetView, the SAME
    // one the short-jump branch below forces manually), so the destination's own tiles are the
    // FIRST thing requested, not the last — no intermediate-zoom sweep, no wasted fetches
    // competing with them for the connection pool. See the header comment for the measured cost
    // this removes and how the threshold was chosen.
    const jumpMeters = map.distance(map.getCenter(), shiftedLatLng);
    if (jumpMeters > LONG_JUMP_METERS) {
      // pan:false — see the mount effect's ResizeObserver comment (B651872 x5): this host is
      // always top-anchored, never symmetric, so Leaflet's default half-delta pan compensation is
      // never the right model here, even when the following setView immediately supersedes it.
      map.invalidateSize({ animate: false, pan: false });
      map.setView(shiftedLatLng, targetZoom, { animate: false });
    } else {
      map.once("moveend", () => {
        map.invalidateSize({ animate: false, pan: false });
        map.setView(map.getCenter(), map.getZoom(), { reset: true, animate: false });
      });
      // B651872 (×3) — fixed duration, not Leaflet's own distance-proportional default; see
      // FLY_DURATION_SEC and the header comment.
      map.flyTo(shiftedLatLng, targetZoom, { duration: FLY_DURATION_SEC });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.nonce]);

  // Drop-a-pin mode: next map click reports its lat/lon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!pinMode) return undefined;
    const onClick = (e) => onDropPin?.(e.latlng.lat, e.latlng.lng);
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [pinMode, onDropPin]);

  // Redraw markers whenever the data (or the zoomed-in/out threshold) changes. Individual
  // circleMarkers reposition themselves with the map automatically, so — unlike a clustered
  // view — nothing here needs to run again on a plain pan/zoom with unchanged data.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    // Wider white keyline on satellite — see the header comment on PIN LEGIBILITY ON IMAGERY.
    const strokeWeight = basemap === "satellite" ? 3 : 2;
    // B668193 — rebuilt every pass; the coarse-pointer click resolver (below) reads this by ref.
    pinIndexRef.current = [];
    // B651872 (×3) — set true the moment ANY loop below draws the selectedKey-matching pin, so
    // the fallback pass at the end can tell whether it still needs to draw one. See the header
    // comment: a place selected via search but not yet in the bounds-scoped snapshot would
    // otherwise have no pin at all until that snapshot refetches.
    let selectedDrawn = false;
    const addPin = (lat, lon, color, title, onClick, opts = {}) => {
      const isSelected = opts.key != null && opts.key === selectedKey;
      if (isSelected) selectedDrawn = true;
      const baseRadius = opts.radius ?? 7;
      // Selected: noticeably larger, an accent-coloured ring (never the plain white every other
      // state uses), PLUS a soft halo behind it — unmistakable at a glance, distinct from both
      // the unrated-neutral and the rated-colour states (owner, 2026-08-19).
      if (isSelected) {
        L.circleMarker([lat, lon], {
          renderer: layer.options.renderer, radius: baseRadius + 12, weight: 0,
          fillColor: SELECTED_ACCENT, fillOpacity: 0.22, interactive: false,
        }).addTo(layer);
      }
      const drawnRadius = isSelected ? baseRadius + 5 : baseRadius;
      const m = L.circleMarker([lat, lon], {
        renderer: layer.options.renderer,
        radius: drawnRadius,
        weight: isSelected ? 4 : strokeWeight,
        color: isSelected ? SELECTED_ACCENT : "#fff",
        fillColor: color, fillOpacity: opts.fillOpacity ?? 0.95,
      });
      m.bindTooltip(title, { direction: "top", offset: [0, -6] });
      if (onClick) {
        // B668193 — on a coarse (touch) pointer, resolution happens centrally instead (the
        // resolver effect below), where a wider, nearest-centre-aware hit test replaces Leaflet's
        // own draw-order-wins canvas dispatch. A mouse/desktop pointer is completely untouched:
        // same per-marker listener, same zero tolerance, as before this item.
        if (coarsePointer) pinIndexRef.current.push({ lat, lon, radius: drawnRadius, onClick });
        else m.on("click", onClick);
      }
      m.addTo(layer);
    };

    // "Want to try" (B669312) — an outline/hollow ring, never a filled dot, so it can never be
    // confused with a rated (or flat logged/manual) place: the visited rating ramp stays
    // completely untouched. A soft white backing disc keeps the ring legible over dark satellite
    // imagery without becoming a fill itself — the RING colour is what says "want to try," same
    // principle as the selected-state halo above.
    const addHollowPin = (lat, lon, title, onClick, opts = {}) => {
      const isSelected = opts.key != null && opts.key === selectedKey;
      if (isSelected) selectedDrawn = true;
      const baseRadius = opts.radius ?? 7;
      if (isSelected) {
        L.circleMarker([lat, lon], {
          renderer: layer.options.renderer, radius: baseRadius + 12, weight: 0,
          fillColor: SELECTED_ACCENT, fillOpacity: 0.22, interactive: false,
        }).addTo(layer);
      }
      L.circleMarker([lat, lon], {
        renderer: layer.options.renderer, radius: baseRadius, weight: 0,
        fillColor: "#fff", fillOpacity: 0.35, interactive: false,
      }).addTo(layer);
      const m = L.circleMarker([lat, lon], {
        renderer: layer.options.renderer,
        radius: isSelected ? baseRadius + 5 : baseRadius,
        weight: isSelected ? 4 : strokeWeight + 1,
        color: isSelected ? SELECTED_ACCENT : COLORS.wishlist,
        fillColor: COLORS.wishlist, fillOpacity: 0,
      });
      m.bindTooltip(`${title} · want to try`, { direction: "top", offset: [0, -6] });
      // B668193 — the same coarse-pointer nearest-centre resolution as addPin's own pins; a
      // wishlist ring is exactly as small and exactly as easy to tap-miss on a phone.
      if (onClick) {
        const drawnRadius = isSelected ? baseRadius + 5 : baseRadius;
        if (coarsePointer) pinIndexRef.current.push({ lat, lon, radius: drawnRadius, onClick });
        else m.on("click", onClick);
      }
      m.addTo(layer);
    };

    // HIS places — always drawn, at every zoom, never hidden by the threshold below, always at
    // full size/opacity: they are the point of the map. A RATED place is coloured along the
    // 1-10 ramp so a glance shows where the good ones are; a visited-but-not-yet-rated place
    // falls back to the flat logged/manual colour.
    for (const p of loggedPlaces || []) {
      addPin(p.lat, p.lon, colorForRating(p.avgRating) || COLORS.logged, p.name, () => onSelectPlace?.(p), { key: `place:${p.id}` });
    }
    for (const pin of manualPins || []) {
      addPin(pin.lat, pin.lon, colorForRating(pin.avgRating) || COLORS.manual, pin.name, () => onSelectManualPin?.(pin), { key: `pin:${pin.name}` });
    }
    // Flagged-but-unvisited places/pins — FoodApp already excludes anything also visited, so
    // there's never a double-draw here. Survives the zoomed-out gate below (drawn here, outside
    // the tooSmall-gated block further down) — a shortlist has to be visible at the zoom it's useful.
    for (const p of wishlistPlaces || []) {
      addHollowPin(p.lat, p.lon, p.name, () => onSelectPlace?.(p), { key: `place:${p.id}` });
    }
    for (const pin of wishlistManualPins || []) {
      addHollowPin(pin.lat, pin.lon, pin.name, () => onSelectManualPin?.(pin), { key: `pin:${pin.name}` });
    }

    // The reference snapshot — a lookup table he reaches into once zoomed to a neighbourhood,
    // never metro-wide content. loggedIds excludes places already drawn above. Deliberately
    // SMALLER and more TRANSPARENT than his own places (owner note, 2026-08-18: make sure the
    // unrated pin style isn't itself a flat grey blob at density) — a quieter background layer
    // that still reads as "considered" where it overlaps, rather than a uniform solid mass, and
    // never competes with his own places for attention.
    const REFERENCE_PIN = { radius: 5, fillOpacity: 0.7 };
    if (!tooSmall) {
      for (const p of places || []) {
        if (loggedIds?.has(p.id)) continue;
        addPin(p.lat, p.lon, COLORS.unlogged, p.name, () => onSelectPlace?.(p), { ...REFERENCE_PIN, key: `place:${p.id}` });
      }
      for (const p of overpassPlaces || []) {
        if (loggedIds?.has(p.id)) continue; // already shown from the snapshot pass, avoid a double pin
        addPin(p.lat, p.lon, COLORS.unlogged, `${p.name} (live search)`, () => onSelectPlace?.(p), { ...REFERENCE_PIN, key: `place:${p.id}` });
      }
    }

    // B651872 (×3) — the selected place still has no pin (search-selected, never visited or
    // flagged, and the bounds-scoped snapshot above hasn't caught up to the new area yet): draw
    // one directly from the coordinates FoodApp already has, so the selection highlight always
    // has something to attach to. Once the snapshot refetches and includes it, `selectedDrawn`
    // flips true on the next pass and this fallback simply stops firing — never a double pin.
    if (selectedKey && !selectedDrawn && selectedPlaceInfo?.lat != null && selectedPlaceInfo?.lon != null) {
      addPin(
        selectedPlaceInfo.lat, selectedPlaceInfo.lon, COLORS.unlogged, selectedPlaceInfo.name,
        () => onSelectPlace?.({ id: selectedKey.slice("place:".length), lat: selectedPlaceInfo.lat, lon: selectedPlaceInfo.lon, name: selectedPlaceInfo.name }),
        { ...REFERENCE_PIN, key: selectedKey }
      );
    }
  }, [places, loggedPlaces, loggedIds, manualPins, wishlistPlaces, wishlistManualPins, overpassPlaces, tooSmall, basemap, selectedKey, selectedPlaceInfo, onSelectPlace, onSelectManualPin, coarsePointer]);

  // B668193 — the coarse-pointer nearest-centre tap resolver. Only ever registered on a coarse
  // pointer (desktop is untouched — no listener, no behaviour change); skipped while `pinMode` is
  // active so a tap on an existing pin can't also drop a new manual pin at the same spot (the
  // drop-a-pin effect above owns the click while that mode is on). Reads `pinIndexRef` fresh on
  // every tap, so it never goes stale even though this effect doesn't re-subscribe on every
  // marker redraw.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coarsePointer || pinMode) return undefined;
    const onClick = (e) => {
      const tapPoint = map.latLngToContainerPoint(e.latlng);
      let best = null, bestDist = Infinity;
      for (const cand of pinIndexRef.current) {
        const p = map.latLngToContainerPoint([cand.lat, cand.lon]);
        const dist = tapPoint.distanceTo(p);
        const limit = Math.max(cand.radius, TOUCH_MIN_TAP_RADIUS);
        if (dist <= limit && dist < bestDist) { bestDist = dist; best = cand; }
      }
      best?.onClick();
    };
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [coarsePointer, pinMode]);

  const showCappedNotice = !tooSmall && placesCapped;
  const hasOwnPlaces = (loggedPlaces?.length || 0) + (manualPins?.length || 0) + (wishlistPlaces?.length || 0) + (wishlistManualPins?.length || 0) > 0;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div ref={hostRef} data-testid="food-map" style={{ position: "absolute", inset: 0 }} />
      {/* NEW-1 (2nd owner block, 2026-08-23) — the zoom-gate notice, the capped notice, and
          "Search live for more here" used to be split between the TOP centre (the two notices)
          and a viewport-dependent position (the button — bottom on desktop, top on mobile since
          B681520). Owner: put them "in one consistent place, not scattered between the top and
          bottom of the map." All three now anchor to ONE bottom-centre stack, closest-to-edge
          item last, `BOTTOM_STACK_GAP` apart so however many of them are showing at once never
          overlap (`showCappedNotice`/`tooSmall` are already mutually exclusive; either can
          coexist with the search button, which is independent).
          TRACKS the mobile sheet's REAL top edge, not a static guess: `sheetHeightPx` is the
          BottomSheet's own live `heightPx` (peek/half/full, mid-drag alike — see
          BottomSheet.jsx's onHeightChange and FoodApp.jsx's threading of it), so the stack sits
          exactly `BOTTOM_STACK_GAP` above wherever the sheet's top edge actually is, including
          while it's being dragged — a static offset can't do that (the sheet's own height is
          content- and drag-driven, not a fixed number). Only relevant on a narrow viewport — the
          desktop right-rail panel never covers the bottom, so `sheetHeightPx` is ignored there
          even if a stale value briefly lingers across a breakpoint flip. */}
      <div
        style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)", zIndex: 500,
          bottom: (narrowViewport ? sheetHeightPx : 0) + BOTTOM_STACK_GAP,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          maxWidth: "calc(100% - 24px)", pointerEvents: "none",
        }}
      >
        {tooSmall && (
          <div data-testid="food-zoomed-out-notice" style={{
            pointerEvents: "auto",
            background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
            borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            textAlign: "center",
          }}>
            {hasOwnPlaces
              ? "Showing places you've been or want to try — zoom in to browse everywhere else"
              : "Zoom in to browse restaurants near you"}
          </div>
        )}
        {showCappedNotice && (
          <div data-testid="food-capped-notice" style={{
            pointerEvents: "auto",
            background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
            borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
          }}>
            Showing {places.length.toLocaleString()} of {placesTotalMatched.toLocaleString()} here — zoom in for more
          </div>
        )}
        {!tooSmall && onRequestSearchHere && (
          <button
            type="button" onClick={onRequestSearchHere} data-testid="food-search-here"
            style={{
              pointerEvents: "auto",
              border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, background: "var(--surface-raised)",
              color: "var(--text-primary)", font: "inherit", fontSize: 12.5, fontWeight: 700, padding: "7px 20px",
              cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            }}
          >
            Search live for more here
          </button>
        )}
      </div>
      {/* B651872 (×4) — a real loading treatment instead of leaving grey unexplained; tied to the
          CURRENT tile layer's own loading state (basemap effect above), so it clears itself the
          moment tiles finish, no timer. */}
      {tilesLoading && (
        <div data-testid="food-tiles-loading" role="status" style={{
          position: "absolute", top: 12, left: 12, zIndex: 500,
          background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}>
          Loading imagery…
        </div>
      )}
      {basemapError && (
        <div data-testid="food-basemap-error" role="status" style={{
          position: "absolute", top: 96, right: 12, zIndex: 500,
          background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 8, padding: "6px 10px", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}>
          Imagery unavailable
        </div>
      )}
      <button
        type="button" onClick={() => setBasemap((b) => (b === "satellite" ? "street" : "satellite"))}
        aria-pressed={basemap === "satellite"} data-testid="food-basemap-toggle"
        title={basemap === "satellite" ? "Switch to street map" : "Switch to satellite view"}
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 500,
          border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, background: "var(--surface-raised)",
          color: "var(--text-primary)", font: "inherit", fontSize: 12.5, fontWeight: 700, padding: "7px 18px",
          cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}
      >
        {basemap === "satellite" ? "Street" : "Satellite"}
      </button>
      {/* B681520 (×2) RECURRENCE — owner direction, verbatim: the collapse was never about
          desktop ("we can relocate it" was about the sheet, on mobile). "I'm fine with the full
          credit showing in the bottom-right on desktop... the busy-and-in-the-way complaint was
          always about mobile." Desktop has room and nothing collides there, and a fully visible
          credit is also the more conservative reading of the licence — so desktop gets a plain,
          always-visible, muted text line, never collapsed. Only a narrow (mobile) viewport keeps
          the collapsed toggle. */}
      {!narrowViewport && (
        <div
          data-testid="food-attribution-text" role="note"
          style={{
            position: "absolute", bottom: 6, right: 10, zIndex: 500, maxWidth: "calc(100% - 20px)",
            color: "var(--text-secondary)", fontSize: 10.5, lineHeight: 1.4, opacity: 0.85,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: 4, padding: "1px 7px",
          }}
          // Same trusted, hardcoded HTML this file already passes to Leaflet's own `attribution`
          // option — never user input, safe to render as HTML.
          dangerouslySetInnerHTML={{ __html: basemap === "satellite" ? SATELLITE_TILES.attribution : STREET_TILES.attribution }}
        />
      )}
      {narrowViewport && (
        <>
          {/* The icon fix, per the owner's own live measurement of the OLD build: a text "i"
              rendered italic reads off-centre on BOTH axes by construction — an italic lowercase
              "i" leans its ink right of its own advance width (so centring the glyph BOX doesn't
              centre what the eye sees), and flex-centring centres the LINE BOX, which reserves
              descender space a no-descender glyph like "i" never uses (so the ink sits high).
              Neither is fixable by nudging padding — both are properties of the character, not
              the button. Fix: a plain inline SVG (InfoGlyph, above) whose ink is centred in its
              own viewBox on both axes — nothing here depends on any font's metrics, so centring
              the SVG element centres what actually gets seen. Also brought up to the 44x44
              minimum touch target this module already adopted elsewhere (B668193's
              TOUCH_MIN_TAP_RADIUS) — the old 28x28 box was below it. */}
          <button
            type="button" onClick={() => setAttributionOpen((o) => !o)}
            aria-expanded={attributionOpen} aria-label="Map data credit" title="Map data credit"
            data-testid="food-attribution-toggle"
            style={{
              position: "absolute", top: ATTRIBUTION_TOGGLE_TOP, right: 12, zIndex: 500,
              width: ATTRIBUTION_TOGGLE_SIZE, height: ATTRIBUTION_TOGGLE_SIZE, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--border-default)", background: "var(--surface-raised)",
              color: "var(--text-secondary)", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            }}
          >
            <InfoGlyph />
          </button>
          {attributionOpen && (
            <div
              data-testid="food-attribution-panel" role="note"
              style={{
                position: "absolute", top: ATTRIBUTION_TOGGLE_TOP + ATTRIBUTION_TOGGLE_SIZE + 8, right: 12, zIndex: 500,
                maxWidth: "calc(100% - 24px)",
                background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
                borderRadius: 8, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.5, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              }}
              dangerouslySetInnerHTML={{ __html: basemap === "satellite" ? SATELLITE_TILES.attribution : STREET_TILES.attribution }}
            />
          )}
        </>
      )}
    </div>
  );
}
