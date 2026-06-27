/* Scheduler Supabase REST client (read schedule, insert a pending suggestion).
 *
 * Talks to the Scheduler project's PostgREST directly with the anon key (the same key the
 * Scheduler page ships publicly): GET planar_data for the live schedule, POST planar_suggestions
 * to drop a *pending* proposal. Network injectable for tests; returns { ok, ... } / { ok:false,
 * error }; never throws.
 */
import { ok, fail } from "../storage/result.js";

function rest(cfg, path) {
  return `${String(cfg.supabase.url).replace(/\/+$/, "")}/rest/v1/${path}`;
}
function headers(cfg, extra = {}) {
  return { apikey: cfg.supabase.anonKey, authorization: `Bearer ${cfg.supabase.anonKey}`, ...extra };
}

/* Read the live schedule blob (planar_data.value for the configured key) and project it down
 * to the fields Claude needs to reference real task ids. Returns { ok, schedule } where schedule
 * = { projects:[{ id, name, tasks:[{ id, name, start, end, duration, health, percentComplete,
 * responsibleParty, parentId }] }] }. */
export async function getSchedule(cfg, { fetchImpl = fetch } = {}) {
  if (!cfg || !cfg.supabase || !cfg.supabase.url || !cfg.supabase.anonKey)
    return fail("Scheduler backend not configured (SCHEDULER_SUPABASE_URL / SCHEDULER_SUPABASE_ANON_KEY).", { configured: false });

  const url = rest(cfg, `planar_data?key=eq.${encodeURIComponent(cfg.scheduleKey)}&select=value`);
  let res;
  try { res = await fetchImpl(url, { headers: headers(cfg) }); }
  catch (e) { return fail(`Couldn't reach the Scheduler backend: ${e && e.message ? e.message : e}`); }
  if (!res.ok) return fail(`Scheduler read failed (HTTP ${res.status}).`);

  let rows = [];
  try { rows = await res.json(); } catch (_) { /* non-JSON */ }
  const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
  if (!value || typeof value !== "object") return fail(`No schedule found for key "${cfg.scheduleKey}".`);

  return ok({ schedule: compactSchedule(value) });
}

const TASK_FIELDS = ["id", "name", "start", "end", "duration", "health", "percentComplete", "responsibleParty", "parentId"];
function compactSchedule(value) {
  const projects = [];
  const pmap = (value && value.projects) || {};
  for (const key of Object.keys(pmap)) {
    const p = pmap[key]; if (!p) continue;
    const tasks = Array.isArray(p.tasks) ? p.tasks.map((t) => {
      const o = {}; for (const f of TASK_FIELDS) if (t[f] !== undefined) o[f] = t[f]; return o;
    }) : [];
    projects.push({ id: p.id != null ? p.id : (Number.isNaN(+key) ? key : +key), name: p.name || "", tasks });
  }
  return { projects };
}

/* Insert one pending suggestion row. Returns { ok, suggestion } with the stored row. */
export async function insertSuggestion(cfg, row, { fetchImpl = fetch } = {}) {
  if (!cfg || !cfg.supabase || !cfg.supabase.url || !cfg.supabase.anonKey)
    return fail("Scheduler backend not configured.", { configured: false });
  if (!row || typeof row !== "object") return fail("Nothing to insert.");

  let res;
  try {
    res = await fetchImpl(rest(cfg, "planar_suggestions"), {
      method: "POST",
      headers: headers(cfg, { "content-type": "application/json", prefer: "return=representation" }),
      body: JSON.stringify(row),
    });
  } catch (e) { return fail(`Couldn't reach the Scheduler backend: ${e && e.message ? e.message : e}`); }

  if (!res.ok) {
    let detail = ""; try { const b = await res.json(); detail = (b && (b.message || b.error || b.hint)) || ""; } catch (_) { /* ignore */ }
    if (res.status === 401 || res.status === 403)
      return fail(`The Scheduler database rejected the suggestion (HTTP ${res.status})${detail ? " — " + detail : ""}. Run db/suggestions_rls.sql to allow inserts.`);
    return fail(`Suggestion insert failed (HTTP ${res.status})${detail ? " — " + detail : ""}.`);
  }

  let stored = null; try { const b = await res.json(); stored = Array.isArray(b) ? b[0] : b; } catch (_) { /* ignore */ }
  return ok({ suggestion: stored || row });
}
