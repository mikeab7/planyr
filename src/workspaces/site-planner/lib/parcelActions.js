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

/* Group order IS the order the work happens: add → edit → this parcel's switches → delete.
 * (NEW-1, owner-approved "A · Sorted list", 2026-10-11.) `this` only exists while a parcel is
 * selected; `delete` has no heading — it sits after a divider at the bottom. */
export const PARCEL_GROUPS = [
  { id: "create", label: "Add land" },
  { id: "modify", label: "Edit" },
  { id: "this", label: "This parcel" },
  { id: "remove", label: "" },
];

/* ---------------------------------------------------------------------------------------------
 * THE INVENTORY. One entry per thing a user can do to a parcel.
 *
 *   id        stable key; the render site maps it to a handler
 *   group     which section of the menu it belongs to
 *   label     menu wording
 *   hint      the one-line secondary text under the label, or absent
 *   icon      key into the menu's 16px stroke icon set (components/ParcelToolsMenu.jsx)
 *   detail    the right-aligned "Land ›" / "Del" hint, or null
 *   kind      "switch" → the row is an on/off setting; `on(p)` is its state for the selected parcel
 *
 * WHERE ELSE each one is reachable — the rule the owner set is that a gesture or a right-click may
 * stay as the FAST path but may never be the ONLY path, and these are the entries that were:
 *   combine .......... gesture: Shift-click parcels, then Enter · right-click a parcel
 *   boundary ......... gesture ONLY: drag a corner / ＋ on an edge / Shift-click a corner
 *   chip ............. right-click a parcel · right-click the acreage label
 *   chipReset ........ right-click a parcel
 *   deleteSelected ... right-click a parcel · the Delete key
 *   lock ............. Land tab's selected-parcel Boundary section · per-row (hover) · header "Lock all"
 *   active ........... Land tab's selected-parcel Boundary section · per-row Active checkbox
 *   draw / identify / address ... also the Land tab's ＋ icon (NEW-1, B1239328 — Split moved OFF the
 *   Land tab entirely; it and Combine live here only now)
 *   remove-by-clicking ... the Parcel tool's own banner (Draw / Remove) — NOT a menu row any more:
 *   the owner dropped "Remove parcels — click to delete" from this menu (2026-10-11); Delete parcel
 *   on a selected parcel is the menu's way to remove one. The Parcel tool's Remove click-to-delete sub-mode (and
 *   `startRemoveParcels`) were RETIRED 2026-10-22 (NEW-1): every delete is the one `deleteParcels`, with an Undo toast.
 * That list is PROSE on purpose: it is provenance with no runtime consumer, and shipping it as
 * string data cost real bytes in the Site route's bundle for nothing. `test/parcelActions.test.js`
 * states the gesture-only set itself and asserts each member has a row.
 *
 * A SWITCH row keeps ONE fixed label and shows its state in the switch — "Count in yield totals" is
 * today's "Exclude from yield totals" INVERTED (ON = included = `active !== false`, the same stored
 * flag); "Show acreage label" is the inverse of `chipHidden`.
 * ------------------------------------------------------------------------------------------- */
export const PARCEL_ACTIONS = [
  // ---- create -------------------------------------------------------------------------------
  { id: "draw", group: "create", icon: "draw", label: "Draw a parcel", hint: "Click its corners on the map" },
  { id: "identify", group: "create", icon: "identify", label: "Pick county lots", hint: "Click lots to add them" },
  { id: "deed", group: "create", icon: "deed", label: "From a deed", hint: "Type the metes and bounds calls" },
  { id: "address", group: "create", icon: "address", label: "Find by address" },
  // ---- edit ---------------------------------------------------------------------------------
  { id: "split", group: "modify", icon: "split", label: "Split" },
  { id: "combine", group: "modify", icon: "combine", label: "Combine" },
  { id: "boundary", group: "modify", icon: "boundary", label: "Edit corners" },
  // ---- this parcel --------------------------------------------------------------------------
  { id: "lock", group: "this", kind: "switch", label: "Lock boundary", on: (p) => !!p.locked },
  { id: "active", group: "this", kind: "switch", label: "Count in yield totals", on: (p) => p.active !== false },
  { id: "chip", group: "this", kind: "switch", label: "Show acreage label", on: (p) => !p.chipHidden },
  { id: "chipReset", group: "this", label: "Reset label position" },
  { id: "setbacks", group: "this", label: "Properties", hint: "Setbacks, style and record", detail: "Land ›" }, // opens THIS parcel's page (NEW-1, 2026-10-14)
  // ---- delete -------------------------------------------------------------------------------
  { id: "deleteSelected", group: "remove", icon: "trash", label: "Delete parcel", detail: "Del", danger: true },
];

/* A row that needs a selected parcel is SHOWN but disabled when nothing is selected, so the
 * capability stays visible (that is the whole point of this menu) — never hidden. The `this`
 * group is the exception NEW-1 asked for: it only exists while a parcel is selected, and
 * `chipReset` inside it is meaningless unless the label has actually been dragged somewhere. */
