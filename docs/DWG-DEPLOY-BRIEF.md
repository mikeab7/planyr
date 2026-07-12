# Brief for Claude Cowork — turn on DWG uploads (deploy the converter, cost-safe by design)

**Goal:** let a user drop a `.dwg` on the Site Planner overlay and have it convert → place, the same
way `.dxf` already works (B747/B748 shipped). What's missing is standing up the DWG→DXF converter and
connecting the app to it — **without ever creating a publicly-floodable endpoint that could run up
Michael's cloud bill.**

**Owner constraint (drives the whole design):** Michael is cost-anxious. His exact worry: *"if I put
the converter on Google Cloud and someone hacks the URL and runs 300 conversions, I get a big bill."*
So the converter **must not be callable by the open internet.** The design below makes his worst case
**impossible**, not just unlikely.

---

## Current state (already merged, on `main`)

- **`server/convert/`** — the DWG→DXF service (B238). `server.js` (tiny Node HTTP server, built-ins
  only), `config.js` (env), `libredwg.js` (spawns `dwg2dxf`), `aps.js` (Autodesk fallback, dormant),
  `Dockerfile` (builds LibreDWG from source → a ~1 MB static binary in a `node:22-slim` image).
  **Not deployed anywhere yet.**
- **`src/workspaces/site-planner/lib/convertClient.js`** (B748) — the browser client. **Today it POSTs
  DWG bytes directly to `VITE_CONVERT_URL/convert`.** ⚠ This direct-to-public-URL wiring is what we are
  *replacing* — see "Code changes" below.
- **`functions/api/files.js`** — the precedent to copy: a same-origin Cloudflare Pages Function that
  **requires a signed-in Supabase user** (`verifySupabaseUser` from `server/auth/supabaseAuth.js`) before
  doing anything server-side. Mirror this auth gate.
- Live-verify entry **V261** in `VERIFICATION.md` tracks the end-to-end DWG check.

---

## The design — build THIS (decided; don't ship a public converter)

```
signed-in browser ──POST /api/convert (same-origin, DWG bytes, Supabase bearer token)──►
    functions/api/convert.js  (Cloudflare Pages Function, server-side)
        1. verifySupabaseUser(token) — reject anyone not signed in (401)   ← only real users get through
        2. forward bytes to CONVERT_URL/convert with header  x-convert-key: CONVERT_SHARED_SECRET
        3. stream the DXF (or the honest 413/422/503 error) back to the browser
              │
              ▼
    Cloud Run (or any container host)  server/convert
        - checks x-convert-key == CONVERT_SHARED_SECRET, else 401 (cheap, no dwg2dxf spawn)
        - runs LibreDWG, returns DXF bytes
        - hard caps: --max-instances=2, --cpu=1, --memory=512Mi, --timeout=120, --concurrency=4
```

**Why this kills the runaway-bill risk (put this in the PR description so Michael can see it):**
- The converter's URL is **never in the browser bundle.** It lives only in the Cloudflare Function's
  server-side env. A stranger can't discover it or call it.
- Even if they somehow found it, they'd need `CONVERT_SHARED_SECRET` (also server-side only). Without it
  they get a **cheap 401 with no conversion** — no `dwg2dxf` process, ~no compute.
