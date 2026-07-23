/* v3 UI SPEC Part B — the pond-inspector's VISIBLE copy, as pure data so the chip
 * vocabulary (B4), the collapsed-group titles/summaries (B5), the Dimensions labels (B3),
 * and the Purpose descriptors (B3.6) unit-test without a browser.
 *
 * Presentation only: nothing here computes a pond value — the caller passes in booleans the
 * engine already derived and this decides which chips/summaries show and with what words.
 * The full original prose that used to render inline lives in each entry's `popover` (moved
 * into the ⓘ, nothing lost). `when(facts)` gates a chip on a condition the caller supplies.
 *
 * v3 changes vs the earlier "FINAL UI SPEC": the top warning chips are now exactly the three
 * TRUE-when-relevant watch-outs (flood-estimated, criteria-unverified, in-floodway). The old
 * "Rim below flood level" chip is deleted (the status card B2 already states it) and the
 * standalone "Elevations: NAVD88" chip moves into the FLOOD & DATUM group (B5.3). */

// ── B4: the amber watch-out chips at the top of the inspector. Each renders ONLY when its
// condition is true; the Chip component supplies its own ⚠ glyph, so the text carries none.
export const POND_CHIP_DEFS = [
  {
    id: "flood-est", tone: "amber", text: "Flood level estimated",
    popover: "Flood level is estimated from grade at the Zone A boundary. Confirm with a sealed H&H / Atlas-14 study.",
    when: (f) => !!f.floodEstimated,
  },
  {
    id: "crit-unv", tone: "amber", text: "Criteria unverified",
    popover: "Criteria values are unverified placeholders. Confirm against the county's criteria manual in Standards.",
    when: (f) => !!f.criteriaUnverified,
  },
  {
    id: "floodway", tone: "amber", text: "In floodway: no fill",
    popover: "Fill and structures in the regulatory floodway are prohibited outright; pond CUT in the floodway can be permissible with a no-rise review. Informational, never a green light.",
    when: (f) => !!f.inFloodway,
  },
];

export function pondInspectorChips(facts = {}) {
  return POND_CHIP_DEFS.filter((c) => c.when(facts));
}

// ── B5.3: the FLOOD & DATUM group's reference notes — the flood-WSE credit explanation, the
// Zone-A estimate, the hydraulic-connection paragraph, and the NAVD88/NGVD29 datum warning.
// Each renders as a one-line entry whose full paragraph rides its ⓘ (no visible paragraphs).
// The datum note is the old standalone chip, relocated here per B4's deletion note.
export const POND_FLOOD_NOTES = {
  datum: "Elevations are feet NAVD88. Older documents may cite NGVD29; convert before entering (Houston subsidence makes mixed datums a multi-foot silent error).",
  split: "Above the flood level the basin is empty when the design storm arrives, so that volume counts toward detention. Below the flood level the flood already occupies the volume at design stage: no detention credit, but it is your candidate compensating storage for fill (hydraulic connection and stage distribution: your engineer confirms).",
  estimate: "Where the reach is unstudied Zone A, the flood level is read off grade at the Zone A boundary. Confirm with a sealed H&H / Atlas-14 study.",
};

// ── B5: the four collapsed groups, in fixed top→bottom order, with the exact v3 titles.
export const POND_GROUPS = [
  { id: "sizing", title: "Engineering assumptions" },
  { id: "outlet", title: "Outlet & storms" },
  { id: "flood", title: "Flood & datum" },
  { id: "appearance", title: "Appearance" },
];

// ── B5: one-line closed-state summaries. G6 — a summary describes the group's CONTENTS and
// never carries the requirement/provided numbers (those live once, in the status card B2).
// Pure string builders; the caller passes already-formatted value strings.
export const pondGroupSummary = {
  sizing: () => "criteria & drainage",
  outlet: ({ hasOutlet, stages, fails }) =>
    !hasOutlet ? "no outlet yet"
      : fails == null ? `${stages} stage${stages === 1 ? "" : "s"}`
      : fails > 0 ? `${stages} stage${stages === 1 ? "" : "s"} · ${fails} FAIL`
      : `${stages} stage${stages === 1 ? "" : "s"} · all storms PASS`,
  flood: ({ wse, estimated }) =>
    wse != null ? `flood ${wse}′${estimated ? " est." : ""} · NAVD88` : "NAVD88",
  appearance: () => "fill · outline · opacity",
};

// ── B3: the Dimensions row LABELS. Their VALUES are user data. Listed here so the inspector
// and its test share one source.
export const POND_DIMENSION_LABELS = ["Water area", "Land take", "Depth", "Rim", "Holds", "Purpose"];

// ── B3.6: the Purpose control. The ⓘ carries the full four-mode explanation; each mode also
// shows a short descriptor next to its value (the small "· {descriptor}" suffix).
export const POND_PURPOSE_TOOLTIP =
  "Auto: serve whatever the site needs. Detention: rate-control storage only. Mitigation: flood-fill offset only. Hybrid: both, split by elevation.";

export const POND_PURPOSE_DESCRIPTOR = {
  auto: "picks by site needs",
  detention: "rate-control storage only",
  mitigation: "flood-fill offset only",
  hybrid: "both, split by elevation",
};
