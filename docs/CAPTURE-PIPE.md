# Does a performance capture actually reach the database? — the proof (B265536)

**Run 2026-08-08. Status: the pipe is proven end to end, with one hop bridged server-side and
said so.** This document exists because B1121's stopping rule — *"instrument it so it captures
itself"* — is only sound if the instrument's output arrives. If it does not, a week of the owner's
normal use produces nothing, and the honest-looking conclusion is *"the symptom is gone"*, which is
exactly the disposition **NEVER-PARK** forbids.

---

## 0. The short version

| Link in the chain | Proven? | How |
|---|---|---|
| The deployed build carries the recorder and arms it | ✅ | `planyr.io` served build `c6a4b94`, chunk `perfRecorder-CFTfR-LN.js`, kill switch present. The harness waits for `window.pfRec` and fails the run if it never appears. |
| An induced stall produces a capture | ✅ | `ui-audit/verify-capture-pipe.mjs`, arm `auto` — 3 captures per run against a real trigger with only its clock constants compressed. |
| A capture becomes an HTTP POST to `client_errors` | ✅ | Intercepted at the network layer. Method, path, headers and the exact row body are the production bundle's own. |
| The row fits the column and parses back | ✅ | Every row 1,687–1,765 of the 2,000-char cap; JSON parsed and the packed frame track decoded, 64–128 frames each. |
| **RLS permits the insert for an anonymous visitor** | ✅ | Executed against the real table as role `anon`. |
| **RLS permits the insert for a signed-in user** | ✅ | Executed as role `authenticated` with a real JWT claim; the row lands attributed to that `user_id`. |
| The row reads back and parses **from the database** | ✅ | Selected back and parsed in SQL — see §3 for the actual rows. |
| **The `manual` kind round-trips** | ✅ | Both a warm press (128 frames) and a cold one (labelled `no-frames`). |
| Captures are distinguishable from the cumulative `event:perf` telemetry | ✅ | Different `source`; asserted both ways. |
| The browser completing the real network hop **from this sandbox** | ❌ | The egress gateway answers **403 to CONNECT** for `*.supabase.co`. Bridged: the exact intercepted row is inserted server-side under the real roles (§3). |
| **A real row from the owner's own signed-in browser** | ⏳ | `V62544`. Nothing here can produce one; it needs him to load the deployed build once. |

## 1. What was broken, and it was silent

Five places between `capture()` and a readable row, and until this run every one of them failed
quietly. The last was the serious one:

```js
// src/shared/telemetry/clientErrors.js, before B265536
function sink(row) {
  const p = supabase.from("client_errors").insert(row);
  if (p && typeof p.then === "function") p.then(() => {}, () => {});   // ← every failure, gone
}
```

…under a comment that stated the consequence out loud: *"swallows all errors (including a
missing-table / RLS rejection) so a telemetry failure is itself invisible."*

Downstream of it, the owner's own **"that felt slow just now"** button reported **✓ "Recorded —
thanks"** off the LOCAL capture succeeding. So the single highest-value signal in the speed
programme — the one that comes from the person who actually has the symptom — was also the one
best able to disappear without trace.

**As of this run, at the time of writing, `public.client_errors` holds `event:perf` rows going back
to 2026-08-06 and ZERO `event:perfcap` rows.** That is expected — #951 merged on 08-07 and his tabs
were still on builds `4a77211` / `75aae54` — but with the old sink there was no way to tell that
apart from "every capture is being rejected", and no way to find out except waiting.

## 2. What the harness proves, and what it deliberately does not

`ui-audit/verify-capture-pipe.mjs` (`npm run perf:capturepipe`) runs five arms against a real
build with a real Supabase client, seeded with a real plan and — B265538 — his measured four-layer
scene:

```
✓ auto         3 capture(s) taken; baseline 16.9 ms
✓ manual       the button reached ✓ only after the server acknowledged the row
✓ manual-cold  a press with no gesture behind it still delivers (and is labelled `no-frames`)
✓ rejected     an RLS rejection surfaces to the owner instead of reading as success
✓ offline      an unreachable server reads as undelivered, not as success
✓ row          12 perfcap insert(s) observed on the wire, every one parsed and decoded
```

