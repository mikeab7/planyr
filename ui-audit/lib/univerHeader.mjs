/* univerHeader — the PURE verdict for the Univer grid's header strip (NEW-1 / NEW-2, B2574352 / B2574353).
 * `measureHeaderInPage` runs inside the page and returns plain numbers / strings; `judgeHeader` turns them into PASS/FAIL rows.
 * Kept free of any browser or Univer import so test/univerHeaderVerdict.test.js can prove each rule goes RED on the old shape
 * (Univer's default two-strip "classic" ribbon, its dark pill and its angular icons) and GREEN on the new one.
 *
 * The rules are the owner's own words (2026-10-30): ONE header above the formula bar; the tab dropdown at the far left; the tools
 * left-packed beside it (no centring); flat (no pill, no rounded corner, no shadow anywhere in the strip); curved undo / redo. */

export const MAX_STRIP_HEIGHT = 48;          // a single tool row + its hairline; Univer's two-strip header is ~76
export const ROW_TOLERANCE = 8;              // controls whose vertical centres differ by less than this share one row

/** Runs IN THE PAGE (serialised by Playwright) — returns only JSON-safe data. `host` is the grid host element. */
export function measureHeaderInPage() {
  const host = document.querySelector('[data-testid="univer-grid"]') || document.querySelector(".planyr-univer");
  const header = host && host.querySelector('[data-u-comp="headerbar"]');
  if (!header) return { found: false };
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const hb = box(header), hostBox = box(host);
  const fbarEl = host.querySelector('[data-u-comp="formula-bar"]');
  const interactive = [...header.querySelectorAll("button, a, input, [role=button]")].filter(visible).map((el) => {
    const b = box(el);
    return { tag: el.tagName.toLowerCase(), cmd: el.getAttribute("data-u-command") || "", label: el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 24), ...b, cy: (b.top + b.bottom) / 2 };
  });
  const rows = [];
  for (const c of [...interactive].sort((a, b) => a.cy - b.cy)) {
    const row = rows.find((r) => Math.abs(r.cy - c.cy) < 8);
    if (row) row.n++; else rows.push({ cy: c.cy, n: 1 });
  }
  const dd = [...header.querySelectorAll("a[data-state]")].find(visible) || null;
  let firstTool = null;
  // A TOOL is one item of the ribbon-toolbar's groups: a button, a font box, or a menu selector (Formulas' "Common Functions ▾" is a div, not a button).
  const tools = [...header.querySelectorAll('[data-u-comp="ribbon-toolbar"] > div > span')].filter(visible).map((el) => {
    const b = box(el), inner = el.querySelector("[data-u-command], [aria-label]");
    const svg = el.querySelector("svg");
    return { label: (inner && (inner.getAttribute("aria-label") || inner.getAttribute("data-u-command"))) || (el.textContent || "").trim().slice(0, 24) || (svg && svg.getAttribute("class")) || "tool", ...b };
  }).sort((a, b) => a.left - b.left);
  firstTool = tools.find((t) => !dd || t.left >= box(dd).right - 1) || null;
  const radiusOffenders = [], shadowOffenders = [];
  for (const el of header.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
    const tag = `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") || "").split(/\s+/).slice(0, 2).join(".")}`;
    if (radii.some((r) => parseFloat(r) > 0)) radiusOffenders.push(`${tag}:${radii[0]}`);
    if (cs.boxShadow && cs.boxShadow !== "none") shadowOffenders.push(tag);
  }
  const iconInfo = (cmd) => {
    const b = [...header.querySelectorAll(`[data-u-command="${cmd}"]`)].find(visible);
    const svg = b && b.querySelector("svg");
    if (!svg) return null;
    const sb = box(svg), cs = getComputedStyle(svg);
    const paths = [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d") || "");
    return {
      marker: svg.getAttribute("data-planyr-icon") || "", paths, hasPolyline: svg.querySelectorAll("polyline").length,
      stroke: svg.getAttribute("stroke") || "", fill: svg.getAttribute("fill") || "", filledPath: [...svg.querySelectorAll("path")].some((p) => (p.getAttribute("fill") || "") === "currentColor"),
      width: sb.width, height: sb.height, color: cs.color, disabled: b.disabled === true,
    };
  };
  // Tools OTHER sessions register (indent today) must land inside the strip's own row, or fold into the overflow — never a second row.
  const registered = ["planyr.sheet.command.increase-indent", "planyr.sheet.command.decrease-indent"].map((cmd) => {
    const el = [...header.querySelectorAll(`[data-u-command="${cmd}"]`)].find(visible);
    if (!el) return { cmd, shown: false };
    const b = box(el);
    return { cmd, shown: true, inHeader: b.top >= hb.top - 1 && b.bottom <= hb.bottom + 1, cy: (b.top + b.bottom) / 2, hasIcon: !!el.querySelector("svg") };
  });
  const mainRow = firstTool ? (firstTool.top + firstTool.bottom) / 2 : null;
  return {
    found: true, registered, mainRow,
    header: hb, host: hostBox, formulaBar: box(fbarEl),
    tabBandHeight: (box(header.querySelector('[data-u-comp="ribbon-header-menu"]')) || { height: 0 }).height,
    rows: rows.length, interactiveCount: interactive.length,
    dropdown: dd ? { ...box(dd), text: (dd.textContent || "").trim() } : null,
    leftmost: interactive.length ? [...interactive].sort((a, b) => a.left - b.left)[0] : null,
    firstTool,
    radiusOffenders, shadowOffenders,
    undo: iconInfo("univer.command.undo"), redo: iconInfo("univer.command.redo"),
    neighbour: iconInfo("ui.operation.activate-format-painter"),
    bold: iconInfo("sheet.command.set-range-bold"),
    toolSig: tools.map((t) => t.label).join("|"), toolCount: tools.length,
    overflow: !![...header.querySelectorAll("svg")].find((s) => visible(s) && /more-vertical/.test(s.getAttribute("class") || "")),
  };
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const ARC = /[Aa]\s*-?\d/;

/** m = measureHeaderInPage() result (+ optional `enabledUndo` / `enabledBold` icon infos taken after an edit). */
export function judgeHeader(m) {
  const out = [];
  const add = (id, label, ok, detail) => out.push({ id, label, ok: !!ok, detail });
  if (!m || !m.found) { add("found", "the header strip is on the page", false, "no [data-u-comp=headerbar]"); return out; }
  const h = m.header;
  add("one-row", "ONE header row above the formula bar (no separate tab strip)",
    m.rows === 1 && m.tabBandHeight <= 2 && h.height <= MAX_STRIP_HEIGHT && !!m.formulaBar && m.formulaBar.top >= h.bottom - 1 && m.formulaBar.top - h.bottom <= 2 && near(m.formulaBar.left, m.host.left, 1),
    `${m.rows} row(s) of controls · tab band ${m.tabBandHeight.toFixed(0)} px · header ${h.height.toFixed(0)} px · formula bar top ${m.formulaBar ? m.formulaBar.top.toFixed(0) : "n/a"} vs header bottom ${h.bottom.toFixed(0)}`);
  const d = m.dropdown;
  add("dropdown-left", "the ribbon-tab dropdown is at the strip's left edge and is its leftmost control",
    !!d && d.left - m.host.left <= 24 && !!m.leftmost && near(m.leftmost.left, d.left, 1) && /^(Start|Formulas|Data|View)/.test(d.text),
    d ? `"${d.text}" starts ${(d.left - m.host.left).toFixed(0)} px from the grid's left edge; leftmost control starts ${m.leftmost ? m.leftmost.left.toFixed(0) : "n/a"} vs ${d.left.toFixed(0)}` : "no dropdown found (the tabs are a centred row)");
  const mid = h.left + h.width / 2, ft = m.firstTool;
  add("tools-left", "the first tool is left of the strip's midpoint and packed right beside the dropdown",
    !!ft && ft.left < mid && !!d && ft.left - d.right <= 48,
    ft ? `first tool "${ft.label}" at ${ft.left.toFixed(0)} px (midpoint ${mid.toFixed(0)}); gap after dropdown ${d ? (ft.left - d.right).toFixed(0) : "n/a"} px` : "no tool found");
  add("flat", "nothing in the strip has a border radius or a box shadow",
    m.radiusOffenders.length === 0 && m.shadowOffenders.length === 0,
    m.radiusOffenders.length || m.shadowOffenders.length ? `${m.radiusOffenders.length} rounded (e.g. ${m.radiusOffenders.slice(0, 3).join(", ")}), ${m.shadowOffenders.length} shadowed` : "0 rounded, 0 shadowed");
  for (const [key, name] of [["undo", "undo"], ["redo", "redo"]]) {
    const i = m[key];
    const curved = !!i && i.marker === `${name}-curved` && i.paths.some((p) => ARC.test(p)) && !i.filledPath && i.stroke === "currentColor";
    add(`${key}-curved`, `${name} is the curved arrow (an arc path, drawn in the toolbar's own colour)`, curved,
      i ? `marker "${i.marker}" · ${i.paths.length} path(s), arc command ${i.paths.some((p) => ARC.test(p))} · filled default path ${i.filledPath}` : "icon not found");
  }
  if (m.registered) {
    const shown = m.registered.filter((r) => r.shown);
    add("registered-tools", "tools another session registers (indent) sit INSIDE the single row, or fold into the overflow — never a second row",
      m.registered.every((r) => !r.shown || (r.inHeader && r.hasIcon && m.mainRow != null && Math.abs(r.cy - m.mainRow) < 8)),
      `${shown.length} of ${m.registered.length} shown${shown.length ? ", all in the header row" : " (folded into the overflow at this width)"}`);
  }
  const n = m.neighbour;
  add("icon-size-colour", "undo / redo match the neighbouring icons' size and (disabled) colour",
    !!(m.undo && m.redo && n) && near(m.undo.width, n.width, 0.5) && near(m.undo.height, n.height, 0.5) && near(m.redo.width, n.width, 0.5) && m.undo.color === n.color && m.redo.color === n.color,
    m.undo && n ? `undo ${m.undo.width.toFixed(0)}×${m.undo.height.toFixed(0)} ${m.undo.color} · redo ${m.redo ? m.redo.color : "n/a"} · neighbour ${n.width.toFixed(0)}×${n.height.toFixed(0)} ${n.color}` : "icons not found");
  if (m.enabledUndo && m.bold) {
    add("icon-enabled-colour", "an ENABLED undo is drawn in the same colour as the other enabled tools",
      !m.enabledUndo.disabled && m.enabledUndo.color === m.bold.color && near(m.enabledUndo.width, m.bold.width, 0.5),
      `undo ${m.enabledUndo.color} (disabled=${m.enabledUndo.disabled}) vs bold ${m.bold.color}`);
  }
  return out;
}
