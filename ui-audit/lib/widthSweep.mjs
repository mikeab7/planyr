/* widthSweep.mjs — the geometry half of the app-shell WIDTH SWEEP (NEW-3, 2026-10-05).
 *
 * WHY. The owner, verbatim: "I want the frame to always work regardless of the size of computer or
 * screen that we're on. I don't want to keep going back and forth on a multitude of different screen
 * sizes." A header that wraps, a control clipped at the window edge, a page-level scrollbar — each was
 * found by HIM, on HIS screen, because nothing in CI ever asked the question at another width. This is
 * that question, asked of the DOM's own geometry (never a screenshot diff, so it is blind to the
 * Chromium revision and to antialiasing).
 *
 * TWO PIECES, so the verdict is unit-testable without a browser:
 *   - `collectSnapshot` runs INSIDE the page (it is serialised by `page.evaluate`, so it must stay
 *     self-contained — no imports, no closures) and returns plain JSON: the page's scroll metrics, every
 *     interactive control in the shell chrome with its box and its EFFECTIVE (clip-intersected) box, the
 *     header rows, and every shared toolbar's declared item ids.
 *   - `auditSnapshot` is pure: snapshot in, a list of named violations out. `test/widthSweep.test.js`
 *     pins it against hand-built snapshots, including the exact shapes that were the owner's screenshot.
 *
 * WHAT "CHROME" MEANS HERE: every interactive element inside a `<header>` (module header rows, the tab
 * row, the file-tab strip) and inside any `[data-chrome-toolbar]` (a toolbar that lives outside the
 * header, e.g. the Notes per-page bar). A scroll strip that scrolls ON PURPOSE opts out with
 * `data-sweep-exempt="<reason>"` — the reason is mandatory, an attribute with no reason is a violation,
 * so an exemption cannot be added silently.
 */

