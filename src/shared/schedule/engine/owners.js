// src/shared/schedule/engine/owners.js
//
// Task owners: the ordered owner list, the owner↔contact name link, rename/remove cascades.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/page.js (npm run build:sequence-page), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.

// ── Owner (NEW-1) — an ORDERED LIST of contact names; the FIRST is the accountable one, implicitly
// (no separate "primary" control to maintain). Older data stored a single string; every reader goes
// through ownerListOf so a legacy string (or any other stray shape a bad import hands back) coerces
// the same way everywhere a bare string always has — this file's own tests still pass one, and a
// real array has to agree with them. Filtering matches ANY owner in the list; grouping, sorting and
// rollups read the FIRST only (see ownerListOf's callers in evalFieldCondition / the grid+master
// sort comparators / the dashboard-facing consumers below).
export const OWNER_CAP = 6;

 // a task can carry a driver plus a couple of co-owners/reviewers who share
                      // responsibility; past that it stops being an ownership list and starts being
                      // a mailing list, which is what this field is not for. Enforced in ContactPicker.
export const ownerListOf = t => {
  const rp = t && t.responsibleParty;
  const raw = Array.isArray(rp) ? rp : (rp ? [rp] : []);
  const seen = new Set(); const out = [];
  raw.forEach(name => {
    const s = String(name == null ? "" : name).trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;         // defensive de-dupe — a duplicate name must never double-count
    seen.add(k); out.push(s);
  });
  return out;
};

// B1953795 (S7) -- ONE normalizer for the owner <-> contact NAME link. A task's owner is a name string and
// a contact is settings.contacts[].name; every place that decides "is this the same person" (the picker,
// ensureContacts, and the rename/delete cascade) compares through ownerKey, so a legacy 'jon smith' on a
// task and the contact 'Jon Smith' are the same link everywhere. Display casing is NEVER rewritten: a
// name keeps the casing its author typed; only a rename to a NEW name replaces it.
export const ownerKey = n => String(n == null ? "" : n).trim().toLowerCase();

export const ownerHas = (list, name) => { const k = ownerKey(name); return (Array.isArray(list) ? list : []).some(n => ownerKey(n) === k); };

export const renameOwnerIn = (list, oldName, newName) => {
  const ok = ownerKey(oldName); const seen = new Set(); const out = [];
  (Array.isArray(list) ? list : []).forEach(n => { const v = ownerKey(n) === ok ? newName : n; const k = ownerKey(v); if (seen.has(k)) return; seen.add(k); out.push(v); });
  return out;
};

export const removeOwnerFrom = (list, goneName) => { const ok = ownerKey(goneName); return (Array.isArray(list) ? list : []).filter(n => ownerKey(n) !== ok); };

export const OWNER_JOIN = "; ";

   // NEVER a comma — a comma is a name character (NEW-2) and export/re-import
                           // must not recreate one owner's junk-contact bug through a joined cell.
export const ownerJoin = list => (Array.isArray(list) ? list : []).join(OWNER_JOIN);

// First owner + a count of the rest, for the narrow grid/master cell (the column must not widen).
// `title` carries every name for a hover tooltip, so nothing is lost — it's just not all on screen.
export const ownerDisplayParts = list => {
  const l = Array.isArray(list) ? list : [];
  if (!l.length) return { label: "", title: "" };
  const extra = l.length - 1;
  return { label: extra > 0 ? `${l[0]} +${extra}` : l[0], title: l.join(", ") };
};

// One-time shape fix: a legacy `responsibleParty` string becomes a one-element list; no existing
// task changes meaning. Naturally idempotent (array in → same array out via ownerListOf's own
// de-dupe), so — UNLIKE normalizeToV6/V7/V8 below, which each gate on their own _v6/_v7/_v8 flag —
// this needs no version flag of its own. That matters: every real schedule already carries
// `_v6:_v7:_v8: true`, so folding this into any of those would silently skip every already-migrated
// production document, which is exactly the data this feature has to reach.
export const normalizeOwnerLists = d => {
  if (!d || typeof d !== "object") return d;
  const projects = {};
  const srcProjects = (d.projects && typeof d.projects === "object") ? d.projects : {};
  Object.entries(srcProjects).forEach(([id, proj]) => {
    if (!proj || typeof proj !== "object") { projects[id] = proj; return; }
    const srcTasks = Array.isArray(proj.tasks) ? proj.tasks : [];
    projects[id] = {...proj, tasks: srcTasks.map(t => (t && typeof t === "object") ? {...t, responsibleParty: ownerListOf(t)} : t)};
  });
  return {...d, projects};
};
