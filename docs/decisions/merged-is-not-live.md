# MERGED is not LIVE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**⛔ MERGED ≠ LIVE — a reconciliation/audit may call a `Verify: live` item "live" ONLY when it has a PASSED
`V###` on record (B877, 2026-07-17, after the B873 pre-pass audit blessed B867/B868/B869/B875 as
"shipped-and-live" off their MERGE presence, and the Cowork pass then found them dead on the page).** No
static audit can see runtime behavior: checking that code merged to `main` and that Cloudflare deployed a
build proves the bytes are *served*, NOT that the feature *works* — a real ambient bug (B874's stuck
flood-refresh) can starve or freeze features that merged clean. So a reconciliation report has THREE
distinct states per item, never two, and never conflates the middle one with the last:
**`🔲 Open/unshipped` · `⏳ merged — V### PENDING` · `✅ live (V### PASSED, dated)`.** "Merged" is only ever
reported as **`merged — live-verify pending`**; the word **"live"** (or "confirmed", "working") requires the
dated PASS note in `VERIFICATION.md`. When an audit can't run the live check itself (sandbox / signed-in /
real-project-data), it says so and reports the item as `merged — V### pending`, never green.
