/* Dev-only harness (not part of the app build) that mounts the real LayerPanel with
 * mock props in a browser, so ui-audit/layerpanel-verify.mjs can headless-assert the
 * B760–B762 panel overhaul (de-text, merged City/ETJ toggle, folded county groups)
 * against actual rendered DOM. Runs under `vite` dev, which serves /src + this file. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LayerPanel from "../src/workspaces/site-planner/components/LayerPanel.jsx";
import { floodReadout } from "../src/workspaces/site-planner/lib/floodZoneCopy.js";
import JurisdictionBadge from "../src/workspaces/site-planner/components/JurisdictionBadge.jsx";
import { defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

// NB: the ISD endpoint itself is verified LIVE via curl (through the sandbox HTTPS proxy) — see
// the B764 evidence in VERIFICATION.md. A browser-side fetch can't be used to verify it HERE
// because headless Chromium in this sandbox has no external-network egress (it doesn't use the
// proxy), so any in-page fetch to an agency host fails — that on-map render check is owed live.

function Panel({ id, county, siteCounty = null, mutate, floodContext = null, layerStatus = {}, coverage = {} }) {
  const [ov, setOv] = useState(() => { const o = defaultOverlayState(); if (mutate) mutate(o); return o; });
  return (
    <div id={id} data-panel style={{ width: 300, border: "1px solid var(--border-default)", borderRadius: 10, padding: 12, background: "var(--surface-overlay)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{id}</div>
      <LayerPanel overlays={ov} setOverlays={setOv} county={county} siteCounty={siteCounty} layerStatus={layerStatus} coverage={coverage} floodContext={floodContext} />
    </div>
  );
}

/* B1075–B1080 — the Tsakiris drainage context, verbatim from the live 2026-07-29 probes:
 * Waller County, inside the Brookshire–Katy Drainage District, FEMA Zone X (SFHA_TF=F,
 * ZONE_SUBTY "AREA OF MINIMAL FLOOD HAZARD"), the Willow Fork channel at the tract, and a
 * 70-ft district drainage easement with recorded exhibit WF-10.pdf. */
