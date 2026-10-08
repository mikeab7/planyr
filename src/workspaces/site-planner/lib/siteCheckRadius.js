/* The ONE "near" radius for the Site Analysis trusted verdicts — a dependency-free LEAF so
 * `siteAnalysis.js` (which is on the boot path) can read it without pulling the verdict module
 * (clipper, region outline, copy) in with it. A quarter mile: the radius the screen already used for
 * wells, growth faults, transmission and NRHP; pipelines had none and adopt it. */
export const NEAR_RADIUS_MI = 0.25;
