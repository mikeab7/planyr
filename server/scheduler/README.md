# Scheduler connector (MCP server) — `server/scheduler/`

Lets the Claude you already pay for (claude.ai chats/Projects, or Claude Desktop) **read your
live Scheduler and propose changes** to it. Proposals land as `pending` rows in the Scheduler's
existing `planar_suggestions` table and show up in its **Review panel** for you to **Approve /
Dismiss** with one click. Claude **never edits the live schedule directly** — it only suggests.

This is the "connector first" half of the Claude↔Planyr integration (B527). The in-app chat box
is the deferred Phase 2.

## How it fits together
```
Claude (your subscription)  ──MCP──▶  /api/mcp  ──REST──▶  Scheduler Supabase
  claude.ai connector / Desktop        (CF Pages Function)    (ref ksetjztkplttbcehyicv)
                                                               planar_data  (read schedule)
                                                               planar_suggestions (insert pending)
                                                                      │
                                                          Scheduler Review panel ◀── you Approve/Dismiss
```

- `config.js` — reads `SCHEDULER_*` env (server-side only; never a `VITE_` var).
- `suggestions.js` — **pure** builders for the `planar_suggestions` row shape; field allow-list
  mirrors the Scheduler's `SGQ_ALLOWED_PATCH` so a proposal can't carry a field the Review panel
  would reject.
- `scheduleClient.js` — Scheduler Supabase REST (read schedule, insert suggestion); injectable
  `fetch`; never throws.
- `mcpServer.js` — minimal MCP (Streamable HTTP, tools-only), no SDK. Pure `handleMcp()` so it
  unit-tests without a network. Tools: `get_schedule`, `propose_task_change`, `propose_new_task`.
- `../../functions/api/mcp/[[path]].js` — the thin same-origin endpoint (supplies env, live
  `fetch`, the bearer-token gate). Dormant (503) until env is set.
- `../../public/sequence/db/suggestions_rls.sql` — one-time RLS so the anon key may insert/select/
  update suggestions (DELETE stays blocked).

Unit tests: `test/scheduler.test.js`.

## Turn it on (owner steps)
1. **Run the SQL** once in the **Scheduler** Supabase project's SQL editor (ref
   `ksetjztkplttbcehyicv`, *not* the main app): `public/sequence/db/suggestions_rls.sql`.
2. **Set Cloudflare Pages env** (Production), server-side secrets — never `VITE_`:
   - `SCHEDULER_SUPABASE_URL` = `https://ksetjztkplttbcehyicv.supabase.co`
   - `SCHEDULER_SUPABASE_ANON_KEY` = the Scheduler project's anon key (already public in
     `public/sequence/index.html`)
   - `SCHEDULER_CONNECTOR_TOKEN` = a long random string you generate (this is the bearer secret).
3. **Connect Claude:**
   - **Claude Desktop (quickest test, no OAuth):** add an MCP server that bridges to the remote
     endpoint, e.g. `npx mcp-remote https://planyr.io/api/mcp --header "Authorization: Bearer <SCHEDULER_CONNECTOR_TOKEN>"`.
   - **claude.ai (Projects/chats):** add a **custom connector** pointing at `https://planyr.io/api/mcp`.
     The native flow expects **OAuth** — the bearer token above is the interim gate; wiring an OAuth
     wrapper (`workers-oauth-provider`) for the claude.ai-web path is the remaining hardening (tracked
     in `VERIFICATION.md` V153). Available on paid Claude plans.

## Smoke test
- `GET /api/mcp` → `{ ok:true, configured:<bool>, transport:"streamable-http" }`.
- In Claude (connected): "Read my schedule" → calls `get_schedule`; "push task <id> out 3 days" →
  `propose_task_change` → a pending row appears in the Scheduler's Review panel.

## Safety
- Suggest-only: every row is `status:'pending'`; nothing changes until you Approve.
- The connector uses the Scheduler's **anon** key (already public) — no new secret is exposed; the
  only new secret is the bearer token, which lives in Cloudflare env, never the browser bundle.
- No DELETE on the schedule or the suggestions queue via the connector.