const TSAKIRIS_CTX = {
  // B1091(×2) — the district boundary query ANSWERED, and it answered yes. `tested` records
  // that it ran cleanly; the identify county is the fact the scoping reasons over.
  drainageDistrict: { id: "bkdd", source: "boundary", tested: ["bkdd"] },
  authority: { jurisdiction: { city: ["Katy"], county: ["Waller"], etj: [] } },
  flood: { state: "loaded", zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", staticBfeFt: null }] },
  channel: { state: "loaded", near: true, name: "Willow Fork", kindLabel: "canal / ditch", distFt: 42, authority: "bkdd", sourceId: "bkddChannel", inventoryOnly: false },
  easements: { present: true, maxWidthFt: 70, items: [{ widthFt: 70, exhibit: "WF-10.pdf" }], state: "loaded" },
  watershed: { state: "loaded", names: ["Willow Fork"], sqMiles: 23 },
};
// A Harris site with an SFHA mapped — the opposite verdict, and the opposite district scoping.
const HARRIS_CTX = {
  // The mirror: no district contains this point, and the BKDD boundary query came back
  // CLEANLY empty — the only thing that lets a county answer exclude a rival district.
  drainageDistrict: { id: "hcfcd", source: "county", tested: ["bkdd"] },
  authority: { jurisdiction: { city: [], county: ["Harris"], etj: [] } },
  flood: { state: "loaded", zones: [{ zone: "AE", subtype: "FLOODWAY" }] },
  channel: { state: "loaded", near: true, unitNo: "W100-00-00", name: "BUFFALO BAYOU", distFt: 120, authority: "hcfcd" },
};
// FEMA unreachable — must read "unknown, not clear", never as a clean all-clear.
const OUTAGE_CTX = {
  drainageDistrict: { id: null, source: null, tested: [] },
  authority: { jurisdiction: { city: [], county: ["Waller"], etj: [] } },
  flood: { state: "failed", zones: [] },
};

function badgeOf(j, opts) {
  const b = formatJurisdictionBadge(j, opts);
  return b ? { ...b, ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC" } : null;
}

function App() {
  return (
    <div>
      {/* B763 — passive jurisdiction badges (site-header chip) */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <span id="badge-city"><JurisdictionBadge badge={badgeOf({ city: ["Houston"], etj: [], county: ["Harris"], straddle: false })} /></span>
        <span id="badge-etj"><JurisdictionBadge badge={badgeOf({ city: [], etj: ["Baytown"], county: ["Harris"], unincorporated: true })} /></span>
        <span id="badge-uninc"><JurisdictionBadge badge={badgeOf({ city: [], etj: [], county: ["Waller"], unincorporated: true })} /></span>
        <span id="badge-straddle"><JurisdictionBadge badge={badgeOf({ city: ["Houston", "Katy"], etj: [], county: ["Harris"], straddle: true })} /></span>
        {/* B793 — the Bain shape: the ring intersects Katy but the centroid is outside it
            (frontage sliver), Houston ETJ, Fort Bend. Dominant leads; sliver trails "— edge only". */}
        <span id="badge-sliver"><JurisdictionBadge badge={{ ...badgeOf({ city: ["Katy"], cityCentroid: [], etj: ["Houston"], county: ["Fort Bend"], isd: ["Katy ISD"], straddle: false }), etjNote: "ETJ boundaries: H-GAC ETJ — current edition. ETJs shrink as landowners opt out (SB 2038) — screening only, verify before relying on an ETJ answer." }} /></span>
        <span id="badge-null"><JurisdictionBadge badge={null} /></span>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Panel id="panel-harris" county="harris" />
        <Panel id="panel-fortbend" county="fortbend" />
        <Panel id="panel-chambers" county="chambers" />
        {/* "old saved state with jur_etj on" → the merged row must load ON */}
        <Panel id="panel-etjon" county="harris" mutate={(o) => { o.jur_etj.on = true; }} />
      </div>
      {/* B1075–B1080 — the Flood & drainage group: master toggle, four provenance tiers,
          district auto-scoping and the honest empty states. */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginTop: 20 }}>
        <Panel id="panel-bkdd" county="waller" siteCounty="waller" floodContext={TSAKIRIS_CTX} />
        <Panel id="panel-hcfcd" county="harris" siteCounty="harris" floodContext={HARRIS_CTX} />
        <Panel id="panel-flood-outage" county="waller" siteCounty="waller" floodContext={OUTAGE_CTX} />
        {/* The advisory master-plan layer ON, reporting empty, with its study area out of
            view — the exact Tsakiris shape that must read "outside this study area". */}
        <Panel id="panel-dmp-empty" county="waller" siteCounty="waller" floodContext={TSAKIRIS_CTX}
          mutate={(o) => { o.bkdd_dmp.on = true; }}
          layerStatus={{ bkdd_dmp: { state: "empty" } }}
          coverage={{ bkdd_dmp: "out" }} />
        {/* No flood context at all — no drainage check has run. The SITE county is still a
            fact, so what cannot reach Waller is still demoted; what governs is left open. */}
        <Panel id="panel-flood-nocontext" county="waller" siteCounty="waller" />
        {/* (NEW-1/NEW-2) THE SILENT SHAPE. No flood context AND no site county — which is
            exactly the map finder's copy of this panel, the copy that stays mounted (hidden)
            behind the planner and sits FIRST in the document. Every conditional line in the
            group is off here, so the group used to render with nothing said at all. */}
        <Panel id="panel-flood-blank" county="harris" siteCounty={null} />
        {/* (NEW-1/NEW-2) A check that RAN but whose county never resolved (a straddle, or an
            identify that didn't answer): the FEMA verdict speaks, the scoping fails open, and
            the panel has to admit the list isn't scoped. */}
        <Panel id="panel-flood-nocounty" county="harris" siteCounty={null}
          floodContext={{ ...TSAKIRIS_CTX, authority: { ...TSAKIRIS_CTX.authority, jurisdiction: { ...TSAKIRIS_CTX.authority.jurisdiction, county: [] } } }} />
        {/* (NEW-2) The tract's REAL flood block, verbatim from the production row
            (sites.id smrjdgmlinea, read 2026-07-29): the ring covers Zone X AND Zone A, so
            part of the tract IS in a special flood hazard area. The zone-specific sentence is
            the single most useful line in this panel — it went missing from a live pass. */}
        <Panel id="panel-flood-zonea" county="waller" siteCounty="waller"
          floodContext={{ ...TSAKIRIS_CTX, flood: { state: "loaded", ageMs: 2470644, zones: [
            { zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", staticBfeFt: null, vdatum: null },
            { zone: "A", subtype: null, staticBfeFt: null, vdatum: null },
          ] } }} />
        {/* B1091(×2) — the regression shape: the site record's county is STALE ("harris", the
            lookup default) while the identify says Waller and the boundary test found BKDD.
            The panel must follow the facts, never the stale selector. */}
        <Panel id="panel-flood-stalecounty" county="harris" siteCounty="harris" floodContext={TSAKIRIS_CTX} />

        {/* ── NEW-1/NEW-2/NEW-3/NEW-7 — THE OWNER'S COLORADO SITE, from the live service ──────
            Every value below was read from FEMA's own NFHL on 2026-07-30 at the Johnstown /
            E County Rd 14 site the owner reported: the zone identify returns FLD_ZONE "X" with
            ZONE_SUBTY "AREA OF MINIMAL FLOOD HAZARD" under DFIRM 08069C, and the FIRM Panels
            layer returns TWO panels over that same point — Larimer 08069C1405G (eff. 2021-01-15)
            and Weld 08123C1679F (eff. 2023-11-30), because panels stop at the county line and
            this site sits on it. That county-line straddle is the whole of NEW-3. */}
        <Panel id="panel-flood-johnstown" county="co_weld" siteCounty="co_larimer"
          floodContext={{
            drainageDistrict: { id: null, source: null, tested: [] },
            authority: { jurisdiction: { city: ["Johnstown"], county: ["Larimer"], etj: [] } },
            flood: {
              state: "loaded", ageMs: 3600000,
              zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", staticBfeFt: null, vdatum: null, firm: "08069C" }],
              panels: [
                { firm: "08069C", panel: "08069C1405G", effDate: 1610668800000 },
                { firm: "08123C", panel: "08123C1679F", effDate: 1701302400000 },
              ],
            },
          }} />
        {/* The OPPOSITE answer, which used to render identically: shaded X IS the 500-year
            floodplain. Same FLD_ZONE "X"; only ZONE_SUBTY differs. */}
        <Panel id="panel-flood-shadedx" county="waller" siteCounty="waller"
          floodContext={{ ...TSAKIRIS_CTX, flood: { state: "loaded", ageMs: 60000, zones: [
            { zone: "X", subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", staticBfeFt: null, vdatum: null, firm: "48473C" },
          ] } }} />
        {/* NEW-7 — the THIRD state. FEMA answered and has nothing mapped here: that is
            we-do-not-know, the opposite risk position from checked-and-clear, and it must not
            render like the all-clear above. */}
        <Panel id="panel-flood-nodata" county="waller" siteCounty="waller"
          floodContext={{ ...TSAKIRIS_CTX, flood: { state: "empty", ageMs: 60000, zones: [], panels: [] } }} />

        {/* NEW-2 — the HOVER readout itself, rendered from the exact attributes FEMA's identify
            returned at the owner's site (verified live 2026-07-30). This is the surface the
            report was filed about: it used to read "Flood Hazard Zones: 08069c_2802" / "Type: X".
            Rendered here rather than fetched, because headless Chromium in this sandbox has no
            external egress (see the note at the top of this file). */}
        <div id="panel-flood-hover" data-panel style={{ width: 300, border: "1px solid var(--border-default)", borderRadius: 10, padding: 12, background: "var(--surface-overlay)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>panel-flood-hover</div>
          {(() => {
            const r = floodReadout({
              DFIRM_ID: "08069C", FLD_AR_ID: "08069C_2802", FLD_ZONE: "X",
              ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F", STATIC_BFE: "-9999",
            });
            return (
              <div data-testid="flood-hover-readout">
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                {r.rows.map((row) => (
                  <div key={row.label} style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    <b>{row.label}:</b> {row.text}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
