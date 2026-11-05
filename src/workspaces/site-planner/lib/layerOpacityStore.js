/* A PROJECT's per-layer opacity — the store (B2448033). Pure rules are in layerOpacity.js; the single
 * authority is the `project_layer_opacity` row (db/project_layer_opacity.sql). This module is the only
 * thing that talks to it.
 *
 *   • READ  — `getProjectLayerOpacity(group)` answers synchronously from a small device mirror so the
 *     first paint of a plan is already right; `refreshProjectLayerOpacity(group, siteId)` asks the
 *     server (get_project_layer_opacity) and adopts what it says.
 *   • WRITE — `setProjectLayerOpacity(group, siteId, nextMap)` diffs against what we hold and keeps only
 *     the PATCH (the layers that changed). The patch is sent, debounced, to set_project_layer_opacity,
 *     which merges it into the CURRENT row in one statement and returns the merged map. We never send
 *     the whole map, so a stale device cannot revert a layer it did not touch.
 *   • The device mirror is NOT a second authority: it holds the last map the server gave us (or, signed
 *     out, the only copy) plus the still-unsent patch, so a reload mid-drag, or an offline edit, is
 *     delivered next time instead of lost. It is only ever written back as a patch.
 *
 * Signed out: no project row exists to write, so the value is kept on THIS DEVICE only (mirror key
 * `local`) — said in the docs and the backlog item; signing in switches to the account's project values.
 *
 * LOUD-FAILURE: a refused / failed write is telemetered (once per project per session), never silent.
 *   P0002 (the plan is not in the cloud yet) keeps the patch and retries; 42501 (view-only teammate on a
 *   locked plan) drops it, so the choice stays this session's only; PGRST202 (database not migrated)
 *   keeps the value device-only. */
import { supabase } from "./supabase.js";
import { activeUid } from "./activeUser.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { sanitizeLayerOpacity, opacityPatch, applyPatch, opacitySig } from "./layerOpacity.js";

const KEY = "planyr:layerOpacity:v1:";
const DEBOUNCE_MS = 600;

const states = new Map(); // `${uid|local}:${group}` -> state
const subs = new Map(); // group -> Set<cb>
const warned = new Set();

const uidNow = () => activeUid() || null;
const skey = (group) => `${uidNow() || "local"}:${group}`;

function readMirror(k) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY + k) : null;
    const j = raw ? JSON.parse(raw) : null;
    return { map: sanitizeLayerOpacity(j && j.map), raw: j && j.raw && typeof j.raw === "object" ? j.raw : null, pending: j && j.pending && typeof j.pending === "object" ? j.pending : {} };
  } catch (_) { return { map: {}, raw: null, pending: {} }; }
}
function writeMirror(k, st) {
  try {
    if (typeof localStorage === "undefined") return;
    if (!Object.keys(st.map).length && !Object.keys(st.pending).length) localStorage.removeItem(KEY + k);
    else localStorage.setItem(KEY + k, JSON.stringify({ map: st.map, raw: st.raw, pending: st.pending }));
  } catch (_) { /* a per-device convenience; the server row is the authority when signed in */ }
}

function stateFor(group) {
  const k = skey(group);
  let st = states.get(k);
  if (!st) { st = { k, group, uid: uidNow(), ...readMirror(k), siteId: null, timer: null, inflight: false, again: false }; states.set(k, st); }
  return st;
}

function notify(group, map) {
  const set = subs.get(group);
  if (set) set.forEach((cb) => { try { cb(map); } catch (_) { /* a subscriber must never break the store */ } });
}
function warnOnce(name, group, msg, extra) {
  const id = name + ":" + group;
  if (warned.has(id)) return;
  warned.add(id);
  try { reportClientEvent(name, msg, { group, ...(extra || {}) }); } catch (_) { /* telemetry is best effort */ }
}

export const getProjectLayerOpacity = (group) => (group ? stateFor(group).map : {});

export function subscribeLayerOpacity(group, cb) {
  if (!group) return () => {};
  if (!subs.has(group)) subs.set(group, new Set());
  subs.get(group).add(cb);
  return () => { const s = subs.get(group); if (s) s.delete(cb); };
}

const errCode = (e) => String((e && (e.code || e.status)) || "");
const isMissingFn = (e) => errCode(e) === "PGRST202" || /could not find the function/i.test(String((e && e.message) || ""));

