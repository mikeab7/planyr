/* pinStore — pinned folders/files for the Library Home (owner request, 2026-07-05:
 * a File-Explorer-style "main menu" with pinned favorites instead of landing on the tree).
 *
 * v2 (B675): pins follow the ACCOUNT. When signed in, reads/writes go to the Supabase
 * `pins` table (own-row RLS, `db/pins.sql`), so a folder/file pinned on one computer shows
 * up on every device you sign in on. Signed out (or Supabase unconfigured), pins fall back
 * to the same per-device localStorage bucket v1 used, so nothing regresses. On first
 * signed-in load, this device's local pins are migrated up into the cloud (non-destructive,
 * idempotent) — wired from Library.jsx, mirroring the B663 tree-migration marker.
 *
 * The async, uid-first public API is UNCHANGED from v1, so the two callers (Library.jsx,
 * LibraryHome.jsx) don't change — only the internals branch on sign-in.
 *
 * A pin is { type: "folder"|"file", id, projectId, label }:
 *   • folder pins → a project_folders row id; clicking navigates to that project + folder.
 *   • file pins   → a doc_reviews row id;      clicking opens the drawing in Review.
 * `label` is a display-name snapshot taken at pin time, so a pin stays legible (and loudly
 * "missing", never silently dropped) even if its target can't be resolved later.
 */
import { supabase } from "../../workspaces/site-planner/lib/supabase.js";
import { getUser } from "../../workspaces/site-planner/lib/auth.js";
import { reportClientEvent } from "../telemetry/clientErrors.js";

const keyFor = (uid) => `planyr:pins:v1:${uid || "local"}`;
const VALID_TYPE = (t) => t === "folder" || t === "file";
const pinKey = (p) => `${p.type}:${p.id}`;

/* ---- pure helpers (exported for unit tests) ---------------------------------------- */

// A clean pin from a raw DB row (snake_case → camelCase, like folders.js:toClientRow).
export function rowToPin(r) {
  return {
    type: r.type,
    id: r.target_id,
    projectId: typeof r.project_id === "string" && r.project_id ? r.project_id : null,
    label: typeof r.label === "string" ? r.label : "",
  };
}

// The DB write payload for a pin. NEVER includes user_id — the column default auth.uid()
// stamps the owner server-side, so a request can only ever write the signed-in user's rows.
export function pinToRow(pin) {
  return {
    type: pin.type,
    target_id: pin.id,
    project_id: pin.projectId || null,
    label: pin.label || "",
    updated_at: new Date().toISOString(),
  };
}

// Dedupe a pin list by { type, id }, keeping the FIRST occurrence (newest-first order).
export function dedupePins(pins) {
  const seen = new Set();
  const out = [];
  for (const p of pins) {
    if (!p || !VALID_TYPE(p.type) || typeof p.id !== "string" || !p.id) continue;
    const k = pinKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// Which local pins need copying into the cloud: the local-only ones (not already in cloud).
// Pure decision — the caller does the upserts. Non-destructive by construction (never
// proposes deleting a cloud pin), so pins made on another device are preserved.
export function planPinMigration(localPins, cloudPins) {
  const inCloud = new Set((cloudPins || []).map(pinKey));
  return dedupePins(localPins || []).filter((p) => !inCloud.has(pinKey(p)));
}

// UNCHANGED (sync, operates on an already-loaded list).
export function isPinned(list, { type, id }) {
  return Array.isArray(list) && list.some((p) => p.type === type && p.id === id);
}

/* ---- local (signed-out) backend — the v1 localStorage bucket, unchanged ------------ */

function readList(uid) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(keyFor(uid)) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("not an array");
    return arr.filter((p) => p && VALID_TYPE(p.type) && typeof p.id === "string" && p.id)
      .map((p) => ({ type: p.type, id: p.id, projectId: typeof p.projectId === "string" && p.projectId ? p.projectId : null, label: typeof p.label === "string" ? p.label : "" }));
  } catch (_) {
    try { localStorage.removeItem(keyFor(uid)); } catch (_) { /* storage unavailable */ }
    return [];
  }
}

function writeList(uid, list) {
  try { localStorage.setItem(keyFor(uid), JSON.stringify(list)); } catch (_) { /* quota — pins are a convenience */ }
  emit();
}

/* ---- cloud (signed-in) backend — dependency-injected client, testable with a fake ---
 * These take the Supabase client as a param (the casUpsert/folderStoreSupabase pattern),
 * so unit tests pass a fake and the public API below wires in the real `supabase`. Reads
 * degrade to [] and never throw; writes return { error } | { ok } and never throw. */

export async function listPinsCloud(client) {
  const { data, error } = await client
    .from("pins")
    .select("type,target_id,project_id,label")
    .order("created_at", { ascending: false });
  if (error) { console.warn("listPins (cloud) failed:", error.message); return []; }
  return (data || []).map(rowToPin);
}

