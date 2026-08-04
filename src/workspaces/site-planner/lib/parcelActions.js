/* NEW-1 — THE inventory of everything a user can do to a parcel, and the ONE model behind the
 * right-rail Parcel tools menu.
 *
 * The owner's report: the right rail's Parcel flyout carried three of the parcel actions the app
 * actually has (Draw / Deed / Split). Remove had no entry point in the rail at all, Combine had
 * none, setbacks lived on the OPPOSITE side of the screen, and boundary editing existed only as
 * prose inside the Select tool's hint string — so a user who never hovered that tooltip never
 * learned the app could do it.
 *
 * Why this is a module and not a JSX literal: the menu is the DISCOVERABLE SURFACE, so
 * "does every parcel action have a menu path?" has to be a property a test can assert, not a
 * thing a reviewer notices. `PARCEL_ACTIONS` is the inventory (every action, where else it is
 * reachable from, and what it needs to be usable); `parcelMenuModel` is the pure decision — which
 * rows show, which are enabled, which read as ACTIVE right now, and why a disabled one is
 * disabled. `SitePlanner.jsx` maps a row id to its handler and renders; it decides nothing.
 *
 * ⛔ Adding a parcel action? Add it HERE, in the group where the work happens. `test/parcelActions.test.js`
 * fails if an inventory entry has no row in the menu model, and if a row has no handler wired at
 * the render site — which is exactly the drift that produced the three-of-eleven menu.
 *
 * THE TWO-SIDED NAMING SPLIT (the other half of the report): "Parcel" was a LEFT-rail panel AND a
 * RIGHT-rail tool — two different things sharing one word. The split we settled on:
 *   • the RIGHT rail owns ACTIONS — things you DO to a parcel ..... "Parcel tools"
 *   • the LEFT panel owns ATTRIBUTES & SETTINGS — things a parcel HAS ..... "Land"
 * Setbacks are an attribute, so they stay in the left panel — but the right menu carries a
 * one-click path to them (and the left panel carries one back), so landing on the wrong side is
 * never a dead end. `PARCEL_SURFACES` is that decision, asserted distinct in the test.
 */

/* The two surfaces, named so they can never collide again. */
export const PARCEL_SURFACES = {
  rail: { id: "rail", name: "Parcel tools", owns: "actions" },
  panel: { id: "panel", name: "Land", owns: "attributes" },
};

/* Group order IS the order the work happens: create → modify → remove. */
export const PARCEL_GROUPS = [
  { id: "create", label: "Add land" },
  { id: "modify", label: "Change a parcel" },
  { id: "remove", label: "Remove" },
];

/* ---------------------------------------------------------------------------------------------
 * THE INVENTORY. One entry per thing a user can do to a parcel.
 *
 *   id        stable key; the render site maps it to a handler
 *   group     which section of the menu it belongs to
 *   label     menu wording (a function when it toggles)
 *   detail    the "in Land →" / shortcut hint shown right-aligned, or null
 *   elsewhere every OTHER surface the same action is reachable from. The rule the owner set:
 *             a gesture or a right-click may stay as the FAST path, but it may never be the ONLY
 *             path — so an entry whose `elsewhere` is a gesture is exactly why this menu exists.
 * ------------------------------------------------------------------------------------------- */
export const PARCEL_ACTIONS = [
  // ---- create -------------------------------------------------------------------------------
  { id: "draw", group: "create", label: "Draw new parcel", elsewhere: ["land-panel: ＋ Add ▾"] },
  { id: "deed", group: "create", label: "Deed / Title — metes & bounds…", elsewhere: [] },
  { id: "identify", group: "create", label: "Click a lot on the map", detail: "county records", elsewhere: ["land-panel: ＋ Add ▾"] },
  { id: "address", group: "create", label: "Add by address…", elsewhere: ["land-panel: ＋ Add ▾"] },
  // ---- modify -------------------------------------------------------------------------------
  { id: "split", group: "modify", label: "Split a parcel", elsewhere: ["land-panel: ✂ Split"] },
  { id: "combine", group: "modify", label: "Combine parcels", elsewhere: ["land-panel: ⧉ Merge", "gesture: Shift-click, then Enter", "right-click a parcel"] },
  { id: "boundary", group: "modify", label: "Edit boundary corners", elsewhere: ["gesture: drag a corner / ＋ on an edge / Shift-click a corner"] },
  { id: "setbacks", group: "modify", label: "Setbacks & parcel settings", detail: "in Land →", elsewhere: ["land-panel: Boundary section"] },
  { id: "lock", group: "modify", label: (s) => (s.selectedLocked ? "Unlock boundary" : "Lock boundary"), elsewhere: ["land-panel: 🔒 Lock"] },
  { id: "active", group: "modify", label: (s) => (s.selectedActive === false ? "Count in yield totals" : "Exclude from yield totals"), elsewhere: ["land-panel: row checkbox"] },
  { id: "chip", group: "modify", label: (s) => (s.selectedChipHidden ? "Show acreage label" : "Hide acreage label"), elsewhere: ["right-click a parcel", "right-click the acreage label"] },
  { id: "chipReset", group: "modify", label: "Reset label position", elsewhere: ["right-click a parcel"] },
  // ---- remove -------------------------------------------------------------------------------
  { id: "removeMode", group: "remove", label: "Remove parcels — click to delete", elsewhere: ["Parcel tool banner: ✕ Remove", "land-panel: per-row ✕"] },
  { id: "deleteSelected", group: "remove", label: "Delete this parcel", detail: "Del", danger: true, elsewhere: ["right-click a parcel", "key: Delete"] },
];