const NEEDS_SELECTION = ["lock", "active", "chip", "chipReset", "setbacks", "deleteSelected"];

/**
 * The menu, decided.
 *
 * @param {object} state
 *   parcelCount      how many parcels exist in the plan
 *   activeCount      how many are active (inactive parcels never merge — B170)
 *   hasOrigin        the plan is georeferenced (county identify / address lookup need it)
 *   selected         the selected parcel, or null: { locked, active, chipHidden, labelOffset, name, acres, color }
 *   canDelete        a parcel exists to delete (defaults to `!!selected`; the render site also
 *                    passes true for a plan's only lot, which Delete has always reached unselected)
 *   tool             the live tool id
 *   parcelMode       always "add" now (the Remove sub-mode was retired 2026-10-22); kept so a caller may omit it
 *   mergePick        click-to-pick merge mode is armed
 *   boundaryEdit     boundary-editing mode is armed
 * @returns {Array<{id,label,rows,reason,header?}>} groups in add → edit → this parcel → delete order;
 *   empty groups dropped. The `this` group exists only with a selected parcel and carries `header`
 *   ({name, acres, color}) for its swatch · name · acreage line.
 */
export function parcelMenuModel(state = {}) {
  const s = {
    parcelCount: 0, activeCount: 0, hasOrigin: false, selected: null,
    tool: "select", parcelMode: "add", mergePick: false, boundaryEdit: false, canDelete: null, ...state,
  };
  const sel = s.selected || null;
  const hasParcels = s.parcelCount >= 1;

  // enabled + why-not, per row. `null` reason means "enabled".
  const gate = (id) => {
    if (id === "deleteSelected" && !sel && s.canDelete) return null;
    if (NEEDS_SELECTION.includes(id) && !sel) return "Select a parcel first";
    switch (id) {
      case "identify":
      case "address":
        return s.hasOrigin ? null : "Add a parcel from the map first — this plan isn't on the map yet";
      case "split":
      case "boundary":
      case "setbacks":
        return hasParcels ? null : "No parcels in this plan yet";
      // NEW-1 (B1239328) — gated on parcelCount, NOT activeCount. This is the ONLY place Combine
      // can be armed now that the Land tab's own looser-gated "⧉ Merge" button is gone, and
      // `startMergePick` itself has no active-count requirement: entering pick mode with an
      // inactive parcel present is the exact B966626 scenario (pick it → a named refusal tells you
      // to reactivate it first, never a silent no-op). Gating entry on activeCount would make that
      // flow unreachable again the moment the count drops to one.
      case "combine":
        return s.parcelCount >= 2 ? null : "Needs two or more parcels";
      default:
        return null;
    }
  };

  // which row reads as the mode you are IN right now
  const isActive = (id) => {
    switch (id) {
      case "draw": return s.tool === "parcel" && s.parcelMode === "add";
      case "split": return s.tool === "split";
      case "combine": return !!s.mergePick;
      case "boundary": return !!s.boundaryEdit;
      default: return false;
    }
  };

  const rowFor = (a) => {
    if (a.group === "this" && !sel) return null; // the whole section exists only for a selected parcel
    if (a.id === "chipReset" && !(sel && sel.labelOffset)) return null; // meaningless until dragged
    const reason = gate(a.id);
    return {
      id: a.id,
      label: a.label,
      hint: a.hint || null,
      icon: a.icon || null,
      kind: a.kind || "action",
      checked: a.kind === "switch" && sel ? !!a.on(sel) : null,
      detail: a.detail || null,
      enabled: !reason,
      disabledReason: reason,
      active: isActive(a.id),
      danger: !!a.danger,
    };
  };

  /* NEW-2 (B849585) — when EVERY row in a group is disabled, the group carries ONE stated reason
   * instead of leaving the user to infer it from N individually-greyed rows (which is what made
   * the disabled rows read as "13 live options, 9 do nothing" rather than "here's what to do
   * first"). Rows stay VISIBLE and individually disabled either way — this is a header note, not a
   * replacement for the rows (a hidden action is exactly the bug PARCEL_ACTIONS above was written
   * to close). `hasParcels` is checked FIRST because it's the one root cause every row in "modify"/
   * "remove" traces back to on a brand-new plan; when rows disagree for another reason, the first
   * row's own reason is still a true, honest answer for the group. */
  const groupReason = (rows) => {
    if (!rows.length || rows.some((r) => r.enabled)) return null;
    if (!hasParcels) return "Add a parcel first — see Add land above";
    return rows[0].disabledReason;
  };

  return PARCEL_GROUPS
    .map((g) => {
      const rows = PARCEL_ACTIONS.filter((a) => a.group === g.id).map(rowFor).filter(Boolean);
      const out = { id: g.id, label: g.label, rows, reason: g.id === "remove" ? null : groupReason(rows) }; // the lone Delete row explains itself in its own title
      if (g.id === "this" && sel) out.header = { name: sel.name || "This parcel", acres: Number.isFinite(sel.acres) ? sel.acres : null, color: sel.color || null };
      return out;
    })
    .filter((g) => g.rows.length > 0);
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
