/* NEW-B4 (owner scope-note) — Harris-Galveston & Fort Bend SUBSIDENCE DISTRICT flags as a
 * cited config registry. These districts regulate GROUNDWATER WITHDRAWAL (permits + surface-
 * water-conversion mandates) to control land subsidence. Relevance to the pond/detention work:
 *   • construction dewatering / a wet-pond's groundwater interaction may need a district permit; and
 *   • subsidence context matters to Phase D (a pond's long-term grade + outfall depend on it).
 *
 * Manual, cited registry data (per the scope note — no scraping). A district's regulatory
 * program changes; every value carries its citation + a verify flag. Screening only — confirm
 * permitting with the district. Pure + Node-testable; no DOM/network. */

export const SUBSIDENCE_DISTRICTS = {
  hgsd: {
    key: "hgsd",
    name: "Harris-Galveston Subsidence District",
    provider: "Harris-Galveston Subsidence District (HGSD)",
    counties: ["harris", "galveston"],
    established: "1975",
    regulates: "groundwater withdrawal (permits) + phased surface-water conversion by Regulatory Area",
    citation: {
      name: "HGSD District Regulatory Plan (2013, as amended)",
      section: "Regulatory Areas 1–3; permit + conversion requirements",
      url: "https://hgsubsidence.org/",
    },
    note:
      "Groundwater pumping (incl. construction dewatering and irrigation wells) requires an HGSD permit; " +
      "Regulatory Area 3 mandates a high surface-water share (≈80% by 2035). Screening flag — confirm the " +
      "current regulatory-area requirements + any well-permit obligations with the district.",
    verified: false,
  },
  fbsd: {
    key: "fbsd",
    name: "Fort Bend Subsidence District",
    provider: "Fort Bend Subsidence District (FBSD)",
    counties: ["fort bend"],
    established: "1989",
    regulates: "groundwater withdrawal (permits) + surface-water conversion",
    citation: {
      name: "FBSD District Regulatory Plan (as amended)",
      section: "Permit + conversion requirements",
      url: "https://www.fbsubsidence.org/",
    },
    note:
      "Groundwater pumping in Fort Bend County requires an FBSD permit; surface-water conversion is phased. " +
      "Screening flag — confirm current requirements + any well-permit obligations with the district.",
    verified: false,
  },
};

/* County (lowercased TxDOT CNTY_NM) → which subsidence district(s) govern. A parcel straddling
 * a county line can hit both. Returns an array of registry rows (empty when none). Pure. */
export function subsidenceFor(counties = []) {
  const set = (Array.isArray(counties) ? counties : [counties]).map((c) => String(c || "").toLowerCase().replace(/\s+county$/, "").trim());
  return Object.values(SUBSIDENCE_DISTRICTS).filter((d) => d.counties.some((c) => set.includes(c)));
}

/* A one-line screening flag for a resolved county list, or null when no district applies. Pure. */
export function subsidenceFlag(counties = []) {
  const hits = subsidenceFor(counties);
  if (!hits.length) return null;
  return {
    districts: hits.map((d) => d.key),
    severity: "info",
    message: `In the ${hits.map((d) => d.name).join(" + ")} — groundwater pumping (dewatering / wells) needs a district permit${hits.some((d) => d.regulates.includes("conversion")) ? " and surface-water conversion is regulated" : ""}. Screening flag; confirm with the district.`,
    citations: hits.map((d) => d.citation),
  };
}

/* The audit for the registry (mirrors the other cited registries). Pure. */
export function problems(reg = SUBSIDENCE_DISTRICTS) {
  const out = [];
  for (const [key, d] of Object.entries(reg)) {
    if (d.key !== key) out.push(`${key}: key mismatch`);
    if (!d.name || !d.provider) out.push(`${key}: name/provider required`);
    if (!Array.isArray(d.counties) || !d.counties.length) out.push(`${key}: counties[] required`);
    if (!d.citation || !/^https:\/\//.test(d.citation.url || "")) out.push(`${key}: citation.url must be https://`);
  }
  return out;
}
