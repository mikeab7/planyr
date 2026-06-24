# Handoff — B280 seed fails with `42P10: no unique or exclusion constraint matching the ON CONFLICT specification`

**For:** a Claude Cowork session that has access to the live Supabase project
(`planyr-production`, ref `lyeqzkuiwngunutlkkmi`) — its SQL editor or a Supabase MCP.
**From:** the Claude Code session that built the e2e harness (B278/B280/B281).
**Goal:** make `e2e/seed/seed.sql` run cleanly so the Playwright fixture user has its
fixture site, then confirm the row exists.

---

## What happened

Michael created the auth user, then ran `e2e/seed/seed.sql` in the Supabase SQL editor.
It failed on the final statement:

```
ERROR: 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

The failing clause (seed.sql:50):

```sql
on conflict (user_id, id) do update
  set data = excluded.data, name = excluded.name, county = excluded.county,
      group_id = excluded.group_id, site = excluded.site, updated_at = now();
```

## Root cause (high confidence)

`42P10` means the columns named in `ON CONFLICT (...)` are **not** covered by a unique
or primary-key constraint on the actual table. The seed targeted `(user_id, id)` because
`CLAUDE.md` documents `public.sites` as `primary key (user_id, id)`. The live table's
real constraint is **different** — the schema drifted from the doc. So this is not a
syntax bug in the seed; the seed assumed a PK shape the live DB doesn't have.

> Postgres matches an `ON CONFLICT` target to a constraint by the **set** of columns,
> ignoring order — so `(user_id, id)` vs `(id, user_id)` is not the problem. The live
> constraint genuinely covers a *different* set of columns (most likely single-column
> `id`).

## Step 1 — confirm the real constraint (run this first)

```sql
-- What unique / primary-key constraints actually exist on public.sites?
select con.conname,
       con.contype,                       -- 'p' = primary key, 'u' = unique
       pg_get_constraintdef(con.oid) as definition
from   pg_constraint con
join   pg_class      rel on rel.oid = con.conrelid
join   pg_namespace  ns  on ns.oid  = rel.relnamespace
where  ns.nspname = 'public'
  and  rel.relname = 'sites'
  and  con.contype in ('p','u');
```

Note the column list in `definition`. That is the only valid `ON CONFLICT` target.
(If it comes back as `PRIMARY KEY (id)`, the doc is simply stale and the rest of the
app's upserts already key off `id` alone.)

## Step 2 — the fix (drop-in, already applied to `seed.sql`)

I rewrote `seed.sql` to be **constraint-independent**: it deletes any prior fixture row
for the fixture user, then inserts a fresh one. No `ON CONFLICT`, so it works no matter
what the live PK turns out to be, and it's still idempotent (re-running replaces the
fixture in place). The delete is scoped to `id = 'e2e-fixture-site'` AND the
`e2e@planyr.test` user, so it can never touch a real customer's data.

**Just re-run the updated `e2e/seed/seed.sql`.** If you'd rather keep an upsert, the
alternative is to change the `ON CONFLICT (...)` target to whatever Step 1 reports — but
the delete-then-insert version needs no such knowledge and is what's now committed.

## Step 3 — verify

The seed ends with a sanity `SELECT`; it must return **exactly one row**:

```sql
select s.id, s.user_id, s.name, s.county
from   public.sites s
join   auth.users u on u.id = s.user_id
where  u.email = 'e2e@planyr.test' and s.id = 'e2e-fixture-site';
```

Zero rows ⇒ the auth user `e2e@planyr.test` doesn't exist yet — create it under
Authentication → Users → Add user (the password you set becomes the CI secret
`E2E_PASSWORD`), then re-run.

## Guardrails (do not cross)

- **Don't alter `public.sites`'s schema or its RLS** to make the seed fit. The seed must
  adapt to the table, never the other way round — changing the live PK or policies risks
  real user data and the app's own upsert path.
- **Don't widen the delete.** Keep it scoped to the fixture id + the e2e user.
- This writes one normal own-row via RLS, exactly like the app would. No service-role key.

## Follow-up worth flagging to Michael

The live `public.sites` PK differs from what `CLAUDE.md` documents (`primary key
(user_id, id)`). Once Step 1 reveals the real shape, the doc's Supabase "Table schema"
block should be corrected so the next person isn't bitten the same way. (Same check is
worth doing for `public.doc_reviews`, documented identically.)