/* ---- in-page collector (self-contained!) --------------------------------------------------- */
export function collectSnapshot() {
  const de = document.documentElement, body = document.body;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rectOf = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  const inter = (a, b) => {
    const l = Math.max(a.x, b.x), t = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
    return { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, btm - t) };
  };
  const attrOf = (el, name) => (el ? el.getAttribute(name) : null);
  const legacyRow = (el) => {
    const h = el.closest("header");
    if (!h || h.querySelector("[data-header-row]")) return null;
    const kid = [...h.children].find((c) => c.contains(el));
    return kid ? String([...h.children].indexOf(kid) + 1) : null;
  };
  const roots = [...document.querySelectorAll("header, [data-chrome-toolbar]")];
  const SEL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const controls = [];
  const labelOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText || "").replace(/\s+/g, " ").trim() || el.getAttribute("data-testid") || el.tagName.toLowerCase()).slice(0, 40);
  for (const root of roots) {
    for (const el of root.querySelectorAll(SEL)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // an invisible-by-opacity ancestor (a reserved-but-hidden control) is not on screen
      let hiddenByAncestor = false;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.opacity === "0" || acs.display === "none" || acs.visibility === "hidden") { hiddenByAncestor = true; break; }
      }
      if (hiddenByAncestor) continue;
      // The EFFECTIVE box: the control's box intersected with every clipping ancestor's box.
      const box = rectOf(r);
      let eff = box;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const clips = (v) => v !== "visible";
        if (clips(acs.overflowX) || clips(acs.overflowY)) {
          const ar = rectOf(a.getBoundingClientRect());
          eff = inter(eff, {
            x: clips(acs.overflowX) ? ar.x : -1e9, y: clips(acs.overflowY) ? ar.y : -1e9,
            w: clips(acs.overflowX) ? ar.w : 2e9, h: clips(acs.overflowY) ? ar.h : 2e9,
          });
        }
      }
      const ex = el.closest("[data-sweep-exempt]");
      // NEW-2: the Univer grid's OWN <header> (its toolbar strip, [data-u-comp="headerbar"]) is a <header> element but not the app shell: it has no
      // data-header-row, so legacyRow() used to file its controls under "row 1 / row 2" of the APP header and the sweep reported two-line rows that
      // are really two different strips. Its controls are collected flagged `univer` and judged by their own rules in auditSnapshot (one strip, flat,
      // edge to edge, nothing past the window, no half-cut button) instead of the shell's row model.
      // (Univer also wraps its formula bar in an unnamed <header> — name box, formula editor — so the whole grid host counts, not just the toolbar strip.)
      const inUniver = !!el.closest('[data-testid="univer-grid"]');
      const inUniverToolbar = !!el.closest('[data-u-comp="headerbar"]');
      controls.push({
        label: labelOf(el), tag: el.tagName.toLowerCase(),
        itemId: attrOf(el.closest("[data-toolbar-item-id]"), "data-toolbar-item-id"),
        box, eff,
        exempt: ex ? ex.getAttribute("data-sweep-exempt") : null,
        univer: inUniver, univerToolbar: inUniverToolbar,
        row: inUniver ? null : (attrOf(el.closest("[data-header-row]"), "data-header-row") || legacyRow(el)),
      });
    }
  }
  // Rows carry data-header-row="1|2". A build from before that marker existed (the red-proof run against
  // an older deploy) is read structurally instead: each header's block children are its rows, in order.
  let rowEls = [...document.querySelectorAll("[data-header-row]")].map((e) => ({ el: e, row: e.getAttribute("data-header-row") }));
  if (!rowEls.length) {
    for (const h of document.querySelectorAll("header")) [...h.children].forEach((c, i) => { if (c.firstElementChild && c.getBoundingClientRect().height > 0) rowEls.push({ el: c.firstElementChild, row: String(i + 1) }); });
  }
  const rows = rowEls.filter(({ el }) => el.getBoundingClientRect().height > 0).map(({ el, row }) => ({ row, box: rectOf(el.getBoundingClientRect()) }));
  const toolbars = [...document.querySelectorAll("[data-priority-toolbar]")].filter((e) => e.getBoundingClientRect().height > 0).map((e) => ({
    name: e.getAttribute("data-priority-toolbar"),
    box: rectOf(e.getBoundingClientRect()),
    allIds: (e.getAttribute("data-all-ids") || "").split(",").filter(Boolean),
    menuIds: (e.getAttribute("data-menu-ids") || "").split(",").filter(Boolean),
    ghostIds: (e.getAttribute("data-ghost-ids") || "").split(",").filter(Boolean),
    settled: e.getAttribute("data-toolbar-settled") !== "false",
    iconIds: (e.getAttribute("data-icon-ids") || "").split(",").filter(Boolean),
    barIds: [...e.querySelectorAll("[data-toolbar-bar] [data-toolbar-item-id]")].filter((i) => i.getBoundingClientRect().width > 0).map((i) => i.getAttribute("data-toolbar-item-id")),
    hasMore: !!e.querySelector("[data-toolbar-more]"),
  }));
  const uh = document.querySelector('[data-u-comp="headerbar"]');
  const univerHeader = uh && uh.getBoundingClientRect().height > 0 ? rectOf(uh.getBoundingClientRect()) : null;
  return {
    univerHeader,
    vw, vh, dpr: window.devicePixelRatio,
    docScrollW: de.scrollWidth, docClientW: de.clientWidth, docScrollH: de.scrollHeight, docClientH: de.clientHeight,
    bodyScrollW: body.scrollWidth, bodyClientW: body.clientWidth, bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight,
    scrollX: window.scrollX, scrollY: window.scrollY,
    controls, rows, toolbars,
    exemptions: [...document.querySelectorAll("[data-sweep-exempt]")].map((e) => e.getAttribute("data-sweep-exempt") || ""),
  };
}

/* ---- pure verdict ---------------------------------------------------------------------------- */
export const TOL = {
  page: 1,            // px of scroll slack (sub-pixel rounding) before "page scroll" is real
  clip: 2,            // px a control may be cut by a clipping ancestor
  outside: 1,         // px a control may poke outside the viewport
  overlap: 2,         // px BOTH axes must intersect by before two controls "overlap" (borders touch)
  rowMax: 48,         // a header row taller than this wrapped (rows are 40 high)
  bandSpread: 14,     // max spread of control centre-lines inside one row
};

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
const contains = (a, b, t = 1) => b.x >= a.x - t && b.y >= a.y - t && b.x + b.w <= a.x + a.w + t && b.y + b.h <= a.y + a.h + t;
const inter = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { w, h };
};

