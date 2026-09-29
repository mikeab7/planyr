/* The ONE answer to "is this element a standalone building?" (B122 / A-B1953794). Dependency-free on
 * purpose so the Dashboard can import it without pulling siteModel.js (and its geometry graph) into
 * its own bundle. siteModel.js re-exports it — never re-implement this predicate. A "building"
 * element flagged `dogEar` is an attached bump-out piece (stored as type "building" too): it counts
 * toward building SF but is NOT a building. */
export const isBuilding = (el) => !!el && el.type === "building" && !el.dogEar;
