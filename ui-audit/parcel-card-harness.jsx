/* Headless harness for the address-search parcel card (NEW-1). Renders the REAL component
 * — real CSS tokens, real layout, real fold — against two parcels that differ ONLY in the
 * length of their Legal description: the owner's screenshot blob (a wall of survey calls)
 * and a one-liner. verify-parcel-card-height.mjs then MEASURES both cards in Chromium,
 * which is the only way to prove the thing the owner actually reported — the card was too
 * TALL — rather than a proxy for it.
 *
 * The card is positioned absolutely (it floats under the map's search pill), so each cell
 * gives it a relatively-positioned box of the real map's width to live in. Served by
 * `vite` dev, like every other harness in this folder. */
import { createRoot } from "react-dom/client";
import ParcelInfoCard from "../src/workspaces/site-planner/components/ParcelInfoCard.jsx";

const LEGAL_BLOB =
  "W2NW4 2-4-68 EXC PT LYING WITHIN COMM N4 SEC COR TH S06D25E 30.118 TPOB TH S89D42W 1320.55 " +
  "TH N00D18W 660.27 TH N89D42E 1320.55 TH S00D18E 660.27 TPOB EXC RD R/W AS DESC IN BK 1042 " +
  "PG 331 & EXC PT DESC IN BK 2211 PG 88 TOG WITH UNDIVIDED 1/2 INT IN & TO ALL OIL GAS & " +
  "OTHER MINERALS LYING IN & UNDER SAID PREMISES AS RESERVED IN DEED RECORDED BK 998 PG 12";

const attrs = (legal) => ({
  owner_name: "ACME INDUSTRIAL PARTNERS LP",
  situs_addr: "1234 INDUSTRIAL PKWY",
  prop_id: "R0041234",
  legal_area: 41.72,
  land_value: 250000,
  imp_value: 100000,
  mkt_value: 350000,
  stat_land_use: "F1 - COMMERCIAL",
  zoning: "I-2",
  year_built: 1998,
  legal_desc: legal,
});

const info = (legal) => ({
  status: "found", addr: "1234 Industrial Pkwy", acct: "R0041234", acres: 41.7239, attrs: attrs(legal),
});

// One map-sized stage per case. `position:relative` gives the absolutely-positioned card
// something to anchor to; the height is the real map's, so an over-tall card is visible.
function Stage({ name, children }) {
  return (
    <div data-stage={name} style={{ position: "relative", width: 1200, height: 620, borderBottom: "2px solid var(--border-default)", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 6, left: 8, fontFamily: "system-ui, sans-serif", fontSize: 12, color: "var(--text-secondary)" }}>{name}</div>
      {children}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <>
    <Stage name="long-legal">
      <ParcelInfoCard info={info(LEGAL_BLOB)} onDismiss={() => {}} onPlan={() => {}} />
    </Stage>
    <Stage name="short-legal">
      <ParcelInfoCard info={info("LOT 4 BLK 1")} onDismiss={() => {}} onPlan={() => {}} />
    </Stage>
    <Stage name="narrow">
      <ParcelInfoCard info={info(LEGAL_BLOB)} narrow onDismiss={() => {}} onPlan={() => {}} />
    </Stage>
  </>,
);
