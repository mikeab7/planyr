# Planyr — Industrial Site Planner

A TestFit-style site-planning sketch tool aimed at **industrial** deals
(buildings, truck courts, trailer storage, car parking, detention) for the
Houston metro: **Harris, Fort Bend, and Chambers** counties.

Everything internal is in **feet**. Draw a parcel (or pull a real one), drop
buildings/paving/parking, and the right rail live-computes site yield: coverage,
FAR, impervious %, car stalls, trailer stalls, detention, open space.

## Run it locally

Requires Node 18+.

```bash
npm install
npm run dev      # open the printed http://localhost:5173 URL
```

Build a static bundle:

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build
```

## Three ways to get a parcel onto the canvas

You can mix all three. There's no login or API key.

### 1. County parcel lookup (the "real data" path)
Right rail → **Parcel lookup**. Pick a county, search by **address** or
**account #**, and click a result to import its true boundary (pulled live from
the county's public GIS and converted to Texas State Plane **feet**, so on-screen
distances are accurate — no Web-Mercator stretch).

The county endpoints live in [`src/lib/counties.js`](src/lib/counties.js):

| County | Source |
| --- | --- |
| Harris | HCAD Parcels — `gis.hctx.net/.../HCAD/Parcels/MapServer/0` |
| Fort Bend | FBCAD public service — `gis.fbcad.org/.../Public/MapServer` (parcels layer auto-detected) |
| Chambers | CCAD hosted parcels feature service (**provisional** — see note) |

The app reads each layer's field list at runtime and auto-detects the account and
address fields, so a county renaming a column won't break the lookup. If an
endpoint moves, paste a corrected URL into the **Service / layer URL** box under
the search (no code change needed).

> **Heads up — verify in your browser.** These are public Esri ArcGIS services
> and normally allow direct browser requests (CORS). If a county server is down,
> moved, or blocks CORS you'll get a clear error and should fall back to the
> screenshot workflow below. The Chambers endpoint in particular is marked
> *beta* and may need updating. If a server blocks CORS, uncomment the matching
> dev-proxy entry in [`vite.config.js`](vite.config.js) and point that county's
> URL at the local path.

### 2. Aerial / screenshot underlay + calibration (the intermediary)
Right rail → **Aerial underlay** → **Load screenshot…**. Drop in any aerial or
map screenshot, then:

1. Click **Calibrate scale**.
2. Click the two ends of something you know the real length of (a road width, a
   building wall, a scale bar).
3. Type the **actual feet** and hit **Apply** — the image is rescaled to true
   feet.
4. Tick **Lock** so the image is click-through, then trace your parcel/buildings
   on top with the drawing tools.

Adjust **Opacity** to see your linework over the image. This path needs no
network and is the reliable fallback while the county feeds are being dialed in.

### 3. Draw or type it
- **New parcel** → type a width × depth in feet → **Add** a rectangle.
- **Parcel** tool → click points to draw any boundary; click the first point (or
  double-click) to close.

## Tools

`Select` (move/resize/rotate, drag empty space to pan) · `Parcel` · `Building` ·
`Paving` · `Parking` (auto-counts stalls) · `Trailer` (auto-counts) · `Pond` ·
`Measure` · `Calibrate`. Mouse wheel zooms; **Fit** frames everything; **Esc**
cancels; **Delete** removes the selection.

Parking/trailer dimensions, setback, and grid snap are all editable under
**Standards**. Scenarios save to your browser (**Save / load**) or **Export
JSON**.

## How it's wired

```
index.html
src/main.jsx              # React entry
src/SitePlanner.jsx       # the whole planner (canvas, tools, inspector, metrics)
src/lib/storage.js        # localStorage-backed scenario store
src/lib/image.js          # screenshot loader + downscale
src/lib/counties.js       # county endpoint presets + field auto-detect
src/lib/arcgis.js         # ArcGIS REST query + geometry → local feet (EPSG:2278)
```

Adding another county is just one entry in `src/lib/counties.js` pointing at its
ArcGIS REST layer or service URL.

## Deploy secrets (server-side — not in the repo)

Production runs on **Cloudflare Pages** (serving planyr.io). Third-party secrets live as
encrypted **Cloudflare Pages → Settings → Environment variables / Secrets**, never in the
repo or the client bundle:

- **`MAPILLARY_TOKEN`** — the Mapillary access token for the "Poles & hydrants from street
  imagery" layer. Read **server-side only** by the `/api/mapillary` Pages Function
  (`context.env.MAPILLARY_TOKEN`); it is deliberately **not** a `VITE_*` var (that would
  compile into the public JS). Set in the **Production** environment (add it to **Preview**
  too if you want per-branch preview URLs to show the layer). If it's absent the layer just
  degrades gracefully — no street imagery, no error. See `.env.example`.

The Supabase **anon** key is the only key that ships to the browser (it's RLS-protected and
public by design); everything else (service-role, third-party API keys) stays server-side.

## Known limitations (prototype)

- Ponds and footprints are rectangles; the parcel offset (setback) is a simple
  inward offset that's accurate for convex/mildly-concave lots.
- Single-story FAR assumption.
- A large underlay image may exceed the browser's localStorage budget when
  saving a scenario — use **Export JSON** for those.
- County lookups depend on third-party public servers; treat results as a
  starting sketch, not a survey.
