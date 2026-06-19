/* Storage-adapter result type (B206 / NEW-4).
 *
 * EVERY file operation returns one of these — never a bare value, never a thrown error
 * that the caller might swallow. A failed upload / move / rename / delete / link must be
 * a VISIBLE state the UI can show, same severity class as the silent cloud-save failures
 * that caused prior data loss. So the adapter's contract is: it never throws; it always
 * returns { ok: true, ... } or { ok: false, error }.
 */

export const ok = (data = {}) => ({ ok: true, ...data });
export const fail = (error, extra = {}) => ({ ok: false, error: String(error || "Unknown error"), ...extra });

/* Run a backend call that may throw or return a non-ok result, and normalize it to a
 * result. A thrown error becomes { ok:false } (the no-silent-failure guarantee) rather
 * than propagating and being lost. */
export async function attempt(fn, context = "operation") {
  try {
    const r = await fn();
    if (r && typeof r === "object" && "ok" in r) return r; // already a result
    return ok(r && typeof r === "object" ? r : { value: r });
  } catch (e) {
    return fail(`${context} failed: ${e && e.message ? e.message : e}`);
  }
}