- Real conversions only run for **signed-in Planyr users** (the Function's auth gate).
- **`--max-instances=2`** caps the worst-case spend *rate* no matter what — the platform queues/sheds
  excess instead of scaling to 300 parallel instances.
- Real usage sits **inside the free tier** (Cloud Run free tier ≈ 180k vCPU-seconds/month; a DWG convert
  is a few seconds — hundreds of conversions/month are free). A **$5 budget alert** is the backstop.

Net: "someone runs 300 conversions and I pay" **cannot happen** — they can't reach the converter, can't
get past the secret, and instances are capped.

### Host choice (a sub-decision, pick at deploy time — the safety design is host-agnostic)

| Host | Card required? | Notes |
|---|---|---|
| **Google Cloud Run** (recommended) | Yes (Google requires a billing account even for free-tier) | Cheapest, scales to zero, ~$0 idle. The caps + private design make the card low-risk. Deploy is one `gcloud run deploy --source`. |
| **A no-card free host** (e.g. Render free web service) | Often no | Good if Michael refuses a card anywhere. Trade-off: free instances **sleep** after inactivity → the first DWG of the day has a ~30–60 s cold start (show a "converting…" state); monthly hour caps. Same Dockerfile, same proxy. |
| Autodesk APS (pay-per-file) | — | Already coded as a dormant fallback (`aps.js`, `APS_ENABLED`). Only reach for this if LibreDWG can't read Michael's real files. Uploads drawings to Autodesk's cloud. |

**Ask Michael which host** before deploying — but the code (proxy + client + service secret gate) is
identical either way, so write it first.

---

## Code changes (one PR; mint the id with `npm run next-id`, late-bind before push)

1. **NEW `functions/api/convert.js`** — the auth-gated proxy. Copy the auth + env shape from
   `functions/api/files.js`:
   - `onRequestPost`: `verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY })` → 401 if not signed in.
   - If `!env.CONVERT_URL` → return a distinct **501/"not configured"** JSON so the client shows the
     "DWG conversion isn't set up yet" message (never a spinner into nothing — LOUD-FAILURE).
   - `fetch(env.CONVERT_URL + "/convert", { method:"POST", body: request.body, headers:{ "content-type":"application/octet-stream", "x-convert-key": env.CONVERT_SHARED_SECRET } })` — pass the DWG bytes through (stream; don't buffer if avoidable — mirror the files.js streaming note).
   - Relay the upstream status + body: 200 DXF → stream back with `content-type: application/dxf`; 413/422/503 → pass the JSON error + status through so the client's existing handling (B748) surfaces it.
   - `onRequestOptions` if needed (same-origin, so likely not — verify).
2. **`server/convert/server.js`** — add an **optional shared-secret gate**: if `cfg.sharedSecret`
   (`CONVERT_SHARED_SECRET`) is set, require request header `x-convert-key` to equal it on `/convert`,
   else `401` before reading the body. Leave it optional so local `curl`/tests without the secret still
   work. (Add `sharedSecret: env.CONVERT_SHARED_SECRET || null` to `config.js`.)
3. **`src/workspaces/site-planner/lib/convertClient.js`** — repoint the default endpoint from the public
   `VITE_CONVERT_URL` to the **same-origin `/api/convert`**. Attach the Supabase access token
   (`Authorization: Bearer …`) like the other authed client calls. Map the Function's 501/"not
   configured" to the existing `code:"unset"` "not set up yet" message. Keep a `VITE_CONVERT_URL`
   override only for local dev against a bare service. (Update the CLAUDE.md dependency/architecture note
   that currently says "gated on `VITE_CONVERT_URL`".)
4. **Tests:** update `test/convertClient.test.js` for the `/api/convert` endpoint + the not-configured
   path; add a `test/dwgConvert.test.js` case for the server's shared-secret gate (401 without the
   header, 200/round-trip with it — using the existing `createConvertServer` + injected convert fn).
5. **Docs:** update `server/convert/README.md` deploy section (the caps + secret + `--allow-unauthenticated`
   with the secret gate, NOT `--no-allow-unauthenticated`), and add a one-line pointer in the
   `doc-review`/`site-planner` architecture notes. Regenerate `MAP.md` (new file) + `BACKLOG_OPEN.md`.

Everything above is **not account-gated** — build, test, and open the PR first. The build/tests prove
the wiring; only the live round-trip waits on the deploy.

---

## Deploy steps (pair with Michael — these need HIS account; do them together, or hand him the exact clicks)

Assuming Cloud Run (adapt for another host):

1. **Michael:** in the Google Cloud Console, create/pick a project, **enable billing**, and enable the
   **Cloud Run** + **Cloud Build** APIs. (~10 min, all clicks.)
2. **Generate the shared secret** (any long random string), e.g. `openssl rand -hex 32`. It goes in two
   server-side places only (never the browser): Cloud Run env + Cloudflare env.
3. **Deploy** (use Google's in-browser **Cloud Shell** so Michael needs nothing installed locally; run
   from the repo root):
   ```bash
   gcloud run deploy planyr-dwg-convert \
     --source server/ \
     --region us-central1 \
     --allow-unauthenticated \
     --max-instances 2 --cpu 1 --memory 512Mi --timeout 120 --concurrency 4 \
     --set-env-vars CONVERT_SHARED_SECRET=<the-random-secret>
   ```
   (`--allow-unauthenticated` lets the Cloudflare Function reach it over plain HTTPS; the **secret gate
   inside the service** is what actually protects it. The `CURL_INSECURE` build-arg in the Dockerfile is
   **sandbox-only** — real Cloud Build omits it and does full TLS verification.) Note the printed service
   URL.
4. **Budget backstop:** Billing → Budgets & alerts → create a **$5/month** budget with an email alert.
5. **Cloudflare Pages** (planyr Production env vars): set **`CONVERT_URL`** = the Cloud Run URL and
   **`CONVERT_SHARED_SECRET`** = the same secret. **Redeploy** Pages.
6. **Verify (V261):**
   - Drop a real `.dwg` on a site while **signed in** → it converts and places at true scale; the
     original `.dwg` is backed up to Storage.
   - `curl -X POST <cloud-run-url>/convert --data-binary @x.dwg` **without** the secret → **401** (proves
     the converter isn't openly usable).
   - Temporarily unset the Function's `CONVERT_URL` → dropping a `.dwg` shows "DWG conversion isn't set
     up yet — export a DXF instead" (no spinner-into-nothing).
   - Record the result on V261 and move it to `VERIFICATION-DONE.md`.

---

## What only Michael can provide

- A **cloud account with billing** for the chosen host (unavoidable for Cloud Run; the private+capped+
  gated design + $5 budget alert make a runaway bill effectively impossible — explain this so he's
  comfortable). If he refuses a card *anywhere*, use the no-card free host row above.
- The **random shared secret** (or let Cowork generate it) — it lives only in Cloud Run + Cloudflare env,
  never in the browser bundle.
- Approving the **Cloudflare env changes + redeploy**.

## Do NOT

- Do **not** put the converter URL or the shared secret in any `VITE_` var / the browser bundle.
- Do **not** deploy the converter `--no-allow-unauthenticated` *without* the shared-secret gate unless you
  also implement GCP ID-token minting in the Function (more complex; the secret-gate approach is the
  recommended simplicity/safety balance).
- Do **not** leave any failure path silent — every state (not-configured, 401, 413, 422, 503, network)
  must surface a message (LOUD-FAILURE, already the B748 contract).