export async function addPinCloud(client, pin) {
  const { error } = await client
    .from("pins")
    .upsert(pinToRow(pin), { onConflict: "user_id,type,target_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removePinCloud(client, type, id) {
  // RLS scopes DELETE to the signed-in user's rows, so type+target_id is sufficient.
  const { error } = await client.from("pins").delete().eq("type", type).eq("target_id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Copy local-only pins into the cloud. Non-destructive (local buckets kept), idempotent
// (upsert onConflict → a re-run is a no-op), returns { copied, skipped, failed }.
export async function runPinMigration(client, localPins) {
  const cloud = await listPinsCloud(client);
  const toCopy = planPinMigration(localPins, cloud);
  const skipped = dedupePins(localPins).length - toCopy.length;
  let copied = 0, failed = 0;
  for (const p of toCopy) {
    const r = await addPinCloud(client, p);
    if (r.ok) copied++; else failed++;
  }
  return { copied, skipped, failed };
}

/* ---- change notification: same-tab emitter + cross-tab storage + tab-focus refetch --- */
const subs = new Set();
function emit() { for (const cb of subs) { try { cb(); } catch (_) { /* a bad subscriber can't break the rest */ } } }
export function subscribePins(cb) {
  subs.add(cb);
  // Cross-tab: another tab wrote the local bucket. Cloud writes don't touch localStorage,
  // so this only fires for the signed-out backend (harmless when signed in).
  const onStorage = (e) => { if (e && e.key && e.key.startsWith("planyr:pins:v1:")) cb(); };
  // Cross-DEVICE: returning to the tab refetches, so device B picks up a pin made on device
  // A without realtime (pins are latency-insensitive personal favorites). The callback is
  // cheap (one RLS-scoped read), so a focus-triggered refetch is well within budget.
  const onVisible = () => { if (typeof document === "undefined" || document.visibilityState === "visible") cb(); };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    window.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  }
  return () => {
    subs.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    }
  };
}

// Additive: a loud channel for a failed cloud pin write, so Library MAY surface a toast.
// Optional for correctness — the honest-revert + telemetry below already make failures
// non-silent — so no caller is required to subscribe.
const errSubs = new Set();
function emitError(msg) { for (const cb of errSubs) { try { cb(msg); } catch (_) { /* isolate */ } } }
export function subscribePinError(cb) {
  errSubs.add(cb);
  return () => errSubs.delete(cb);
}

/* ---- identity gate: a real uid iff Supabase is configured AND signed in, else null --- */
async function cloudUid() {
  if (!supabase) return null;
  try { const u = await getUser(); return u ? u.id : null; } catch (_) { return null; }
}

// Surface a failed cloud write on every loud channel WITHOUT changing caller signatures:
//   1) honest revert — the caller re-reads the true post-write list, so the optimistic ☆
//      snaps back to unpinned (the "it didn't stick" signal, never a fake "pinned ✓");
//   2) telemetry — the same reportClientEvent channel cloudSync/SitePlanner use;
//   3) the additive subscribePinError emitter (optional toast).
function reportPinFailure(op, error) {
  try { reportClientEvent("pin-write-failed", `${op} failed`, { op, error }); } catch (_) { /* never let telemetry throw */ }
  emitError(error);
}

/* ---- public API (async signatures identical to v1) --------------------------------- */

export async function listPins(uid) {
  return (await cloudUid()) ? listPinsCloud(supabase) : readList(uid);
}

export async function addPin(uid, pin) {
  if (!pin || !VALID_TYPE(pin.type) || typeof pin.id !== "string" || !pin.id) return listPins(uid);
  if (await cloudUid()) {
    const r = await addPinCloud(supabase, pin);
    if (!r.ok) reportPinFailure("pin-add", r.error);
    emit();                          // mounted subscribers refetch the AUTHORITATIVE list
    return listPinsCloud(supabase);  // on failure this is unchanged → the ☆ reverts (honest)
  }
  // Signed out: the unchanged v1 local path.
  const list = readList(uid).filter((p) => !(p.type === pin.type && p.id === pin.id));
  list.unshift({ type: pin.type, id: pin.id, projectId: pin.projectId || null, label: pin.label || "" });
  writeList(uid, list);
  return list;
}

export async function removePin(uid, { type, id }) {
  if (await cloudUid()) {
    const r = await removePinCloud(supabase, type, id);
    if (!r.ok) reportPinFailure("pin-remove", r.error);
    emit();
    return listPinsCloud(supabase);
  }
  const list = readList(uid).filter((p) => !(p.type === type && p.id === id));
  writeList(uid, list);
  return list;
}

export async function togglePin(uid, pin) {
  const cur = await listPins(uid);   // read the authoritative source first (cloud or local)
  return isPinned(cur, pin) ? removePin(uid, pin) : addPin(uid, pin);
}

// One-time local → cloud copy on first signed-in load. Non-destructive (keeps the local
// buckets), idempotent (upsert), unions BOTH the per-uid bucket and the signed-out "local"
// bucket. Triggered from Library.jsx behind a per-account marker. `uid` is used only to
// read the local buckets — the cloud rows are owned server-side via auth.uid().
export async function migrateLocalPinsToCloud(uid) {
  if (!supabase || !uid) return { copied: 0, skipped: 0, failed: 0 };
  const local = dedupePins([...readList(uid), ...readList(null)]);
  if (!local.length) return { copied: 0, skipped: 0, failed: 0 };
  const res = await runPinMigration(supabase, local);
  if (res.copied) emit();            // mounted subscribers show the just-migrated pins
  return res;
}
