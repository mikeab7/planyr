/* Pure folder-tree operations (B650) — no ids-from-nowhere, no Drive, no Supabase, no React.
 *
 * The live tree is a FLAT list of rows: { id, parentId, name, order, trashed?, ... }.
 *   • id        — Planyr's stable folder id (a uuid minted by the store; here just opaque).
 *   • parentId  — parent row id, or null for a top-level category (whose Drive parent is the
 *                 project's own Drive root folder).
 *   • order     — sort key among siblings (1-based); ties break on name.
 *   • trashed   — soft-deleted rows are kept for the mirror to trash in Drive, then hidden.
 *
 * These helpers are the shared brain for the store, the Drive-mirror planner, and the UI, so
 * the same tree logic is unit-tested once and can't drift between them.
 */

// "1" -> "01", "12" -> "12". Two-digit zero-pad for the numbered-prefix convention.
export const padPrefix = (n) => String(n).padStart(2, "0");

/* Flatten the nested FOLDER_TEMPLATE into ordered rows the store seeds from. Each row carries
 * a stable `path` ("02. Design/01. Drawings/05. Civil") and its `parentPath` (null at top) so
 * the store can assign a real id per path and resolve parentId by parentPath. `order` is the
 * 1-based sibling index (template array order); `depth` is 0 at the top. Depth-ascending, so
 * a parent always precedes its children — the order both the store insert and the Drive
 * create-pass rely on (a folder can't be created before its parent). */
export function flattenTemplate(template, { parentPath = null, depth = 0, out = [] } = {}) {
  (template || []).forEach((node, i) => {
    const name = node && node.name;
    if (!name) return;
    const path = parentPath ? `${parentPath}/${name}` : name;
    out.push({ path, parentPath, name, order: i + 1, depth });
    if (node.children && node.children.length) {
      flattenTemplate(node.children, { parentPath: path, depth: depth + 1, out });
    }
  });
  return out;
}

// Total folder count in a template (for tests + the "133 folders" UI hint). Pure.
export function countTemplate(template) {
  return (template || []).reduce(
    (n, node) => n + 1 + (node && node.children ? countTemplate(node.children) : 0),
    0,
  );
}

// Live (non-trashed) rows only — the set the tree view and validation see.
export const liveRows = (rows) => (rows || []).filter((r) => r && !r.trashed);

// Sort helper: by numeric `order`, then by name (locale-aware, so "01." < "02." naturally).
const bySort = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name));

// Direct children of a parent (null = top level), live only, sorted. Does not mutate.
export function childrenOf(rows, parentId = null) {
  return liveRows(rows).filter((r) => (r.parentId ?? null) === (parentId ?? null)).slice().sort(bySort);
}

/* Nest the flat rows into a render tree: [{ ...row, children: [...] }], live only, sorted at
 * every level. Rows whose parent is missing/trashed surface at the top level rather than
 * vanishing (never silently drop a folder). */
export function treeify(rows) {
  const live = liveRows(rows);
  const ids = new Set(live.map((r) => r.id));
  const byParent = new Map();
  for (const r of live) {
    const p = r.parentId != null && ids.has(r.parentId) ? r.parentId : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(r);
  }
  const build = (parentId) =>
    (byParent.get(parentId) || [])
      .slice()
      .sort(bySort)
      .map((r) => ({ ...r, children: build(r.id) }));
  return build(null);
}

// Every descendant id of `id` (excludes `id` itself), across ALL rows (trashed included, so a
// re-delete can't miss a still-un-trashed grandchild). Set for O(1) membership.
export function descendantIds(rows, id) {
  const kids = new Map();
  for (const r of rows || []) {
    const p = r.parentId ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(r.id);
  }
  const out = new Set();
  const stack = [...(kids.get(id) || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of kids.get(cur) || []) stack.push(c);
  }
  return out;
}

// `id` plus all its descendants — the exact set a delete removes / a delete-confirm enumerates.
export function subtreeIds(rows, id) {
  const s = descendantIds(rows, id);
  s.add(id);
  return s;
}

// Would re-parenting `id` under `newParentId` create a cycle? True if newParentId is `id`
// itself or any of its descendants. Guards move/reparent.
export function wouldCreateCycle(rows, id, newParentId) {
  if (newParentId == null) return false;
  if (newParentId === id) return true;
  return descendantIds(rows, id).has(newParentId);
}

// Next free sort order among a parent's live children (max + 1, min 1).
export function nextOrder(rows, parentId = null) {
  const kids = childrenOf(rows, parentId);
  return kids.reduce((m, r) => Math.max(m, r.order || 0), 0) + 1;
}

/* Validate a folder name against its siblings. Rejects: empty/whitespace, a "/" (path
 * separator — would corrupt the mirror path), control chars, and a case-insensitive duplicate
 * among the siblings (Drive treats "Civil" and "civil" as distinct but users won't, and a dup
 * makes the mirror ambiguous). `excludeId` skips the row being renamed. Returns { ok, error }. */
export function validateFolderName(name, siblings = [], excludeId = null) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Folder name can't be empty." };
  if (trimmed.includes("/")) return { ok: false, error: 'Folder name can’t contain "/".' };
  if (/[\u0000-\u001f]/.test(trimmed)) return { ok: false, error: "Folder name has invalid characters." };
  const lower = trimmed.toLowerCase();
  const clash = (siblings || []).some(
    (s) => s && s.id !== excludeId && String(s.name).trim().toLowerCase() === lower,
  );
  if (clash) return { ok: false, error: "A folder with that name already exists here." };
  return { ok: true, name: trimmed };
}

/* Suggest a numbered name for a NEW folder that keeps the "NN. Label" convention: find the
 * highest leading two-digit prefix among siblings and go one higher, zero-padded. If no
 * sibling is numbered, fall back to the bare label. Purely a suggestion — the user can edit it. */
export function suggestNextNumberedName(siblings = [], label = "New Folder") {
  const nums = (siblings || [])
    .map((s) => /^\s*(\d{1,3})\.\s/.exec(String(s && s.name) || ""))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  if (!nums.length) return label;
  return `${padPrefix(Math.max(...nums) + 1)}. ${label}`;
}

/* Turn a template into the exact insert rows that seed a project (B650). Pure — the id
 * generator is injected (crypto.randomUUID in the app; deterministic in tests). Because
 * flattenTemplate is depth-ordered, a parent's id is always assigned before its children, so
 * parent_id resolves in a single pass. Column names are snake_case to match the Supabase table
 * (project_folders) so the store can insert the result verbatim. */
export function buildSeedRows(template, { projectId, templateVersion = null, makeId } = {}) {
  if (typeof makeId !== "function") throw new Error("buildSeedRows requires a makeId() generator.");
  const idByPath = new Map();
  return flattenTemplate(template).map((r) => {
    const id = makeId();
    idByPath.set(r.path, id);
    return {
      id,
      project_id: projectId,
      parent_id: r.parentPath ? idByPath.get(r.parentPath) || null : null,
      name: r.name,
      sort_order: r.order,
      template_version: templateVersion,
    };
  });
}
