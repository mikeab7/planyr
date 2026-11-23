/* The 24 New York counties the statewide public layer does NOT hold (measured; see nyParcels.js). A small EAGER file because counties.js's ny_statewide row declares
 * them as `excludedCounties`, while nyParcels.js itself (the county rows) now loads on demand — batch K stage 2. */
export const NY_UNCOVERED = ["Allegany", "Cattaraugus", "Chemung", "Chenango", "Clinton", "Columbia", "Delaware", "Dutchess", "Essex", "Franklin", "Fulton", "Herkimer", "Jefferson", "Madison", "Monroe", "Nassau", "Niagara", "Orleans", "Saratoga", "Schenectady", "Schoharie", "Seneca", "Washington", "Yates"];