/** Pure: snapshot -> [{ kind, detail }]. Empty array = clean. */
export function auditSnapshot(s) {
  const v = [];
  // 1. NO PAGE-LEVEL SCROLL, in either direction.
  if (s.docScrollW - s.docClientW > TOL.page) v.push({ kind: "page-scroll-x", detail: `document scrollWidth ${s.docScrollW} > clientWidth ${s.docClientW}` });
  if (s.docScrollH - s.docClientH > TOL.page) v.push({ kind: "page-scroll-y", detail: `document scrollHeight ${s.docScrollH} > clientHeight ${s.docClientH}` });
  if (s.bodyScrollW - s.bodyClientW > TOL.page) v.push({ kind: "page-scroll-x", detail: `body scrollWidth ${s.bodyScrollW} > clientWidth ${s.bodyClientW}` });
  if (s.bodyScrollH - s.bodyClientH > TOL.page) v.push({ kind: "page-scroll-y", detail: `body scrollHeight ${s.bodyScrollH} > clientHeight ${s.bodyClientH}` });
  if (s.scrollX !== 0 || s.scrollY !== 0) v.push({ kind: "page-scrolled", detail: `window scrolled to ${s.scrollX},${s.scrollY}` });

  // An exemption with no stated reason is itself a violation: it cannot be added silently.
  for (const reason of s.exemptions || []) if (!String(reason).trim()) v.push({ kind: "exemption-without-reason", detail: "data-sweep-exempt must name why the strip may scroll/clip" });

  const live = s.controls.filter((c) => !c.exempt && !c.univer);
  // 1b. THE UNIVER GRID'S OWN TOOLBAR STRIP (NEW-2) — a third-party widget with its own overflow ("⋮"), judged by what the owner asked of it
  //     (docs: one flat strip, edge to edge) rather than the shell's row model. It is NOT exempt: it must be one row, span the window, keep every
  //     control on screen, never hide HALF of a button, and never let two controls collide. The ONE thing not asserted here is the `clipped`
  //     rule for its text <input>s: Univer's font-name combobox draws a 181px <input> inside a 128px `univer-truncate` wrapper on purpose (the
  //     overflow is text that is truncated, measured at 800 and 1440 alike) — buttons and links, which have no such design, are still held to it.
  if (s.univerHeader) {
    const h = s.univerHeader;
    if (h.h > TOL.rowMax) v.push({ kind: "univer-header-wrapped", detail: `the Univer toolbar strip is ${h.h.toFixed(0)}px tall (one tool row is ~40px) — it wrapped or went two-strip` });
    if (Math.abs(h.x) > TOL.outside || Math.abs(h.w - s.vw) > TOL.outside) v.push({ kind: "univer-header-inset", detail: `the Univer toolbar strip is ${fmt(h)} in a ${s.vw}px window — it must run edge to edge` });
  }
  const U = s.controls.filter((c) => c.univer && !c.exempt);
  for (const c of U) {
    const b = c.box;
    const off = Math.max(-b.x, -b.y, b.x + b.w - s.vw, b.y + b.h - s.vh);
    if (off > TOL.outside) v.push({ kind: "outside-viewport", detail: `Univer toolbar: "${c.label}" sticks out of the viewport by ${off.toFixed(1)}px (box ${fmt(b)})` });
    const cutW = b.w - c.eff.w, cutH = b.h - c.eff.h;
    if (c.tag !== "input" && area(b) - area(c.eff) > 0 && Math.max(cutW, cutH) > TOL.clip) v.push({ kind: "clipped", detail: `Univer toolbar: "${c.label}" is cut off by an ancestor (${cutW.toFixed(1)}px wide, ${cutH.toFixed(1)}px tall hidden)` });
  }
  for (let i = 0; i < U.length; i++) {
    for (let j = i + 1; j < U.length; j++) {
      const a = U[i].eff, b = U[j].eff;
      if (area(a) === 0 || area(b) === 0) continue;
      if (contains(a, b) || contains(b, a)) continue;
      const x = inter(a, b);
      if (x.w > TOL.overlap && x.h > TOL.overlap) v.push({ kind: "overlap", detail: `Univer toolbar: "${U[i].label}" and "${U[j].label}" overlap by ${x.w.toFixed(1)}×${x.h.toFixed(1)}px` });
    }
  }
  const seen = U.filter((c) => c.univerToolbar && area(c.eff) > 0);   // the toolbar strip only — the formula bar under it is its own strip
  if (seen.length > 1) {
    const mids = seen.map((c) => c.eff.y + c.eff.h / 2);
    const spread = Math.max(...mids) - Math.min(...mids);
    if (spread > TOL.bandSpread) v.push({ kind: "univer-two-lines", detail: `the Univer toolbar's controls sit on more than one line (centre-lines ${spread.toFixed(0)}px apart)` });
  }
  // 2. EVERY CHROME CONTROL FULLY ON SCREEN AND NOT CLIPPED.
  for (const c of live) {
    const b = c.box;
    const off = Math.max(-b.x, -b.y, b.x + b.w - s.vw, b.y + b.h - s.vh);
    if (off > TOL.outside) v.push({ kind: "outside-viewport", detail: `"${c.label}" sticks out of the viewport by ${off.toFixed(1)}px (box ${fmt(b)})` });
    const cut = area(b) - area(c.eff);
    const cutW = b.w - c.eff.w, cutH = b.h - c.eff.h;
    if (cut > 0 && Math.max(cutW, cutH) > TOL.clip) v.push({ kind: "clipped", detail: `"${c.label}" is cut off by an ancestor (${cutW.toFixed(1)}px wide, ${cutH.toFixed(1)}px tall hidden)` });
  }
  // 3. NO TWO CONTROLS INTERSECT (compared on what is actually painted — the clipped box).
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i].eff, b = live[j].eff;
      if (area(a) === 0 || area(b) === 0) continue;
      if (contains(a, b) || contains(b, a)) continue; // nested control, not a collision
      const x = inter(a, b);
      if (x.w > TOL.overlap && x.h > TOL.overlap) v.push({ kind: "overlap", detail: `"${live[i].label}" and "${live[j].label}" overlap by ${x.w.toFixed(1)}×${x.h.toFixed(1)}px` });
    }
  }
  // 4. EACH HEADER ROW / TOOLBAR IS EXACTLY ONE ROW TALL.
  for (const r of s.rows) {
    if (r.box.h > TOL.rowMax) v.push({ kind: "row-wrapped", detail: `header row ${r.row} is ${r.box.h.toFixed(0)}px tall (a single row is ~40px) — it wrapped` });
    const inRow = live.filter((c) => c.row === r.row);
    if (inRow.length > 1) {
      const mids = inRow.map((c) => c.box.y + c.box.h / 2);
      const spread = Math.max(...mids) - Math.min(...mids);
      if (spread > TOL.bandSpread) v.push({ kind: "row-two-lines", detail: `header row ${r.row} controls sit on more than one line (centre-lines ${spread.toFixed(0)}px apart)` });
    }
  }
  for (const t of s.toolbars) {
    if (t.box.h > TOL.rowMax) v.push({ kind: "toolbar-wrapped", detail: `toolbar "${t.name}" is ${t.box.h.toFixed(0)}px tall` });
    // nothing is simply dropped: every declared item is on the bar OR named as living in the menu
    const accounted = new Set([...t.barIds, ...t.menuIds]);
    // a GHOST item (unavailable right now — PriorityToolbar `ghost`) is absent from the bar and the menu BY CONTRACT,
    // so it is never "dropped"; a visible item still is. (Schedule: inbox/format wait for projects, zoom for a zoomable view.)
    const ghosts = new Set(t.ghostIds || []);
    for (const id of t.allIds) if (!accounted.has(id) && !ghosts.has(id)) v.push({ kind: "item-dropped", detail: `toolbar "${t.name}": item "${id}" is neither on the bar nor in the overflow menu` });
    if (t.menuIds.length && !t.hasMore) v.push({ kind: "no-more-button", detail: `toolbar "${t.name}" moved ${t.menuIds.join(", ")} to a menu but renders no More button` });
  }
  return v;
}

/** Pure: after the harness opened a toolbar's More menu, are all the promised items in it? */
export function auditMenu(t, openedItemIds) {
  const v = [];
  const got = new Set(openedItemIds);
  for (const id of t.menuIds) if (!got.has(id)) v.push({ kind: "menu-missing-item", detail: `toolbar "${t.name}": More menu lacks "${id}"` });
  return v;
}

function fmt(b) { return `${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.w.toFixed(0)}×${b.h.toFixed(0)}`; }
