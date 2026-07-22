/* v3 C3 — pond screening guards (warnings only). When a pond's rim (top of bank) sits
 * ABOVE existing site grade — i.e. the pond holds water behind a berm rather than in a
 * hole dug into the ground — two screening facts become worth surfacing. Both are amber
 * ESTIMATE-tone chips: they warn, they never block, and they NEVER change a computed value
 * or the solver. Pure: takes already-computed numbers (SitePlanner.jsx owns the routing,
 * the pond split, and the building FFEs), returns chip descriptors. No fetch, no geometry,
 * no React — so it unit-tests without a browser.
 *
 *   1. Gravity inflow — a berm crest above grade means site runoff can't just flow OVER the
 *      rim into the pond; it has to be piped THROUGH the berm with inlets. Fires whenever the
 *      rim is above grade (that alone is the fact worth flagging on a screening plan).
 *   2. FFE proximity — if the routed peak water surface climbs to within the required 1 ft of
 *      freeboard of the LOWEST building's finished floor, name that building. Only evaluated
 *      when we actually have a routed peak elevation AND at least one building with a finished
 *      floor; otherwise the chip is silent (never a fabricated number — LOUD-FAILURE).
 */

const EPS_FT = 0.05; // a rim within this of grade reads as "at grade", not above it
export const FFE_FREEBOARD_REQ_FT = 1; // the screening freeboard between peak water and finished floor

const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * @param {object} opts
 * @param {number|null} opts.rimVsGradeFt   rim elevation minus existing grade (ft); >0 = rim above grade
 * @param {number|null} opts.peakWseFt      routed peak water-surface elevation in the pond (ft), or null
 * @param {Array<{label:string, ffeFt:number}>} opts.buildings  buildings with a finished-floor elevation
 * @returns {Array<{id:string, tone:string, text:string, popover?:string}>} chip descriptors (possibly empty)
 */
export function pondScreeningGuards({ rimVsGradeFt = null, peakWseFt = null, buildings = [] } = {}) {
  const guards = [];
  const rimAboveGrade = Number.isFinite(rimVsGradeFt) && rimVsGradeFt > EPS_FT;
  if (!rimAboveGrade) return guards;

  // Guard 2 — gravity inflow. Fires on rim-above-grade alone.
  guards.push({
    id: "berm-inlets",
    tone: "amber",
    text: "Rim above site grade: runoff needs inlets through the berm",
    popover:
      "Because the pond's rim sits above the surrounding ground, stormwater can't run over the berm into the pond by gravity. It has to be routed through the berm with inlets and pipes. Screening flag — confirm the inflow design with your engineer.",
  });

  // Guard 1 — FFE proximity. Only when a real routed peak elevation exists.
  if (Number.isFinite(peakWseFt)) {
    const withFfe = (buildings || []).filter((b) => b && Number.isFinite(b.ffeFt));
    if (withFfe.length) {
      const lowest = withFfe.reduce((lo, b) => (b.ffeFt < lo.ffeFt ? b : lo));
      const freeboardFt = lowest.ffeFt - peakWseFt;
      // "routed peak WSE + 1 ft" reaching the finished floor === less than 1 ft of freeboard.
      if (freeboardFt < FFE_FREEBOARD_REQ_FT) {
        guards.push({
          id: "ffe-freeboard",
          tone: "amber",
          text: `Peak water ${f1(peakWseFt)} ft within 1 ft of Building ${lowest.label} FFE ${f1(lowest.ffeFt)} ft`,
          popover:
            "The routed peak water surface in this pond climbs to within 1 ft of the lowest building's finished floor. Detention design normally keeps at least 1 ft of freeboard below the floor. Screening flag from the routed peak — confirm with your engineer.",
        });
      }
    }
  }

  return guards;
}
