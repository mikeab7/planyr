/* FINAL UI SPEC Part A — the condensed pond-inspector's VISIBLE copy, as pure data so the
 * chip vocabulary (A3, exact strings) and the word budget (A4) unit-test without a browser.
 * Presentation only: nothing here computes a pond value — the caller passes in booleans the
 * engine already derived and this decides which chips/summaries show and with what words.
 *
 * Each chip is ≤6 visible words; its full original sentence lives in `popover` (moved into
 * the ⓘ, nothing lost). `when(facts)` gates it on a condition the caller supplies. */

export const POND_CHIP_DEFS = [
  {
    id: "flood-est", tone: "amber", text: "Flood level is estimated",
    popover: "This pond's split is priced off an ESTIMATED flood WSE (grade @ Zone A boundary) — confirm with a sealed H&H / Atlas-14 study.",
    when: (f) => !!f.floodEstimated,
  },
  {
    id: "rim-below", tone: "amber", text: "Rim below flood level",
    popover: "The flood WSE is at or above this pond's top of bank — the basin is fully inundated in the design flood, so usable detention is ZERO. Raise the top of bank (⚡ Design pond) above the flood level.",
    when: (f) => !!f.rimBelowFlood,
  },
  {
    id: "crit-unv", tone: "amber", text: "Criteria unverified",
    popover: "Criteria values are unverified placeholders — edit & confirm in settings against the PCPM / county DCM.",
    when: (f) => !!f.criteriaUnverified,
  },
  {
    id: "navd88", tone: "neutral", text: "Elevations: NAVD88",
    popover: "Elevations are feet NAVD88 — older documents may cite NGVD29; convert before entering (Houston subsidence makes mixed datums a multi-foot silent error).",
    when: () => true,
  },
  {
    id: "floodway", tone: "amber", text: "In floodway: no fill",
    popover: "Floodway note: fill/structures in the regulatory floodway are prohibited outright; pond CUT in the floodway can be permissible with a no-rise review — informational, never a green light.",
    when: (f) => !!f.inFloodway,
  },
];

export function pondInspectorChips(facts = {}) {
  return POND_CHIP_DEFS.filter((c) => c.when(facts));
}

// The four collapsed groups (A1.6), in their fixed top→bottom order.
export const POND_GROUPS = [
  { id: "sizing", title: "Sizing & criteria" },
  { id: "outlet", title: "Outlet & storms" },
  { id: "flood", title: "Flood & datum notes" },
  { id: "appearance", title: "Appearance" },
];

// One-line closed-state summaries (A1.6). Pure string builders; the caller passes already-
// formatted value strings so the number-format rules live in one place (SitePlanner f1/f2).
export const pondGroupSummary = {
  sizing: ({ reqLo, reqHi, req, drainageAc }) =>
    (reqLo != null && reqHi != null ? `req ${reqLo}–${reqHi} ac-ft` : req != null ? `req ${req} ac-ft` : "screening inputs")
    + (drainageAc != null ? ` · drainage ${drainageAc} ac` : ""),
  outlet: ({ hasOutlet, stages, allPass }) =>
    !hasOutlet ? "no outlet"
      : allPass == null ? `${stages} stage${stages === 1 ? "" : "s"}`
      : `${stages} stage${stages === 1 ? "" : "s"} · all storms ${allPass ? "PASS" : "check"}`,
  flood: ({ wse, estimated }) =>
    wse != null ? `flood level ${wse}′${estimated ? " (estimated)" : ""}` : "no flood data",
  appearance: () => "fill · outline · opacity",
};

// The at-a-glance row LABELS (A1.4). Their VALUES are user data and are excluded from the
// A4 word budget, but the labels are listed here so the inspector and its test share one source.
export const POND_AT_A_GLANCE_LABELS = [
  "Water footprint", "Land take (incl. berm)", "Total depth", "Rim (top of bank)", "Holds", "Purpose",
];

// The Purpose toggle option tooltips (A1.4, exact copy).
export const POND_PURPOSE_TOOLTIPS = {
  auto: "Pick by site needs",
  detention: "Rate-control storage only",
  mitigation: "Flood-fill offset only",
  hybrid: "Both, split by elevation",
};
