/* Settings → Profile form model (NEW-1, B2026000-block). Pure, so the "is Save allowed?" rule is
 * unit-tested without a DOM.
 *
 * ⛔ DIRTY IS A COMPARISON, NEVER A FLAG. The old panel kept a `touched` ref and left Save lit
 * all the time. A touched-flag reads "edited then put back" as changed; comparing the form with
 * the SAVED values reads it as clean, which is what the owner asked for. The saved values are the
 * baseline — the profile row (falling back to signup metadata), and after a successful save, what
 * was just written. Values are compared trimmed, the same way they are saved. */
const s = (v) => (v == null ? "" : String(v)).trim();

/** The saved baseline: profile row first, signup metadata second (same fallback the form seeds from). */
export function savedProfileValues(profile, user) {
  const meta = (user && user.user_metadata) || {};
  const p = profile || {};
  return {
    first: s(p.first_name) || s(meta.first_name),
    last: s(p.last_name) || s(meta.last_name),
    org: s(p.org) || s(meta.org),
  };
}

/** True when any field differs from the saved value. */
export function profileDirty(saved, form) {
  const a = saved || {};
  const b = form || {};
  return s(a.first) !== s(b.first) || s(a.last) !== s(b.last) || s(a.org) !== s(b.org);
}
