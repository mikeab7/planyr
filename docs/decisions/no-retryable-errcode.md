# Named rule NO-RETRYABLE-ERRCODE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **NO-RETRYABLE-ERRCODE** — **No SQL function may raise errcode `40001` or `40P01`; a business-rule refusal uses a PostgREST custom code (`PT409` → HTTP 409).** PostgREST retries those two codes forever inside one request, so on 2026-10-11 a version-conflict raise pinned every pool connection and took planyr.io down for every user (6:05–6:31 PM CT). Guard: `test/noRetryableErrcode.test.js`.
