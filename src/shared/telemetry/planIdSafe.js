/* planIdSafe — the non-reversible plan-id sanitiser, as a LEAF (B329408).
 *
 * `safePlanId` / `hash32` used to live in perfCapture.js (a ~15 KB recorder module). The always-loaded shell reaches only THIS function — reportsStore.js
 * (the Help ▸ Report-a-problem context) — so importing it from perfCapture.js dragged the whole recorder-capture codec into the entry chunk every
 * route downloads. It lives here now, with no imports; perfCapture.js re-exports it, so the recorder and its tests read the very same function
 * (one implementation, never two). */
/* ── Plan identity ───────────────────────────────────────────────────────────────────────────
 * A plan id here may be an opaque key OR a name the owner typed. Opaque-looking ids pass; anything
 * else becomes a short FNV-1a hash. Non-reversible, stable within and across sessions, and enough
 * to answer "is this always the same plan?" — which is the only question the recorder needs it for. */
export function safePlanId(raw) {
  const s = raw == null ? "" : String(raw);
  if (!s) return { plan: "", planIdKind: "id" };
  if (/^[A-Za-z0-9_-]{1,40}$/.test(s)) return { plan: s, planIdKind: "id" };
  return { plan: hash32(s), planIdKind: "hash" };
}

export function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
