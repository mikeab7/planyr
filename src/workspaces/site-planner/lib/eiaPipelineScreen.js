/* NEW-1 (FL/GA pipelines) — the pure half of the Florida / Georgia pipeline screen.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: **for FL/GA, "nothing found" is never "clear".**
 *
 * Texas pipelines come from the authoritative TxRRC service, which is complete for permitted
 * lines, so an empty answer there is a real (caveated) "none mapped". Florida and Georgia publish
 * no statewide pipeline GIS at all; the only public statewide source is the EIA Energy Atlas —
 * national, MAJOR TRANSMISSION lines only, no local gas distribution mains, gathering lines not
 * reliably mapped, geometry schematic (Colonial across Georgia is a handful of vertices). PHMSA's
 * NPMS is complete but restricted to government officials and operators. An empty EIA answer
 * therefore says only "no major transmission line on a coarse map" — reading it as "clear" would
 *
 * So every FL/GA outcome maps to one of exactly three statuses, and "absent" is not among them:
 *   present     — at least one mapped line within the screening buffer (labelled approximate)
 *   unconfirmed — nothing mapped, every query succeeded → "Not confirmed" + the real site checks
 *   unavailable — a query failed and nothing else hit → retryable, never read as clear
 *
 * The same `unconfirmed` state is what a Texas-only source (wells, LPST, CCN…) becomes when the
 * site is positively outside Texas: Planyr has no such source there, and saying "none found" off
 * a Texas service queried at a Florida coordinate is the identical false-clean (owner constraint
 * 3's general form). Pure. Node-testable. No imports — a leaf on purpose.
 */

/* The states this screen answers for. Deliberately a positive list: a state not named here gets no
 * EIA substitution (Texas keeps TxRRC; anything else keeps whatever it had). */
export const EIA_SCREEN_STATES = ["FL", "GA"];
export const isEiaScreenState = (state) => EIA_SCREEN_STATES.includes(String(state || "").toUpperCase());

/* The buffer the FL/GA screen searches. One mile, wider than the Texas crossing test on purpose:
 * the geometry is schematic and can be miles off, so a line "near" the site is worth reporting. */
export const EIA_BUFFER_MI = 1;

/* The four commodity layers, in panel order. `key` is the GIS registry row, `mapLayer` the Layers
 * panel row it activates. Names are the plain-English commodity, never the agency's layer title. */
export const EIA_COMMODITIES = [
  { key: "eiaGas", mapLayer: "eia_gas", name: "Natural gas", noun: "natural gas transmission line" },
  { key: "eiaPetroleum", mapLayer: "eia_petroleum", name: "Petroleum products", noun: "petroleum product line" },
  { key: "eiaCrude", mapLayer: "eia_crude", name: "Crude oil", noun: "crude oil line" },
  { key: "eiaHgl", mapLayer: "eia_hgl", name: "Gas liquids", noun: "gas liquids line" },
];

/* ⛔ THE WORDING AND THE COMBINER LIVE IN `eiaPipelineScreenCopy.js` AND ARE LOADED ON DEMAND
 * (a dynamic `import()` in `siteAnalysis.js`, only for a site positively in FL/GA or outside Texas).
 * This leaf is what the boot path needs synchronously — the state list, the buffer and the four
 * commodity rows — and nothing here may grow prose: every KB of copy in here rides the Site route's
 * critical path for the (Texas) majority who never read it. */
