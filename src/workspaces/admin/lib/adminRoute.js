/* Admin sub-routing (NEW-1): the selected section lives in the hash — `#/admin/<section>` — so reload and
 * back/forward keep it, and bare `#/admin` opens Overview. Pure. Routing for `#/admin` itself is the app
 * shell's `isAdminRoute` (first segment only), which already treats EVERY sub-path identically, so a
 * non-admin typing `#/admin/users` gets exactly the typo behaviour `#/admin` gets. An unknown sub-path
 * resolves to Overview rather than a blank page. A `?user=<id>` query (the Users → Password reset
 * prefill) rides on the last segment and is never part of the section id. */
import { SECTIONS, DEFAULT_SECTION } from "./adminSections.js";

const IDS = new Set(SECTIONS.map((s) => s.id));

function split(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  return { segs: path.split("/").filter(Boolean), query };
}

export function parseAdminHash(hash) {
  const { segs, query } = split(hash);
  const section = segs[0] === "admin" && IDS.has(segs[1]) ? segs[1] : DEFAULT_SECTION;
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { section, params };
}

export function buildAdminHash(section, params) {
  const q = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : "";
  return section === DEFAULT_SECTION && !q ? "#/admin" : `#/admin/${section}${q}`;
}

/** The admin page's ONE hash writer (the section nav, tiles and the Users → Password-reset link all go through it).
 * #/admin/* is deliberately not a module route `navigate()` resolves, so — like the Dashboard and the account
 * menu's Admin row — it writes the literal hash; test/routeSingleWriter.test.js pins this as the only admin write site. */
export function goAdminSection(section, params) {
  const next = buildAdminHash(section, params);
  if (typeof window !== "undefined" && window.location.hash !== next) window.location.hash = next;
}
