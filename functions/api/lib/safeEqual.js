/* Constant-time secret comparison — the ONE implementation for every `functions/` route that checks a
 * secret (audit batch A, 2026-11-23). Hash both sides to a fixed 32 bytes first (so length never leaks),
 * then XOR-accumulate over every byte with no early exit. A bare `===` / `!==` on a secret is a defect:
 * `test/secretCompareOneImpl.test.js` fails if a route compares one that way. */
export async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] || 0);
  return diff === 0;
}