async function flushState(st) {
  if (!supabase || !st.uid || !st.siteId || !Object.keys(st.pending).length) return;
  if (st.inflight) { st.again = true; return; }
  st.inflight = true;
  const sent = { ...st.pending };
  try {
    const { data, error } = await supabase.rpc("set_project_layer_opacity", { p_site_id: st.siteId, p_patch: sent });
    if (error) {
      const code = errCode(error);
      if (code === "P0002") return; // plan not in the cloud yet — keep the patch, retry on the next refresh / edit
      if (code === "42501") { st.pending = {}; warnOnce("layer-opacity-view-only", st.group, "project layer opacity not saved: view-only plan", {}); }
      else if (isMissingFn(error)) { st.pending = {}; warnOnce("layer-opacity-unavailable", st.group, "set_project_layer_opacity is not deployed; opacity stays on this device", {}); }
      else warnOnce("layer-opacity-write-failed", st.group, "project layer opacity write failed", { error: error.message || "" });
      writeMirror(st.k, st);
      return;
    }
    // Drop only what we sent AND the user has not since changed; adopt the server's merged answer.
    for (const [key, v] of Object.entries(sent)) if (st.pending[key] === v) delete st.pending[key];
    if (data && typeof data === "object") st.raw = data;
    adopt(st);
  } catch (e) {
    warnOnce("layer-opacity-write-failed", st.group, "project layer opacity write threw", { error: String((e && e.message) || e) });
  } finally {
    st.inflight = false;
    if (st.again) { st.again = false; schedule(st); }
  }
}

/* Recompute the displayed map = server map (sanitised) with still-pending local changes laid over it. */
function adopt(st) {
  const next = applyPatch(st.raw ? sanitizeLayerOpacity(st.raw) : st.map, st.pending);
  const changed = opacitySig(next) !== opacitySig(st.map);
  st.map = next;
  writeMirror(st.k, st);
  if (changed) notify(st.group, st.map);
}

function schedule(st) {
  if (!st.uid) return;
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(() => { st.timer = null; flushState(st); }, DEBOUNCE_MS);
}

/* Record the project's new sparse map. `siteId` is the open plan (the server derives the project and its
 * owner from it). Returns true when something changed. */
export function setProjectLayerOpacity(group, siteId, nextMap) {
  if (!group) return false;
  const st = stateFor(group);
  if (siteId) st.siteId = siteId;
  const next = sanitizeLayerOpacity(nextMap);
  const patch = opacityPatch(st.map, next, st.raw);
  if (!Object.keys(patch).length) return false;
  const mapChanged = opacitySig(next) !== opacitySig(st.map);
  st.map = next;
  if (st.uid) { st.pending = { ...st.pending, ...patch }; schedule(st); }
  writeMirror(st.k, st);
  if (mapChanged) notify(group, st.map);
  return true;
}

/* Ask the server for the project's map and adopt it (still-pending local changes stay on top). Resolves
 * to the displayed map, or null when there is nothing to ask (signed out / offline / plan not in the
 * cloud yet) — null means "keep what you hold", never "no opacity". */
export async function refreshProjectLayerOpacity(group, siteId) {
  if (!group || !siteId || !supabase) return null;
  const st = stateFor(group);
  st.siteId = siteId;
  if (!st.uid) return null;
  if (Object.keys(st.pending).length) await flushState(st);
  try {
    const { data, error } = await supabase.rpc("get_project_layer_opacity", { p_site_id: siteId });
    if (error) {
      if (isMissingFn(error)) warnOnce("layer-opacity-unavailable", group, "get_project_layer_opacity is not deployed; opacity stays on this device", {});
      else warnOnce("layer-opacity-read-failed", group, "project layer opacity read failed", { error: error.message || "" });
      return null;
    }
    if (data == null || typeof data !== "object") return null;
    st.raw = data;
    adopt(st);
    return st.map;
  } catch (e) {
    warnOnce("layer-opacity-read-failed", group, "project layer opacity read threw", { error: String((e && e.message) || e) });
    return null;
  }
}

/* Deliver anything still pending right now (tab hidden / page leaving) — best effort; the mirror keeps
 * it for the next open if the call does not finish. */
export function flushAllLayerOpacity() {
  for (const st of states.values()) {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    flushState(st);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAllLayerOpacity(); });
  window.addEventListener("pagehide", flushAllLayerOpacity);
}

export function _resetLayerOpacityStore() { // tests only
  for (const st of states.values()) if (st.timer) clearTimeout(st.timer);
  states.clear(); subs.clear(); warned.clear();
}
