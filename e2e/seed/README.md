# B280 — set up the e2e test account (one-time owner step)

The automated markup tests need a real signed-in account to test against. Code can't create
a login for itself (that would need an admin key we deliberately keep out of the app), so this
is the one piece only you can do. It takes about 5 minutes, once.

You'll do three things: **make a test user**, **run one SQL file**, **add three secrets**.

---

## 1. Make the test user

1. Open the Supabase dashboard → the **planyr-production** project (the live one).
2. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
3. Email: `e2e@planyr.test`  ·  Password: pick any strong password and **write it down** —
   you'll paste it as a secret in step 3 (this is `E2E_PASSWORD`).
4. Leave "auto-confirm" on so it's usable immediately.

## 2. Run the seed file

1. Same project → left sidebar → **SQL Editor** → **New query**.
2. Open the file **`seed.sql`** (delivered alongside this note), paste the whole thing in, and
   click **Run**.
3. It should finish with a one-row result showing `e2e-fixture-site`. If it shows **zero**
   rows, the user from step 1 didn't save — recreate it and run the file again.

This just files a sample project (a 500 × 400 ft lot) owned by the test user, so the tests
have something known to open. It changes nothing about your real data or anyone's access.

## 3. Add three secrets to GitHub

GitHub → the **planyr** repo → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**, three times:

| Name | Value |
|---|---|
| `E2E_EMAIL` | `e2e@planyr.test` |
| `E2E_PASSWORD` | the password you set in step 1 |
| `E2E_BASE_URL` | your live site URL, `https://planyr.io` (or a Cloudflare preview URL) |

---

## That's it

Once those exist, the automated browser tests start running on their own and will flag a
broken tool by opening a `@claude` issue I pick up automatically — nothing further from you.
Until then, everything else still builds and the logged-out checks still run; only the
signed-in tests wait on this. **Do not** re-use this account for anything real — it exists only
for the tests.