**`rejected` is the anti-rot arm.** Before B265536 it was un-failable: nothing anywhere in the app
could observe a rejection, so no assertion about one could ever have gone red. It is the arm that
makes the other four mean something.

**It intercepts rather than mocks.** The route handler sits below the app, so what it asserts on is
the actual POST the production bundle issues. A stubbed Supabase client would prove the test's own
fiction. What it cannot do is complete the hop — this sandbox's gateway refuses CONNECT to
`*.supabase.co` — so the database half is bridged in §3 rather than glossed.

## 3. The database half, run for real

The exact rows the harness intercepted, inserted into `public.client_errors` under the real
PostgREST roles with real JWT claims, then selected back and parsed in SQL. Rolled back afterwards.

```
 arm            | user_id                              | source        | msg_chars | kind   | ver | p95_ms | max_ms | frames_decoded | layers_on
----------------+--------------------------------------+---------------+-----------+--------+-----+--------+--------+----------------+-----------
 anon           | (null)                               | event:perfcap |      1759 | auto   | 1   | 90.4   | 97.1   |            120 | 4
 authenticated  | a96e544f-8537-45cf-81a2-007965fbc04c | event:perfcap |      1751 | manual | 1   | 94.9   | 104    |            128 | 4
```

The policy it passed, unchanged and re-read from `pg_policy`:

```sql
-- "anyone can log a client error", INSERT, permissive, roles {authenticated, anon}
WITH CHECK ((user_id IS NULL) OR (user_id = (SELECT auth.uid())))
```

The client omits `user_id`; the column default `auth.uid()` fills it — `NULL` for an anonymous
visitor, the caller's id for a signed-in one — and both satisfy the check. **1,194 anonymous and
3,707 signed-in rows already exist in this table**, so the write path was never in doubt in
general; what was in doubt was whether anyone would find out if it stopped.

> **⛔ ONE TRAP WORTH RECORDING.** `INSERT … RETURNING` **fails** under this policy, because
> `RETURNING` needs a SELECT policy and there deliberately is none (the table is write-only from the
> client, by design — see `client_errors.sql`). The first attempt at this proof used `RETURNING` and
> came back *"new row violates row-level security policy"*, which reads exactly like a rejected
> insert. **The client must never call `.select()` on this insert**, and it does not.

**Consequence for what the app can prove about itself:** with no SELECT policy, a browser can
confirm *"the server accepted the write"* and nothing further. That is the full extent of what a
write-only channel can establish, and it is the meaningful distinction — accepted vs rejected vs
never sent. Reading a row back requires the dashboard or the service role. **A SELECT policy was
considered and deliberately not added**: the write-only posture is a stated decision in
`CLAUDE.md`, and changing a security posture to make a test easier is the wrong trade.

## 4. What changed in the product

- **`clientErrors.sink` reports its outcome** (`{ ok, error, attempts }`), keeps `lastSend` /
  `delivery` on `window.pfTelemetry`, and retries **once** — one, not a queue: a telemetry channel
  that retries forever becomes the load. It still never throws into the app, and it never reports
  its own failure *through itself* (a loop over a broken pipe).
- **The recorder tracks delivery per capture** and counts the undelivered (`pfRec.state()`).
- **The button's ✓ now means DELIVERED.** Three states: *sending* → ✓ on acknowledgement, or a
  warning that says the capture is kept on the device and could not reach the server.
- **B265540** — a capture with no frames is labelled `no-frames` instead of looking ordinary and
  being empty. A manual press in a still moment legitimately has no frame track (the loop is gated
  on interaction); *"nothing was happening"* and *"the track was lost"* support opposite
  conclusions.
- **B265541 — found by this harness on its first real stall, and the worst-aimed bug of the set.**
  A frame over 63 ms will not fit the packed track's one base-64 digit, so it is *also* carried in
  `fx` at ~10 characters apiece: nothing on a smooth capture, nearly every frame on a genuine
  stall. The shed stopped dead at 60 frames and a row that still overran fell through to the bare
  last-resort row, which drops **every** series — frame track included. **The jankier the episode,
  the likelier the capture arrived empty.** The floor is now a ladder (60 → 30 → 16 → 8) and the
  other series are surrendered before the frames are, which is what the file's own comment already
  said should happen (*"frames go last because the frame track IS the episode"*).
