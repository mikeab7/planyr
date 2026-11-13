/* Schedule › task icons (NEW-1, owner-approved design 2026-11-06).
 *
 * ONE home for the icon library and every pure rule about task icons. Loaded by public/sequence/index.html as a plain
 * <script> (the page compiles its inline JSX in the browser, so a separate file keeps this testable in Node) and read by
 * test/scheduleTaskIcons.test.js, which evaluates this very file — there is no second copy to drift.
 *
 * DATA MODEL: a task carries `icons: string[]` (0–2 entries), NEVER inside the task name. An entry is either an emoji
 * character (drawn as a bundled Twemoji SVG), a custom id "c:<name>" (a coloured 36x36 drawing, below), or a built-in
 * line-art id "svg:<name>" (BUILTIN_SVG, below: drawn in currentColor so it follows the row's text colour). The stored
 * value is only ever the KEY — never markup. Absent = none.
 *
 * Emoji art: Twemoji 15.1.0 (jdecked/twemoji), graphics © Twitter, Inc. and other contributors, CC-BY 4.0.
 * Files are bundled in /sequence/vendor/twemoji/ (see CREDITS.txt there) — nothing is hot-linked at runtime.
 */
(function (root) {
  "use strict";

  var MAX_ICONS = 2;

  // [id, label, keywords]. Order is the picker's order. An id may appear in two categories on purpose
  // (c:pond, c:joist, 🏦) — each occurrence carries its own label; search merges them (see searchTaskIcons).
  var CATEGORIES = [
    { key: "acq", title: "Acquisition and diligence", items: [
      ["🧭", "Site selection", "site selection search"],
      ["✍️", "LOI signed", "LOI signed letter of intent"],
      ["📜", "Contract / agreement", "PSA contract agreement development agreement"],
      ["💵", "Earnest money", "earnest money deposit"],
      ["🔎", "Feasibility / due diligence", "feasibility due diligence"],
      ["c:tripod", "Survey", "survey boundary topo ALTA"],
      ["📄", "Title commitment", "title commitment"],
      ["🌿", "Phase I ESA", "phase I ESA environmental"],
      ["🧪", "Phase II sampling", "phase II sampling"],
      ["c:drill", "Geotech / soil borings", "geotech soils boring"],
      ["🌾", "Wetland delineation", "wetland delineation USACE"],
      ["🏺", "Cultural / archaeology", "cultural archaeology THC"],
      ["🐢", "Endangered species", "endangered species"],
      ["🗺️", "Zoning / land use", "zoning rezoning land use"],
      ["💲", "Appraisal", "appraisal"],
      ["🤝", "Closing", "closing"]
    ] },
    { key: "ent", title: "Entitlements and permits", items: [
      ["c:permit", "Permit / approval", "permit approval approved"],
      ["🏛️", "City council / jurisdiction", "city council jurisdiction county"],
      ["svg:tia", "Traffic impact analysis (TIA)", "traffic TIA impact analysis"],
      ["🛣️", "TxDOT / driveway / ROW", "TxDOT driveway ROW highway"],
      ["c:pond", "Detention / drainage review", "detention drainage HCFCD review"],
      ["🌊", "Floodplain / FEMA", "floodplain FEMA LOMR"],
      ["🌧️", "SWPPP / stormwater", "SWPPP NOI TCEQ stormwater"],
      ["🚒", "Fire marshal", "fire marshal"],
      ["c:plat", "Plat / replat", "plat replat recordation lots"],
      ["svg:plat", "Plat", "plat final plat mylar recordation subdivision lots"],
      ["🏦", "MUD / district / bond", "MUD district bond"],
      ["💸", "Tax abatement / incentive", "tax abatement incentive"],
      ["🗳️", "Variance / hearing / vote", "variance hearing vote"],
      ["📮", "Will-serve letter", "will-serve letter utility"],
      ["🧾", "Fees / impact fees", "fees impact fee"]
    ] },
    { key: "des", title: "Design", items: [
      ["📐", "Design phase", "design phase"],
      ["c:civil", "Civil drawings (CDs)", "civil construction drawings CDs"],
      ["c:arch", "Architectural drawings", "architectural drawings floor plan"],
      ["c:joist", "Structural steel", "structural steel joist"],
      ["⚡", "Electrical / MEP", "electrical MEP power"],
      ["c:sprink", "Fire protection / sprinklers", "fire protection sprinkler ESFR"],
      ["❄️", "Cold storage", "cold storage refrigeration"],
      ["🌳", "Landscape / irrigation", "landscape irrigation"],
      ["🚆", "Rail spur", "rail spur"],
      ["💡", "Site lighting", "site lighting photometric"],
      ["🪧", "Signage", "signage monument sign"],
      ["🔁", "Revisions / resubmittal", "revisions comments resubmittal"]
    ] },
    { key: "utl", title: "Utilities", items: [
      ["💧", "Water line", "water line"],
      ["c:hydrant", "Fire line / hydrant loop", "fire line hydrant loop"],
      ["c:manhole", "Sanitary sewer", "sanitary sewer manhole"],
      ["🔌", "Power service", "power service utility"],
      ["🔥", "Gas", "gas"],
      ["📡", "Telecom / fiber", "telecom fiber"]
    ] },
    { key: "sit", title: "Sitework", items: [
      ["🚧", "Mobilization / fence", "mobilization fence"],
      ["🪓", "Clearing and grubbing", "clearing grubbing"],
      ["c:dump", "Mass grading", "mass grading earthwork haul dirt"],
      ["🪨", "Lime stabilization / subgrade", "lime stabilization subgrade"],
      ["c:mixer", "Concrete paving / slab", "concrete paving slab pour"],
      ["c:pond", "Detention pond construction", "detention pond construction"]
    ] },
    { key: "bld", title: "Building", items: [
      ["c:tilt", "Tilt-wall panels", "tilt-wall panels casting erection"],
      ["c:joist", "Steel joists / deck", "steel joists deck"],
      ["c:roof", "Roof (TPO)", "roof TPO membrane"],
      ["c:dock", "Dock doors / levelers", "dock doors levelers"],
      ["🏗️", "Building shell", "building shell construction crane"],
      ["🔍", "Inspection", "inspection"],
      ["📋", "Punch list", "punch list"],
      ["✅", "Substantial completion", "substantial completion"],
      ["🔑", "CO / turnover", "CO certificate occupancy turnover"]
    ] },
    { key: "fin", title: "Leasing and finance", items: [
      ["🏢", "Tenant prospect", "tenant prospect"],
      ["📑", "Lease", "lease"],
      ["🤵", "Broker", "broker"],
      ["📨", "Bid / RFP / award", "bid RFP award"],
      ["💰", "Budget / cost", "budget cost"],
      ["🏦", "Loan / lender", "loan lender"],
      ["🧮", "Draw / pay app", "draw pay app"],
      ["🛡️", "Insurance / bond", "insurance bond"],
      ["⚖️", "Legal / attorney", "legal attorney"]
    ] },
    { key: "sta", title: "Status and milestones", items: [
      ["🏁", "Milestone", "milestone"],
      ["🎉", "Groundbreaking / celebration", "groundbreaking celebration"],
      ["📅", "Meeting", "meeting"],
      ["⏰", "Deadline", "deadline"],
      ["⏳", "Waiting on others", "waiting on others"],
      ["⚠️", "Risk / issue", "risk issue"],
      ["❗", "Critical", "critical"],
      ["⭐", "Priority", "priority"]
    ] }
  ];

  // The three ids that sit in two categories get ONE label for the grid slot's tooltip (the picker still shows each
  // category's own label). 🚦 is no longer offered (the TIA's own drawing, svg:tia, replaced it) but a task that saved it
  // keeps drawing it and keeps its hover label.
  var SLOT_LABEL_OVERRIDE = { "c:pond": "Detention pond", "c:joist": "Steel joists", "🏦": "Bank / district / loan", "🚦": "Traffic impact analysis (TIA)" };

  // Emoji that the picker NO LONGER OFFERS but that tasks may have saved: still stored, still drawn (their bundled Twemoji
  // file stays), never rewritten. Add an id here (and keep its file) whenever a library emoji is replaced by a drawing.
  var LEGACY_EMOJI = ["🚦"];

  // Inner markup of <svg viewBox="0 0 36 36">. First drafts, reproduced exactly as the owner supplied them.
  var CUSTOM_SVG = {
    permit: '<rect x="6" y="3" width="20" height="28" rx="2" fill="#E1E8ED" stroke="#99AAB5"/><path d="M10 9h12M10 13h12M10 17h7" stroke="#99AAB5" stroke-width="2"/><circle cx="25" cy="25" r="8" fill="#77B255"/><path d="M21 25l3 3 5-6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    tilt: '<rect x="0" y="31" width="36" height="5" fill="#A0785A"/><rect x="3" y="29" width="30" height="2" fill="#99AAB5"/><g transform="rotate(35 4 31)"><rect x="4" y="9" width="10" height="22" fill="#B4B2A9" stroke="#66757F"/><circle cx="9" cy="14" r="1.2" fill="#66757F"/></g><path d="M21 16V3" stroke="#31373D" stroke-width="1.5"/><path d="M15 2.5h16" stroke="#FFAC33" stroke-width="3"/>',
    roof: '<rect x="4" y="16" width="28" height="17" fill="#CCD6DD"/><rect x="1" y="12" width="34" height="5" fill="#F5F8FA" stroke="#8899A6"/><path d="M9 12v5M16 12v5M23 12v5" stroke="#CCD6DD"/><rect x="21" y="6" width="9" height="6" fill="#8899A6"/><path d="M23 8h5M23 10h5" stroke="#66757F"/><rect x="30" y="17" width="2" height="16" fill="#8899A6"/>',
    dock: '<rect x="2" y="7" width="32" height="26" fill="#CCD6DD"/><rect x="2" y="5" width="32" height="3" fill="#8899A6"/><g fill="#66757F"><rect x="5" y="17" width="7" height="13"/><rect x="14.5" y="17" width="7" height="13"/><rect x="24" y="17" width="7" height="13"/></g><path d="M5 20h7M5 23h7M5 26h7M14.5 20h7M14.5 23h7M14.5 26h7M24 20h7M24 23h7M24 26h7" stroke="#8899A6"/><rect x="0" y="33" width="36" height="3" fill="#99AAB5"/>',
    dump: '<path d="M3 9c2-5 9-5 12 1z" fill="#A0785A"/><path d="M2 9l15 4v11H3z" fill="#FFAC33"/><path d="M19 14h7l6 7v5H19z" fill="#FFCC4D"/><path d="M21 16h4.5l4 5H21z" fill="#88C9F9"/><rect x="2" y="24" width="31" height="3" fill="#66757F"/><circle cx="9" cy="29" r="4" fill="#31373D"/><circle cx="27" cy="29" r="4" fill="#31373D"/><circle cx="9" cy="29" r="1.5" fill="#99AAB5"/><circle cx="27" cy="29" r="1.5" fill="#99AAB5"/>',
    manhole: '<circle cx="18" cy="18" r="16" fill="#66757F"/><circle cx="18" cy="18" r="13" fill="#8899A6"/><path d="M8 13h20M6 18h24M8 23h20M13 7v22M18 5v26M23 7v22" stroke="#66757F" stroke-width="1.5"/>',
    pond: '<path d="M1 13h34l-7 15H8z" fill="#77B255"/><path d="M6 17h24l-4.5 10h-15z" fill="#55ACEE"/><path d="M10 21h4M18 23h5" stroke="#BBDDF5" stroke-width="1.2"/><rect x="27" y="22" width="9" height="4" fill="#99AAB5"/>',
    civil: '<rect x="2" y="5" width="32" height="26" rx="2" fill="#E6F1FB" stroke="#378ADD"/><path d="M5 25c8 0 11-12 26-12" stroke="#8899A6" stroke-width="5" fill="none"/><path d="M5 25c8 0 11-12 26-12" stroke="#fff" stroke-dasharray="2 2" fill="none"/><path d="M6 10h9M6 13h6" stroke="#378ADD" stroke-width="1.5"/><path d="M8 29l22-19" stroke="#2E7D32" stroke-width="1.2" stroke-dasharray="3 1.5"/><rect x="25" y="24" width="7" height="5" fill="#B5D4F4"/>',
    arch: '<rect x="2" y="5" width="32" height="26" rx="2" fill="#F5F8FA" stroke="#8899A6"/><rect x="6" y="9" width="24" height="17" fill="none" stroke="#31373D" stroke-width="1.5"/><g fill="#8899A6"><circle cx="12" cy="15" r="1.1"/><circle cx="18" cy="15" r="1.1"/><circle cx="24" cy="15" r="1.1"/><circle cx="12" cy="20" r="1.1"/><circle cx="18" cy="20" r="1.1"/><circle cx="24" cy="20" r="1.1"/></g><g fill="#31373D"><rect x="9" y="25" width="3" height="2"/><rect x="14" y="25" width="3" height="2"/><rect x="19" y="25" width="3" height="2"/><rect x="24" y="25" width="3" height="2"/></g>',
    tripod: '<path d="M18 13L8 34M18 13l10 21M18 13v21" stroke="#C1694F" stroke-width="2.2"/><rect x="12" y="5" width="11" height="8" rx="1.5" fill="#FFCC4D"/><rect x="22" y="7" width="6" height="3.5" rx="1" fill="#31373D"/><circle cx="17" cy="9" r="1.5" fill="#31373D"/>',
    drill: '<rect x="11" y="2" width="4" height="21" fill="#99AAB5"/><path d="M11 6h4M11 11h4M11 16h4" stroke="#66757F"/><rect x="2" y="22" width="24" height="6" rx="1" fill="#DD2E44"/><rect x="24" y="18" width="10" height="10" rx="1" fill="#BE1931"/><rect x="27" y="20" width="5" height="3.5" fill="#88C9F9"/><path d="M13 28v8" stroke="#66757F" stroke-width="3" stroke-dasharray="2 1.5"/><circle cx="6" cy="30" r="3" fill="#31373D"/><circle cx="29" cy="30" r="3" fill="#31373D"/>',
    sprink: '<rect x="0" y="1" width="36" height="5" fill="#BE1931"/><rect x="15" y="6" width="6" height="5" fill="#99AAB5"/><path d="M13 11h10l-2 5h-6z" fill="#CCD6DD"/><path d="M14 16l2.5 10M22 16l-2.5 10" stroke="#99AAB5" stroke-width="1.6"/><ellipse cx="18" cy="20" rx="2" ry="4" fill="#DD2E44"/><rect x="10" y="26" width="16" height="2.2" rx="1" fill="#99AAB5"/><path d="M8 30l-3 4M13 31l-1 4M23 31l1 4M28 30l3 4" stroke="#55ACEE" stroke-width="1.6" stroke-linecap="round"/>',
    mixer: '<rect x="2" y="25" width="31" height="3" fill="#66757F"/><path d="M24 13h6l5 7v5H24z" fill="#FFCC4D"/><path d="M26 15h3.5l3.5 5h-7z" fill="#88C9F9"/><g transform="rotate(-15 13 18)"><ellipse cx="13" cy="18" rx="11" ry="7" fill="#F4900C"/><path d="M6 13l4 10M12 11l4 13M18 12l3 10" stroke="#FFCC4D" stroke-width="1.6"/></g><circle cx="8" cy="30" r="3.5" fill="#31373D"/><circle cx="28" cy="30" r="3.5" fill="#31373D"/>',
    joist: '<path d="M1 11h34M1 25h34" stroke="#66757F" stroke-width="3"/><path d="M3 25l4.5-14 4.5 14 4.5-14 4.5 14 4.5-14 4.5 14 4.5-14" stroke="#8899A6" stroke-width="2" fill="none"/>',
    plat: '<rect x="2" y="2" width="32" height="32" fill="#EAF3DE" stroke="#3B6D11" stroke-width="1.5"/><rect x="2" y="15" width="32" height="6" fill="#B4B2A9"/><path d="M2 18h32" stroke="#fff" stroke-dasharray="2 2"/><path d="M13 2v13M24 2v13M18 21v13" stroke="#3B6D11" stroke-width="1.5"/>',
    hydrant: '<rect x="9" y="31" width="18" height="3" fill="#99AAB5"/><rect x="12" y="13" width="12" height="18" rx="2" fill="#DD2E44"/><path d="M12 13a6 6 0 0 1 12 0z" fill="#BE1931"/><rect x="16" y="3" width="4" height="5" rx="1" fill="#BE1931"/><rect x="6.5" y="17" width="6" height="5" rx="1" fill="#BE1931"/><rect x="23.5" y="17" width="6" height="5" rx="1" fill="#BE1931"/><rect x="11" y="12" width="14" height="2" fill="#A0041E"/>'
  };

  // Built-in line-art icons, "svg:<name>". Inner markup of <svg viewBox=... fill="none" stroke="currentColor"
  // stroke-linecap="round" stroke-linejoin="round"> (the component sets those root attributes), so the drawing takes the
  // colour of whatever text it sits in: light/dark, hovered, selected, striped rows all stay right with no per-theme art.
  // PLAT (owner-approved artwork, 2026-11-11, picked from eight variants — do not redesign): lots shaded, a street with its
  // cul-de-sac bulb set in from the right edge so the three pie lots past it read as lots, lot lines, outer frame.
  // The street is a TRUE cut-out: the shading is ONE outline that walks round the street (down the left edge to the street's
  // lower kerb, round the bulb, back to the upper kerb) rather than a full square with something painted over it — so there is
  // no background colour in the drawing and no <mask id> to collide when many rows draw it at once.
  var BUILTIN_SVG = {
    plat: {
      viewBox: "0 0 24 24",
      markup: '<path d="M4 2.5H20A1.5 1.5 0 0 1 21.5 4V20A1.5 1.5 0 0 1 20 21.5H4A1.5 1.5 0 0 1 2.5 20V13.3H10.75A3.5 3.5 0 1 0 10.75 10.7H2.5V4A1.5 1.5 0 0 1 4 2.5Z" fill="currentColor" fill-opacity=".2" stroke="none"/>' +
        '<path d="M2.5 10.7H10.75A3.5 3.5 0 1 1 10.75 13.3H2.5" stroke-width="1.3"/>' +
        '<path d="M7 2.5V10.7M12 2.5V9.13M7 13.3V21.5M12 14.87V21.5M16.47 9.53L21.5 4.5M17.5 12H21.5M16.47 14.47L21.5 19.5" stroke-width="1"/>' +
        '<rect x="2.5" y="2.5" width="19" height="19" rx="1.5" stroke-width="1.4"/>'
    },
    // TIA (owner-approved artwork, 2026-11-12, picked from about a dozen variants — do not redesign): a two-lane road with three
    // cars, two in the upper lane facing right and one in the lower lane facing left. Each car is ONE evenodd path (the body with
    // its windshield as a second, inner outline), so the windshield is a TRUE cut-out: no mask, no id, no fixed background colour.
    tia: {
      viewBox: "0 0 24 24",
      markup: '<path d="M2 3.5h20M2 20.5h20" stroke-width="1.4"/>' +
        '<path d="M2 12h20" stroke-width="1" stroke-dasharray="2.5 3"/>' +
        '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M3.2 5.6H7.9A1.4 1.4 0 0 1 9.3 7V8.4A1.4 1.4 0 0 1 7.9 9.8H3.2A1.4 1.4 0 0 1 1.8 8.4V7A1.4 1.4 0 0 1 3.2 5.6ZM7.1 6.4H7.7A0.4 0.4 0 0 1 8.1 6.8V8.6A0.4 0.4 0 0 1 7.7 9H7.1A0.4 0.4 0 0 1 6.7 8.6V6.8A0.4 0.4 0 0 1 7.1 6.4Z"/>' +
        '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.9 5.6H16.6A1.4 1.4 0 0 1 18 7V8.4A1.4 1.4 0 0 1 16.6 9.8H11.9A1.4 1.4 0 0 1 10.5 8.4V7A1.4 1.4 0 0 1 11.9 5.6ZM15.8 6.4H16.4A0.4 0.4 0 0 1 16.8 6.8V8.6A0.4 0.4 0 0 1 16.4 9H15.8A0.4 0.4 0 0 1 15.4 8.6V6.8A0.4 0.4 0 0 1 15.8 6.4Z"/>' +
        '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M14.9 14.2H19.6A1.4 1.4 0 0 1 21 15.6V17A1.4 1.4 0 0 1 19.6 18.4H14.9A1.4 1.4 0 0 1 13.5 17V15.6A1.4 1.4 0 0 1 14.9 14.2ZM15.1 15H15.7A0.4 0.4 0 0 1 16.1 15.4V17.2A0.4 0.4 0 0 1 15.7 17.6H15.1A0.4 0.4 0 0 1 14.7 17.2V15.4A0.4 0.4 0 0 1 15.1 15Z"/>'
    }
  };

  var isCustom = function (id) { return typeof id === "string" && id.slice(0, 2) === "c:"; };
  var customName = function (id) { return id.slice(2); };
  var isBuiltinSvg = function (id) { return typeof id === "string" && id.slice(0, 4) === "svg:"; };
  var svgName = function (id) { return id.slice(4); };
  // "Drawn for Planyr" = either drawn kind (the coloured "c:" ones and the line-art "svg:" ones).
  var isDrawn = function (id) { return isCustom(id) || isBuiltinSvg(id); };

  // Twemoji file name for an emoji: hex codepoints joined by "-", with fe0f (the emoji-presentation selector) dropped.
  var twemojiFile = function (emoji) {
    var cps = [];
    for (var i = 0; i < emoji.length;) {
      var cp = emoji.codePointAt(i);
      i += cp > 0xffff ? 2 : 1;
      if (cp !== 0xfe0f) cps.push(cp.toString(16));
    }
    return cps.join("-");
  };

  // Every id the library offers, in picker order, de-duplicated.
  var ALL_IDS = (function () {
    var seen = {}, out = [];
    CATEGORIES.forEach(function (c) { c.items.forEach(function (it) { if (!seen[it[0]]) { seen[it[0]] = 1; out.push(it[0]); } }); });
    return out;
  })();
  var EMOJI_IDS = ALL_IDS.filter(function (id) { return !isDrawn(id); });
  var knownId = {};
  ALL_IDS.forEach(function (id) { knownId[id] = true; });

  // Merged keywords per id (an id in two categories is findable by either category's words).
  var HAY = {};
  CATEGORIES.forEach(function (c) { c.items.forEach(function (it) { HAY[it[0]] = (HAY[it[0]] || "") + " " + it[1] + " " + it[2]; }); });
  var wordsOf = function (s) { return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); };
  var HAY_WORDS = {};
  Object.keys(HAY).forEach(function (id) { HAY_WORDS[id] = wordsOf(HAY[id]); });

  // A query token matches when it is the START of a word (so "tia" finds the TIA, not "substantial").
  var matches = function (id, tokens) {
    var words = HAY_WORDS[id] || [];
    return tokens.every(function (t) { return words.some(function (w) { return w.indexOf(t) === 0; }); });
  };

  // Picker content: [{ key, title, items: [{ id, label }] }] — categories with no match are dropped; an id never
  // shows twice inside one category. Empty query = everything.
  var searchTaskIcons = function (query) {
    var tokens = wordsOf(query);
    var out = [];
    CATEGORIES.forEach(function (c) {
      var seen = {}, items = [];
      c.items.forEach(function (it) {
        if (seen[it[0]]) return;
        if (tokens.length && !matches(it[0], tokens)) return;
        seen[it[0]] = 1;
        items.push({ id: it[0], label: it[1] });
      });
      if (items.length) out.push({ key: c.key, title: c.title, items: items });
    });
    return out;
  };

  // The label shown when hovering an icon in the grid; custom ones say they were drawn for Planyr.
  var iconLabel = function (id, label) {
    var base = label || SLOT_LABEL_OVERRIDE[id];
    if (!base) {
      for (var i = 0; i < CATEGORIES.length && !base; i++) {
        for (var j = 0; j < CATEGORIES[i].items.length; j++) { if (CATEGORIES[i].items[j][0] === id) { base = CATEGORIES[i].items[j][1]; break; } }
      }
    }
    base = base || String(id);
    return isDrawn(id) ? base + " · drawn for Planyr" : base;
  };

  // What a task's `icons` field may hold: an array of 1–2 short, distinct, non-empty strings (newest kept when more
  // are supplied). Anything else is "no icons" (returns []). Unknown ids are KEPT — a newer client's icon must not be
  // erased by an older one — they just draw nothing.
  var normalizeTaskIcons = function (v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    v.forEach(function (x) {
      if (typeof x !== "string") return;
      var s = x.trim();
      if (!s || s.length > 32) return;
      if (out.indexOf(s) === -1) out.push(s);
    });
    return out.slice(-MAX_ICONS);
  };

  // Click an icon in the picker: a picked one is removed; a new one is added; a third replaces the OLDEST.
  var toggleTaskIcon = function (current, id) {
    var cur = normalizeTaskIcons(current);
    var at = cur.indexOf(id);
    if (at !== -1) return cur.filter(function (x) { return x !== id; });
    var next = cur.concat([id]);
    return next.length > MAX_ICONS ? next.slice(next.length - MAX_ICONS) : next;
  };

  // Collapsed phase summary: the distinct icons of every LEAF task inside `rootId` (tree order) + the leaf count.
  var childIndex = typeof WeakMap === "function" ? new WeakMap() : null;
  var childrenOf = function (tasks) {
    var m = childIndex && childIndex.get(tasks);
    if (m) return m;
    m = {};
    for (var i = 0; i < tasks.length; i++) {
      var p = tasks[i].parentId;
      if (p == null) continue;
      (m[p] || (m[p] = [])).push(tasks[i]);
    }
    if (childIndex) childIndex.set(tasks, m);
    return m;
  };
  var phaseIconSummary = function (tasks, rootId) {
    var kids = childrenOf(tasks || []);
    var icons = [], seen = {}, leaves = 0, guard = {};
    var walk = function (id) {
      if (guard[id]) return;   // a parentId cycle must never hang the render
      guard[id] = 1;
      (kids[id] || []).forEach(function (t) {
        if (kids[t.id] && kids[t.id].length) { walk(t.id); return; }
        leaves++;
        normalizeTaskIcons(t.icons).forEach(function (ic) { if (!seen[ic]) { seen[ic] = 1; icons.push(ic); } });
      });
    };
    walk(rootId);
    return { icons: icons, leaves: leaves };
  };

  var api = {
    MAX_ICONS: MAX_ICONS,
    CATEGORIES: CATEGORIES, CUSTOM_SVG: CUSTOM_SVG, BUILTIN_SVG: BUILTIN_SVG, ALL_IDS: ALL_IDS, EMOJI_IDS: EMOJI_IDS, LEGACY_EMOJI: LEGACY_EMOJI,
    isCustom: isCustom, customName: customName, isBuiltinSvg: isBuiltinSvg, svgName: svgName, isDrawn: isDrawn, isKnown: function (id) { return !!knownId[id]; },
    twemojiFile: twemojiFile,
    searchTaskIcons: searchTaskIcons, iconLabel: iconLabel,
    normalizeTaskIcons: normalizeTaskIcons, toggleTaskIcon: toggleTaskIcon,
    phaseIconSummary: phaseIconSummary
  };
  root.PlanyrTaskIcons = api;
})(typeof window !== "undefined" ? window : globalThis);
