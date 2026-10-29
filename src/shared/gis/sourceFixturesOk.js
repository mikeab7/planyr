/* NEW-1 (Oklahoma screening, 2026-10-29) — the VERIFICATION payload of the Oklahoma registry rows (`sourcesOk.js`), off the app bundle exactly like every other
 * row's fixtures (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there with one line each.
 *
 * Every point below sits ON a real feature: it was found by asking the live service for the features nearest an anchor city and taking a vertex of the nearest,
 * and every count is what the verifier's own ±0.01° box returned on 2026-10-29 (agency servers measured through the PR preview's /gis-proxy relay — the build
 * sandbox cannot reach them). Statewide rows are spread Panhandle ↔ Tulsa ↔ south-central on purpose: a fixture that proves only "the service answers somewhere"
 * would pass a clipped copy. MapServer rows name their sub-layer in `registry.layerId`; the verifier appends it. */

export const OK_FIXTURES = {
  okCounty: { fixtures: [
    { label: "Tulsa area (Tulsa / Creek line)", point: [-96.10105, 36.0755], expectMinCount: 1 }, // live 2026-10-29: 2
    { label: "Oklahoma City area", point: [-97.67402, 35.71107], expectMinCount: 1 }, // live: 2
    { label: "Texas County (Panhandle)", point: [-101.28503, 36.9966], expectMinCount: 1 }, // live: 1
  ] },
  okCity: { fixtures: [
    { label: "Tulsa", point: [-96.05756, 36.11905], expectMinCount: 1 }, // live: 2
    { label: "Lawton", point: [-98.47463, 34.56534], expectMinCount: 1 }, // live: 1
    { label: "Enid", point: [-97.8728, 36.43262], expectMinCount: 1 }, // live: 2
    { label: "Guymon (Panhandle)", point: [-101.4811, 36.6823], expectMinCount: 1 }, // live: 1
  ] },
  okRoad: { fixtures: [
    { label: "Tulsa", point: [-96.05338, 36.07574], expectMinCount: 1 }, // live: 37
    { label: "Oklahoma City", point: [-97.67134, 35.46038], expectMinCount: 1 }, // live: 16
    { label: "Guymon (Panhandle)", point: [-101.48159, 36.68182], expectMinCount: 1 }, // live: 43
  ] },
  okTribal: { fixtures: [
    { label: "Creek OTSA near Tulsa", point: [-96.49936, 36.3113], expectMinCount: 1 }, // live: 2
    { label: "Kiowa-Comanche-Apache OTSA near Lawton", point: [-98.11318, 34.15463], expectMinCount: 1 }, // live: 1
    { label: "Choctaw / Chickasaw OTSA near Durant", point: [-96.32928, 33.84289], expectMinCount: 1 }, // live: 2
  ] },
  okCherokeeRes: { fixtures: [
    { label: "Tahlequah (Cherokee Co.)", point: [-94.97, 35.91], expectMinCount: 1 }, // live: 1
    { label: "Bartlesville (Washington Co.)", point: [-95.98, 36.747], expectMinCount: 1 }, // live: 1
    { label: "Sallisaw area (Sequoyah Co.)", point: [-94.8, 35.46], expectMinCount: 1 }, // live: 1
  ] },
  okCherokeeLand: { fixtures: [
    { label: "Washington Co.", point: [-95.93355, 36.78518], expectMinCount: 1 }, // live: 1
    { label: "Tulsa area", point: [-95.97704, 36.22132], expectMinCount: 1 }, // live: 1
    { label: "Muskogee area", point: [-95.3105, 35.73121], expectMinCount: 1 }, // live: 1
  ] },
  okWells: { fixtures: [
    { label: "Tulsa area", point: [-96.08589, 36.07456], expectMinCount: 1 }, // live: 147
    { label: "Oklahoma City area", point: [-97.48522, 35.36542], expectMinCount: 1 }, // live: 7
    { label: "Lawton area", point: [-98.35997, 34.85963], expectMinCount: 1 }, // live: 4
    { label: "Guymon (Panhandle)", point: [-101.46288, 36.66996], expectMinCount: 1 }, // live: 7
  ] },
  okPst: { fixtures: [
    { label: "Tulsa", point: [-96.0299, 36.0748], expectMinCount: 1 }, // live: 5
    { label: "Oklahoma City", point: [-97.6719, 35.479], expectMinCount: 1 }, // live: 3
    { label: "Lawton", point: [-98.3984, 34.6017], expectMinCount: 1 }, // live: 55
    { label: "Guymon (Panhandle)", point: [-101.4809, 36.6825], expectMinCount: 1 }, // live: 51
  ] },
  okBrownfieldOcc: { fixtures: [
    { label: "Tulsa", point: [-95.99226, 36.1511], expectMinCount: 1 }, // live: 3
    { label: "Oklahoma City", point: [-97.51989, 35.46709], expectMinCount: 1 }, // live: 5
    { label: "Lawton", point: [-98.39009, 34.60552], expectMinCount: 1 }, // live: 1
  ] },
  okSuperfund: { fixtures: [
    { label: "Tulsa", point: [-96.07872, 36.12463], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City", point: [-97.47737, 35.46764], expectMinCount: 1 }, // live: 2
    { label: "Ardmore", point: [-97.10794, 34.19492], expectMinCount: 1 }, // live: 1
  ] },
  okRcra: { fixtures: [
    { label: "Tulsa", point: [-96.01158, 36.13811], expectMinCount: 1 }, // live: 2
    { label: "Oklahoma City", point: [-97.43427, 35.40611], expectMinCount: 1 }, // live: 2
    { label: "Ardmore", point: [-97.10977, 34.20189], expectMinCount: 1 }, // live: 1
  ] },
  okInstControl: { fixtures: [
    { label: "Tulsa", point: [-95.97673, 36.15685], expectMinCount: 1 }, // live: 4
    { label: "Oklahoma City", point: [-97.51591, 35.4624], expectMinCount: 1 }, // live: 8
    { label: "Lawton", point: [-98.3973, 34.62263], expectMinCount: 1 }, // live: 1
  ] },
  okVcp: { fixtures: [
    { label: "Tulsa", point: [-95.97051, 36.15508], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City", point: [-97.51328, 35.47167], expectMinCount: 1 }, // live: 1
    { label: "Panhandle (Texas Co.)", point: [-100.39643, 36.90119], expectMinCount: 1 }, // live: 1
  ] },
  okScap: { fixtures: [
    { label: "Tulsa", point: [-96.00539, 36.15873], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City", point: [-97.50875, 35.49271], expectMinCount: 1 }, // live: 1
    { label: "Lawton", point: [-98.39806, 34.61804], expectMinCount: 1 }, // live: 2
  ] },
  okBrownfieldDeq: { fixtures: [
    { label: "Tulsa", point: [-95.99202, 36.15971], expectMinCount: 1 }, // live: 2
    { label: "Oklahoma City", point: [-97.51385, 35.46886], expectMinCount: 1 }, // live: 9
    { label: "Lawton", point: [-98.38257, 34.62414], expectMinCount: 1 }, // live: 1
  ] },
  okSolidWaste: { fixtures: [
    { label: "Tulsa", point: [-95.97931, 36.17061], expectMinCount: 1 }, // live: 3
    { label: "Oklahoma City", point: [-97.51143, 35.44334], expectMinCount: 1 }, // live: 1
    { label: "Guymon (Panhandle)", point: [-101.4655, 36.71865], expectMinCount: 1 }, // live: 1
  ] },
  okHazWaste: { fixtures: [
    { label: "Tulsa", point: [-96.012, 36.138], expectMinCount: 1 }, // live: 2
    { label: "Oklahoma City", point: [-97.39787, 35.43367], expectMinCount: 1 }, // live: 1
    { label: "Lawton area", point: [-99.28485, 34.64964], expectMinCount: 1 }, // live: 1
  ] },
  okWhpa: { fixtures: [
    { label: "Tulsa area", point: [-96.25769, 36.24847], expectMinCount: 1 }, // live: 12
    { label: "Garfield / Kay area (north-central)", point: [-97.60597, 36.42153], expectMinCount: 1 }, // live: 9
    { label: "Guymon (Panhandle)", point: [-101.4813, 36.68112], expectMinCount: 1 }, // live: 16
    { label: "Durant area (south)", point: [-96.53908, 34.41238], expectMinCount: 1 }, // live: 3
  ] },
  okWellBuffer: { fixtures: [
    { label: "Tulsa area", point: [-96.26043, 36.26747], expectMinCount: 1 }, // live: 2
    { label: "Oklahoma City", point: [-97.4557, 35.49178], expectMinCount: 1 }, // live: 4
    { label: "Guymon (Panhandle)", point: [-101.47875, 36.68043], expectMinCount: 1 }, // live: 10
  ] },
  okPwsIntake: { fixtures: [
    { label: "Tulsa area", point: [-96.18095, 36.18094], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City area", point: [-97.59571, 35.5818], expectMinCount: 1 }, // live: 1
    { label: "Durant area (south)", point: [-96.38045, 34.05083], expectMinCount: 1 }, // live: 1
  ] },
  okAppendixBArea: { fixtures: [
    { label: "Tulsa area", point: [-95.79879, 36.22283], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City area", point: [-97.68763, 35.54703], expectMinCount: 1 }, // live: 1
    { label: "Wichita Mountains area", point: [-98.79547, 34.77597], expectMinCount: 1 }, // live: 1
    { label: "Durant area (south)", point: [-96.60933, 33.97298], expectMinCount: 1 }, // live: 1
  ] },
  okAppendixBLine: { fixtures: [
    { label: "Ouachita area (south-east)", point: [-96.28992, 34.97204], expectMinCount: 1 }, // live: 1
    { label: "Tulsa / Osage area", point: [-95.69846, 36.3393], expectMinCount: 1 }, // live: 1
  ] },
  okSensitiveWaters: { fixtures: [
    { label: "Payne / Logan area", point: [-97.73876, 35.89496], expectMinCount: 1 }, // live: 1
    { label: "Tulsa / Wagoner area", point: [-95.4752, 35.95506], expectMinCount: 1 }, // live: 1
  ] },
  ok303d: { fixtures: [
    { label: "Tulsa", point: [-96.00993, 36.1455], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City", point: [-97.5007, 35.45745], expectMinCount: 1 }, // live: 1
    { label: "Panhandle", point: [-101.72444, 36.66492], expectMinCount: 1 }, // live: 1
    { label: "Durant area (south)", point: [-96.38776, 33.98309], expectMinCount: 1 }, // live: 1
  ] },
  okDams: { fixtures: [
    { label: "Tulsa", point: [-95.98778, 36.12085], expectMinCount: 1 }, // live: 1
    { label: "Oklahoma City", point: [-97.56699, 35.45791], expectMinCount: 1 }, // live: 1
    { label: "Lawton", point: [-98.39083, 34.62046], expectMinCount: 1 }, // live: 1
    { label: "Guymon (Panhandle)", point: [-101.49785, 36.68209], expectMinCount: 1 }, // live: 1
  ] },
  okWaterSystems: { fixtures: [
    { label: "Tulsa area", point: [-95.98654, 36.25959], expectMinCount: 1 }, // live: 2
    { label: "Oklahoma City area", point: [-97.44418, 35.46433], expectMinCount: 1 }, // live: 2
    { label: "Guymon (Panhandle)", point: [-101.43869, 36.71437], expectMinCount: 1 }, // live: 1
  ] },
  okNrhp: { fixtures: [
    { label: "Tulsa", point: [-95.9928, 36.15338], expectMinCount: 1 }, // live: 28
    { label: "Oklahoma City", point: [-97.51638, 35.46845], expectMinCount: 1 }, // live: 49
    { label: "Lawton", point: [-98.39483, 34.60317], expectMinCount: 1 }, // live: 10
    { label: "Guymon (Panhandle)", point: [-101.4811, 36.68228], expectMinCount: 1 }, // live: 2
  ] },
  okCemeteries: { fixtures: [
    { label: "Tulsa", point: [-95.98717, 36.15225], expectMinCount: 1 }, // live: 4
    { label: "Oklahoma City", point: [-97.51529, 35.47535], expectMinCount: 1 }, // live: 3
    { label: "Lawton", point: [-98.40859, 34.60498], expectMinCount: 1 }, // live: 1
    { label: "Guymon (Panhandle)", point: [-101.45954, 36.68736], expectMinCount: 1 }, // live: 1
  ] },
  okCritHabitat: { fixtures: [
    { label: "Leopard darter — south-east (Little River)", point: [-94.92, 34.372], expectMinCount: 1 }, // live: 1
    { label: "Whooping crane — Salt Plains (Alfalfa Co.)", point: [-98.215, 36.801], expectMinCount: 1 }, // live: 1
    { label: "Arkansas River shiner — Canadian River", point: [-97.952, 35.381], expectMinCount: 1 }, // live: 2
  ] },
};

export const OK_DOCS = {
  okCounty: { notes: "ODOT's County Boundaries (77 counties, edited 2026-08-11). The county is the zoning and permitting authority outside city limits; a boundary is a jurisdiction line, not a service area." },
  okCity: { notes: "ODOT's city limits (597 places), collected from the Oklahoma Tax Commission, edited 2026-10-05 — an annexation after that date is not in it. Oklahoma has no ETJ, so there is no ETJ row. Inside a line is the city's jurisdiction; it is NOT proof of utility service." },
  okRoad: { notes: "ODOT's linear-referencing Roadways layer, narrowed to the state system (Interstate, US highway, state highway, turnpike) by ODOTROUTECLASS. On these the Department (or the Turnpike Authority) permits access; off them the county or city does — an absent line is NOT 'unmaintained'." },
  okTribal: { notes: "Census Bureau American Indian / Alaska Native / Native Hawaiian Areas, Oklahoma rows only. The 25 Oklahoma Tribal Statistical Areas are STATISTICAL areas drawn by the Bureau with each tribe — they are not legal boundaries and not a jurisdiction ruling; the Osage Reservation is the Bureau's legal federal reservation. Whether land is 'Indian country' for a criminal, civil, tax or regulatory purpose is a legal question no map answers." },
  okCherokeeRes: { notes: "The Cherokee Nation's own reservation polygon, published by the Nation on its ArcGIS Online org (edited 2026-09-24). The Nation's depiction of its boundary; the legal consequence for a given parcel is a question for counsel and the Nation." },
  okCherokeeLand: { notes: "The Cherokee Nation's own 'Tribal Land' tracts (458 tracts across its area, edited 2026-09-21). Land the Nation publishes as tribal land; whether a tract is trust, restricted or fee land is for the Nation's realty office to say." },
  okWells: { notes: "Oklahoma Corporation Commission RBDMS well locations (457,312 records, edited 2026-10-29; symbol_class decides the colour). A well is a point the Commission has on file — an unplugged, orphan or temporarily abandoned well near a building footprint needs a field search and a plugging-status check. Pipelines are NOT published (the OCC's pipeline folder needs a login)." },
  okPst: { notes: "OCC Petroleum Storage Tank Division register of PST facilities (21,313, edited 2026-10-28). A REGISTER of regulated tank facilities (name, type, status, tank counts) — release and corrective-action status are not in it, so a facility on it is a flag to pull the OCC file, never a finding of contamination." },
  okBrownfieldOcc: { notes: "The Corporation Commission's Brownfields Program sites (108, OCC's ArcGIS Online org). Petroleum-related brownfield sites enrolled in the OCC program; DEQ runs the non-petroleum brownfield program (okBrownfieldDeq)." },
  okSuperfund: { notes: "DEQ's Superfund (NPL) site points (18) at DEQ's own coordinates. Federal EPA cleanup sites are also in the national Contamination Sites row." },
  okRcra: { notes: "DEQ RCRA Corrective Action facilities (43) — treatment, storage and disposal facilities investigating or cleaning up a release." },
  okInstControl: { notes: "DEQ Remediation Institutional Controls (900) — cleanup sites where a land-use restriction (deed notice, covenant) has been filed. THE restriction text is in DEQ's file; a filed restriction can bar residential use, groundwater use or digging." },
  okVcp: { notes: "DEQ Voluntary Cleanup Program sites (78; data set updated 1/25/2022 per DEQ) — properties being voluntarily investigated or cleaned up." },
  okScap: { notes: "DEQ Site Cleanup Assistance Program (286): abandoned hazardous-waste sites, closed armories, community revitalization sites and school chemical disposal." },
  okBrownfieldDeq: { notes: "DEQ Brownfields (103): certificate and revolving-loan-fund sites with their contamination, institutional controls, engineering controls and allowable use." },
  okSolidWaste: { notes: "DEQ permitted solid-waste facilities (147): landfills of every kind, transfer stations, incinerators, compost, tire and medical-waste facilities. Landfill gas and settlement make adjacent and on-site ground a geotechnical and environmental question." },
  okHazWaste: { notes: "DEQ hazardous-waste permit sites (28): commercial and non-commercial treatment/storage/disposal and transfer facilities." },
  okWhpa: { notes: "DEQ-modelled wellhead protection areas around public water-supply wells (5,911 polygons, zone letters A / B / C as DEQ labels them). Land use inside is limited to protect the drinking-water source; ask DEQ Water Quality what applies." },
  okWellBuffer: { notes: "A fixed 300-ft circle around each public water-supply well, drawn by DEQ from its 2014 well layer. DEQ rule OAC 252:626-7-4 3C: a public well is not to be located within 300 ft of any existing or potential source of pollution. A fixed radius — where a modelled WHPA exists it is the better guide." },
  okPwsIntake: { notes: "DEQ public water-supply surface-water intakes (216) — where a town takes drinking water from a river or lake." },
  okAppendixBArea: { notes: "Oklahoma Water Quality Standards, Appendix B areas (OAC 252:730): Table 1 — waters in parks, forests, wildlife areas and refuges; Table 2 — areas with federally listed threatened or endangered species. Waters here carry extra protection (DEQ's general discharge permits can exclude them)." },
  okAppendixBLine: { notes: "Oklahoma Water Quality Standards, Appendix B streams (14 lines, OAC 252:730) — the stream segments of the Appendix B areas." },
  okSensitiveWaters: { notes: "DEQ's sensitive waters and watersheds harboring threatened and endangered species (52 HUC-11 watersheds) as used by the OKR10 Construction General Stormwater Permit (the layer's own DEQ description)." },
  ok303d: { notes: "DEQ's 2024 Integrated Report 303(d) waterbodies (839 stream segments) by category: 4a impaired, TMDL complete · 5a impaired, TMDL needed · 5b · 5c impaired, more data needed." },
  okDams: { notes: "OWRB's Oklahoma Dam Inventory (4,980 dams, edited 2026-09-22) by hazard class — High means occupied dwellings immediately downstream. The hazard class describes the consequence of failure, not the dam's condition; no inundation map is published." },
  okWaterSystems: { notes: "OWRB's approximate service areas for public water systems (720 polygons) — towns and rural water districts. APPROXIMATE: not a certificated territory and not a commitment to serve; confirm availability and size with the system." },
  okNrhp: { notes: "National Register of Historic Places listings — one point each (a district is one point). The State Historic Preservation Office's landmark inventory is not public." },
  okCemeteries: { notes: "USGS GNIS recorded cemeteries. INCOMPLETE by construction — unrecorded family burial grounds are not on it." },
  okCritHabitat: { notes: "USFWS final critical habitat in Oklahoma (Arkansas River shiner, leopard darter, whooping crane — a handful of river-corridor units). It binds federal actions, not private land directly — but a Corps wetlands permit is a federal action." },
};