const byId = new Map(PARCEL_ACTIONS.map((a) => [a.id, a]));
export const parcelAction = (id) => byId.get(id) || null;

/* A row that needs a selected parcel is SHOWN but disabled when nothing is selected, so the
 * capability stays visible (that is the whole point of this menu) — never hidden, which is how
 * an action becomes undiscoverable again. The one exception is `chipReset`, which is meaningless
 * unless the label has actually been dragged somewhere. */
const NEEDS_SELECTION = ["lock", "active", "chip", "chipReset", "deleteSelected"];

/**
 * The menu, decided.
 *
 * @param {object} state
 *   parcelCount      how many parcels exist in the plan
 *   activeCount      how many are active (inactive parcels never merge — B170)
 *   hasOrigin        the plan is georeferenced (county identify / address lookup need it)
 *   selected         the selected parcel, or null: { locked, active, chipHidden, labelOffset }
 *   tool             the live tool id
 *   parcelMode       "add" | "remove" (the Parcel tool's sub-mode)
 *   mergePick        click-to-pick merge mode is armed
 *   boundaryEdit     boundary-editing mode is armed
 * @returns {Array<{id,label,rows}>} groups in create → modify → remove order; empty groups dropped.
 */
export function parcelMenuModel(state = {}) {
  const s = {
    parcelCount: 0, activeCount: 0, hasOrigin: false, selected: null,
    tool: "select", parcelMode: "add", mergePick: false, boundaryEdit: false, ...state,
  };
  const sel = s.selected || null;
  const labelState = {
    selectedLocked: !!(sel && sel.locked),
    selectedActive: sel ? sel.active : undefined,
    selectedChipHidden: !!(sel && sel.chipHidden),
  };
  const hasParcels = s.parcelCount >= 1;

  // enabled + why-not, per row. `null` reason means "enabled".
  const gate = (id) => {
    if (NEEDS_SELECTION.includes(id) && !sel) return "Select a parcel first";
    switch (id) {
      case "identify":
      case "address":
        return s.hasOrigin ? null : "Add a parcel from the map first — this plan isn't on the map yet";
      case "split":
      case "boundary":
      case "setbacks":
      case "removeMode":
        return hasParcels ? null : "No parcels in this plan yet";
      case "combine":
        return s.activeCount >= 2 ? null : "Needs two or more active parcels";
      default:
        return null;
    }
  };

  // which row reads as the mode you are IN right now
  const isActive = (id) => {
    switch (id) {
      case "draw": return s.tool === "parcel" && s.parcelMode === "add";
      case "removeMode": return s.tool === "parcel" && s.parcelMode === "remove";
      case "split": return s.tool === "split";
      case "combine": return !!s.mergePick;
      case "boundary": return !!s.boundaryEdit;
      default: return false;
    }
  };

  const rowFor = (a) => {
    if (a.id === "chipReset" && !(sel && sel.labelOffset)) return null; // meaningless until dragged
    const reason = gate(a.id);
    return {
      id: a.id,
      label: typeof a.label === "function" ? a.label(labelState) : a.label,
      detail: a.detail || null,
      enabled: !reason,
      disabledReason: reason,
      active: isActive(a.id),
      danger: !!a.danger,
    };
  };

  return PARCEL_GROUPS
    .map((g) => ({ id: g.id, label: g.label, rows: PARCEL_ACTIONS.filter((a) => a.group === g.id).map(rowFor).filter(Boolean) }))
    .filter((g) => g.rows.length > 0);
}

/** Every action id the model can render, flattened — what the wiring guard checks against. */
export function parcelMenuIds(state) {
  return parcelMenuModel(state).flatMap((g) => g.rows.map((r) => r.id));
}

/* The boundary-editing banner's copy. It lives here (not inline at the render site) so the ONE
 * sentence that teaches the gesture is written once and can be asserted.
 *
 * The LOCKED case is not a nicety: a freshly drawn parcel arrives locked, and `editablePath()`
 * returns null for a locked parcel — so without this branch "Edit boundary corners" would arm a
 * mode in which every gesture it just taught silently does nothing. The banner says so and carries
 * the Unlock button, rather than unlocking behind the user's back. */
export function boundaryEditHint({ hasSelection = false, locked = false } = {}) {
  if (!hasSelection) return "Click a parcel to edit its boundary";
  if (locked) return "This parcel is locked, so its shape is protected — unlock it to reshape";
  return "Drag a corner to move it · click the dot on an edge to add a corner · Shift-click a corner to delete one";
}
