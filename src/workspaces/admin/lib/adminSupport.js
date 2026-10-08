/* Support grouping (NEW-4): bare "something was slow" taps (no description) collapse into ONE line per
 * account — "11 slow taps, latest 12 days ago" — and items with a written description stay individual.
 * Pure over the tickets shapeTickets returns. */
import { ago } from "./adminPanels.js";

export const isBareSlowTap = (t) => t.category === "slow" && !String(t.description || "").trim();
const accountKey = (t) => t.userId || t.email || "signed-out";

/** @returns {{ items: Ticket[], groups: { key, who, tickets, latest, label }[] }} — items = written reports, newest first
 * unless `oldestFirst`; groups = one per account of bare slow taps, most recent first. */
export function groupSupport(tickets, { oldestFirst = false, now = Date.now() } = {}) {
  const items = [];
  const g = new Map();
  for (const t of tickets) {
    if (!isBareSlowTap(t)) { items.push(t); continue; }
    const k = accountKey(t);
    if (!g.has(k)) g.set(k, { key: k, who: t.email || (t.userId ? "signed-in account" : "signed out"), userId: t.userId, tickets: [] });
    g.get(k).tickets.push(t);
  }
  const t = (x) => new Date(x.at).getTime();
  items.sort((a, b) => (oldestFirst ? t(a) - t(b) : t(b) - t(a)));
  const groups = [...g.values()].map((x) => {
    x.tickets.sort((a, b) => t(b) - t(a));
    const latest = x.tickets[0].at;
    return { ...x, latest, label: `${x.tickets.length} slow ${x.tickets.length === 1 ? "tap" : "taps"}, latest ${ago(latest, now)}` };
  }).sort((a, b) => t({ at: b.latest }) - t({ at: a.latest }));
  return { items, groups };
}

export function contextSummary(ctx) {
  if (!ctx || typeof ctx !== "object") return "—";
  const parts = [];
  if (ctx.route) parts.push(ctx.route);
  if (ctx.build) parts.push(`build ${ctx.build}`);
  if (Number.isFinite(ctx.viewportW) && Number.isFinite(ctx.viewportH)) parts.push(`${ctx.viewportW}×${ctx.viewportH}`);
  if (ctx.plan) parts.push(`plan ${ctx.plan}`);
  if (ctx.captureTaken != null) parts.push(ctx.captureTaken ? "capture taken" : "no capture");
  if (ctx.captureDelivered != null) parts.push(ctx.captureDelivered ? "delivered" : "undelivered");
  return parts.length ? parts.join(" · ") : "—";
}
