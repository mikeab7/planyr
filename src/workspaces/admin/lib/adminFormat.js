/* Shared date / number formatting for the admin page (NEW-1). Dates are RELATIVE with the exact time on
 * hover (`exactTime`) — never a raw ISO string. Pure. */
export function exactTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(iso);
}
export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}
/** "Sep 28" for a YYYY-MM-DD week label (parsed as a calendar date, never shifted by timezone). */
export function shortDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return String(ymd || "");
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
/** Round a chart maximum up to a tidy tick ceiling and return the tick values (0 … max). */
export function niceTicks(max, count = 4) {
  const m = Math.max(1, Number(max) || 0);
  const raw = m / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw) || 10 * pow;
  const top = Math.ceil(m / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}
