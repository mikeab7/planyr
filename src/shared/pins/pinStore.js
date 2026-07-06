/* pinStore — pinned folders/files for the Library Home (owner request, 2026-07-05:
 * a File-Explorer-style "main menu" with pinned favorites instead of landing on the tree).
 *
 * v1 backend is per-device localStorage (owner decision, 2026-07-05: "this computer only",
 * upgradeable later). The API is async + uid-keyed FROM DAY ONE so swapping in a Supabase
 * table is a drop-in change for callers; signed-out pins land in the "local" bucket.
 *
 * A pin is { type: "folder"|"file", id, projectId, label }:
 *   • folder pins → a project_folders row id; clicking navigates to that project + folder.
 *   • file pins   → a doc_reviews row id;      clicking opens the drawing in Review.
 * `label` is a display-name snapshot taken at pin time, so a pin stays legible (and loudly
 * "missing", never silently dropped) even if its target can't be resolved later.
 */

const keyFor = (uid) => `planyr:pins:v1:${uid || "local"}`;
const VALID_TYPE = (t) => t === "folder" || t === "file";

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

/* ---- change notification (same-tab emitter + cross-tab storage event) ---- */
const subs = new Set();
function emit() { for (const cb of subs) { try { cb(); } catch (_) { /* a bad subscriber can't break the rest */ } } }
export function subscribePins(cb) {
  subs.add(cb);
  const onStorage = (e) => { if (e && e.key && e.key.startsWith("planyr:pins:v1:")) cb(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    subs.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/* ---- API (async signatures — the future cloud backend slots in without caller changes) ---- */
export async function listPins(uid) { return readList(uid); }

export async function addPin(uid, pin) {
  if (!pin || !VALID_TYPE(pin.type) || typeof pin.id !== "string" || !pin.id) return readList(uid);
  const list = readList(uid).filter((p) => !(p.type === pin.type && p.id === pin.id));
  list.unshift({ type: pin.type, id: pin.id, projectId: pin.projectId || null, label: pin.label || "" });
  writeList(uid, list);
  return list;
}

export async function removePin(uid, { type, id }) {
  const list = readList(uid).filter((p) => !(p.type === type && p.id === id));
  writeList(uid, list);
  return list;
}

export async function togglePin(uid, pin) {
  const cur = readList(uid);
  const has = cur.some((p) => p.type === pin.type && p.id === pin.id);
  return has ? removePin(uid, pin) : addPin(uid, pin);
}

export function isPinned(list, { type, id }) {
  return Array.isArray(list) && list.some((p) => p.type === type && p.id === id);
}