- **B265539** — the row carries **which** layers are on, not just how many. See
  `docs/PERF-LAYERS.md`.

## 5. What is still outstanding

**`V62544` — one real row from his own signed-in browser.** Nothing in this repo can produce it.
Everything up to and including the database is proven above; what is not proven is his machine,
his session, his network. The check is: he loads planyr.io once on build `c6a4b94` or later, and
`select * from public.client_errors where source = 'event:perfcap'` returns a row. **There is no
action for him** — no button to press, no report to file. Loading the app is the whole test, and
if the row does not appear, the button now tells him so at the moment it happens.

---

## 6. WHO ELSE WAS WRITING TO THIS TABLE — and why the pipe guard now has an opt-in (B270912, 2026-08-08)

§1–§5 asked whether the owner's capture *arrives*. They never asked what it arrives *among*. Measured
against production the day after: **679 rows in 24 hours, of which 87 of 98 `event:perf` rows were
automated and 11 were his — 89% noise.** Non-perf was worse (`assembly-orphan-pad-repaired` 154 ·
`map-registration-out-of-range` 119 · `assembly-tear-persisted` 91 · `assembly-tear-detected` 65 ·
`county-healed` 47, all on e2e fixture ids), and #954's logged-out CI lane had just multiplied it.

**This is §1's defect wearing a different hat.** §1 was a capture that could not be *seen* to fail;
this is a capture that cannot be *found*. Both end the same way — the highest-value signal in the
programme, the one the owner produces himself, missing from the place people look for it.

### The premise the fix could not use

The obvious gate is `window.__PLANYR_E2E`, which `docs/PERF-PLAN-SWITCH.md` §1 describes as set by
*"every performance harness in this repo"*. **That is true of the ui-audit perf harnesses and false of
the e2e suite** — 62 of the 81 specs in `e2e/` never set it, `assembly-tear-detector.spec.js` (the top
producer of three of the five loudest sources) among them. A flag-only gate would have silenced 19
specs, left every top row untouched, and reported success. The primary detector is therefore
`navigator.webdriver`, which the browser sets itself under any automation protocol and which needs no
per-spec discipline; the flag remains as a second door.

### The trap, which is the interesting part

**Everything §2–§4 proves runs under automation.** Suppress unconditionally and this document's own
harness is disabled by the fix it describes — the `rejected` and `offline` arms, which exist precisely
because nothing could observe a rejection before B265536, would pass forever while observing nothing.
That is the failure this repo has now caught six times, committed by the fix for its fifth instance.

So suppression is the DEFAULT under automation and `window.__PLANYR_TELEMETRY_NETWORK` is the explicit
opt-in, and **both directions are proven, in the same file:**

| run | expectation | result |
|---|---|---|
| clean, opted-in arms | rows reach the wire, failures stay loud | ✅ 5 arms, 12 perfcap inserts |
| clean, `suppressed` arm | **0 writes to `client_errors`**, capture still taken + stored + labelled | ✅ |
| **mutant A** — suppression made unconditional | the pipe guard must NOT go quietly green | **7 assertions red** |
| **mutant B** — suppression removed | the noise must come back visibly | **4 assertions red, 5 rows on the wire** |

### Two things the arm's own first run established

**The claim is about the TABLE, not the origin.** It first asserted "no request of any kind" and failed
on `/auth/v1/health`. Supabase is also this app's data backend — an automated run legitimately signs in
and reads plans — so the assertion is scoped to `/rest/v1/client_errors`, and every other request the
page made is printed rather than ignored, so a write to some future sink cannot hide behind the
narrower claim.

**Nothing distinguishes a test row server-side.** Of 410 rows in one day, **0** carry a headless user
agent and **0** a localhost URL: CI drives a real Chromium under xvfb against the deployed origin. No
cleanup query could ever have separated the synthetic rows from his, which is why the read-side
workaround had to key on his display signature — and why the gate has to live in the client.

Retention is deliberately NOT applied here; it is proposed, with a number and a trigger, on **B270913**.
The measurement says it is not yet the lever: **0 rows are older than 90 days.**
