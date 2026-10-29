/* THE ONE clean-up pass for a layer's CLICK CARD (B2507062 / NEW-7, owner constraint #45). Pure — no React, no Leaflet, no DOM.
 *
 * A card is `{ title, rows: [{ label, text, href? }], note?, sourceName?, about? }`. Every card that reaches a person (the planner canvas card and the Map view's
 * pinned popup) is passed through `cleanCard` first, so a layer cannot put these on screen:
 *   • a raw field name as a label (ZONE, CASE_NO, OBJECTID, Shape.STArea, CONVERSION_STATUS) — humanised, and dropped when it is bookkeeping (object ids, shape
 *     length / area, global ids, edit stamps);
 *   • an empty / null / "<Null>" / "N/A" row;
 *   • an epoch-ms number or ISO stamp as a date — "Aug 18, 2026";
 *   • a raw URL as text — a short labelled link ("Ordinance", "Plat", "Deed", "Record") instead.
 * The source / vintage never prints on the card: it is `about`, shown behind the card's (i). */
import { approvalDate } from "./desotoZoning.js";
import { RADIUS } from "../../../shared/ui/radius.js";

/* Labels that are database bookkeeping, never a fact about the thing clicked. */
const BOOKKEEPING = /^(objectid|fid|oid|globalid|global_id|gis_id|shape[._ ]?(st)?(area|length|len)|shape|st_area|st_length|created_(user|date)|last_edited_(user|date)|created|edited|editor|creator|editdate|creationdate|ordinal)$/i;
/* A label that is clearly a column name, not words: ALL_CAPS_WITH_UNDERSCORES, snake_case, dotted, or camelCase with no spaces. */
export const looksRawLabel = (label) => {
  const s = String(label == null ? "" : label).trim();
  if (!s) return true;
  if (/\s/.test(s)) return false;
  return /_/.test(s) || /\./.test(s) || (/^[A-Z0-9]+$/.test(s) && s.length > 3) || /^[a-z]+[A-Z]/.test(s) || /^[A-Z][a-z]+[A-Z]/.test(s);
};

const WORDS = { no: "no.", num: "no.", nbr: "no.", dt: "date", dte: "date", desc: "description", addr: "address", elev: "elev.", diam: "diameter", ft: "ft", id: "ID", pin: "PIN", acct: "account", apprvd: "approved" };
/* "CASE_NO" → "Case no.", "DateApproved" → "Date approved", "Shape.STArea" → null (bookkeeping, dropped). */
export function humanLabel(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  if (BOOKKEEPING.test(s) || BOOKKEEPING.test(s.replace(/^.*\./, ""))) return null;
  if (!looksRawLabel(s)) return s;
  const parts = s.replace(/^.*\./, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[_\s]+/).filter(Boolean).map((w) => WORDS[w.toLowerCase()] || w.toLowerCase());
  if (!parts.length) return null;
  const out = parts.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const EMPTY = /^(|null|<null>|none|n\/?a|undefined|unknown|0|0\.0+|-{1,2})$/i;
export const isEmptyText = (t) => EMPTY.test(String(t == null ? "" : t).trim());

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/* A date-looking value → "Aug 18, 2026"; anything else unchanged. */
export function niceDate(text) {
  const s = String(text == null ? "" : text).trim();
  if (/^\d{12,13}$/.test(s) || ISO.test(s)) return approvalDate(/^\d+$/.test(s) ? Number(s) : s) || s;
  return s;
}

/* A short label for a link, from its row label first, then from the address. */
export function linkLabel(label, href) {
  const l = String(label || "").toLowerCase();
  if (/ordinance|municode/.test(l) || /municode\.com/i.test(href || "")) return "Ordinance";
  if (/plat/.test(l)) return "Plat";
  if (/deed/.test(l)) return "Deed";
  if (/tax/.test(l)) return "Tax record";
  if (/fema|flood/.test(l)) return "FEMA map";
  if (/pdf$/i.test(href || "")) return "Document";
  return "Record";
}
const URL_ONLY = /^(?:<a\s[^>]*href=["']([^"']+)["'][^>]*>.*?<\/a>|(https?:\/\/[^\s]+))$/i;

/* One row → a clean row, or null to drop it. */
export function cleanRow(row) {
  if (!row) return null;
  const label = humanLabel(row.label);
  if (!label) return null;
  let text = String(row.text == null ? "" : row.text).trim();
  let href = row.href && /^https?:\/\//i.test(row.href) ? row.href : null;
  const m = text.match(URL_ONLY);
  if (m) { href = href || m[1] || m[2]; text = ""; }
  if (href) return { label, text: text && !/^https?:/i.test(text) && !isEmptyText(text) ? text : linkLabel(label, href), href };
  text = niceDate(text);
  if (isEmptyText(text)) return null;
  return { label, text };
}

/* A whole card → the clean card, or null when nothing worth showing is left (no title and no rows). */
export function cleanCard(item) {
  if (!item) return null;
  const rows = [];
  const seen = new Set();
  for (const r of item.rows || []) {
    const c = cleanRow(r);
    if (!c) continue;
    const key = `${c.label}|${c.text}|${c.href || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(c);
  }
  const title = String(item.title == null ? "" : item.title).trim();
  if (!title && !rows.length) return null;
  const note = item.note && !isEmptyText(item.note) ? String(item.note).trim() : null;
  return { ...item, title: title || "Feature", rows, note, about: item.about || item.sourceName || null };
}

/* Build the card's DOM (for Leaflet popups) — nodes, never innerHTML (names arrive from external services). The source / vintage sits behind a small (i). */
export function cardNode(item, doc = document) {
  const c = cleanCard(item);
  const el = doc.createElement("div");
  el.style.cssText = "font-size:12px;line-height:1.45;max-width:260px;";
  if (!c) return el;
  const t = doc.createElement("div"); t.style.cssText = "font-weight:700;font-size:12.5px;margin-bottom:2px;display:flex;gap:6px;justify-content:space-between;align-items:flex-start;";
  const tt = doc.createElement("span"); tt.textContent = c.title; t.append(tt);
  let about = null;
  if (c.about) {
    const b = doc.createElement("button"); b.type = "button"; b.textContent = "i"; b.title = "About this layer"; b.setAttribute("aria-label", "About this layer");
    b.style.cssText = "flex:none;width:16px;height:16px;border:1px solid currentColor;background:transparent;color:inherit;font:600 10px/1 inherit;cursor:pointer;padding:0;";
    b.style.borderRadius = `${RADIUS.pill}px`;
    about = doc.createElement("div"); about.style.cssText = "display:none;opacity:0.8;font-size:10.5px;margin-top:4px;white-space:pre-line;"; about.textContent = c.about;
    b.addEventListener("click", (e) => { e.stopPropagation(); about.style.display = about.style.display === "none" ? "block" : "none"; });
    t.append(b);
  }
  el.append(t);
  for (const r of c.rows) {
    const d = doc.createElement("div");
    const l = doc.createElement("span"); l.style.opacity = "0.75"; l.textContent = `${r.label}: `;
    d.append(l);
    if (r.href) { const a = doc.createElement("a"); a.href = r.href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = r.text; d.append(a); }
    else { const v = doc.createElement("span"); v.textContent = r.text; d.append(v); }
    el.append(d);
  }
  if (c.note) { const n = doc.createElement("div"); n.style.cssText = "opacity:0.8;margin-top:3px;"; n.textContent = c.note; el.append(n); }
  if (about) el.append(about);
  return el;
}
