/* The Planyr-only-tools section of the Univer parity checklist (NEW-1, cutover step 6; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Five tools lived only in the old grid's code — formula-consistency flags + the Inconsistencies panel, trace precedents / dependents,
 * the command palette, the Name Manager and the input / formula colour convention. Each is driven here the way a person drives it
 * (REAL clicks on the real toolbar buttons, REAL keystrokes) against the REAL <UniverSheet>; the grid is a canvas, so the verdicts are
 * (a) PIXELS on the canvas for what must be drawn (a corner marker, an arrow, blue text) and (b) Univer's facade / the saved Planyr
 * workbook for what must be stored. Every check is STRICT — it FAILS when the tool is absent (so it is red on a build without
 * lib/univerTools) — and every write is required to be ONE undo step.
 *
 * Registered from verify-univer-parity.mjs (sandbox host); verify-univer-live.mjs binds the same plumbing to the real signed-in app. */
export function registerUniverToolsChecks(h) {
  const { check, PASS, FAIL, reset, click, press, sel, cell, val1, inSheet, ev, wait, eq, pt, clickToolbar, savedLast, flushSave, model } = h;
  const pg = () => h.page();
  const tools = (fn, arg) => pg().evaluate(`((arg) => { const t = window.__planyrUniverRead && window.__planyrUniverRead.tools && window.__planyrUniverRead.tools(); if (!t) return { __missing: true }; return (${fn.toString()})(t, arg); })(${JSON.stringify(arg ?? null)})`);
  const missing = (v) => !!(v && v.__missing);
  const { createWorkbook, setRaw } = model;
  const wbOf = (build) => { const wb = createWorkbook(); const sh = build(wb.sheets[0].sheet); return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] }; };

  /** The toolbar's tab dropdown: bring the Formulas tab (where the seven Planyr tools sit) into the one header strip. */
  const showFormulasTab = async () => {
    const seen = await ev(() => [...document.querySelectorAll('[data-u-command="planyr.tools.trace-precedents"]')].some((e) => e.getBoundingClientRect().width > 0));
    if (seen) return;
    await pg().click('[data-u-comp="headerbar"] a[data-state]'); await wait(350);
    await pg().getByText("Formulas", { exact: true }).first().click(); await wait(600);
  };
  const tool = async (id) => { await showFormulasTab(); await clickToolbar(`planyr.tools.${id}`); await wait(450); };
  /** how many pixels inside `clip` satisfy `test` (a boolean expression of r, g, b) — read straight off the page's own pixels */
  const countPx = async (clip, test) => {
    const buf = await pg().screenshot({ clip });
    return pg().evaluate(async ({ b64, src }) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; const f = new Function("r", "g", "b", `return ${src};`); let n = 0;
      for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++;
      return n;
    }, { b64: buf.toString("base64"), src: test });
  };
  const ORANGE = "r > 150 && g < 140 && b < 90 && r - b > 80";            // the flag marker (#C2410C)
  const ARROW = "b > 150 && b - r > 80 && g < 170";                   // the trace arrow (#2563EB)
  const INPUT_BLUE = "b > 120 && b - r > 60 && g < 150";                        // typed-input text (#1D4ED8)
  const cornerClip = async (r, c) => { const p = await pt(r, c); return { x: p.left + 1, y: p.top + 1, width: 11, height: 11 }; };
  const gridClip = async () => { const a = await pt(0, 0), b = await pt(9, 5); return { x: a.left, y: a.top, width: b.right - a.left, height: b.bottom - a.top }; };
  const park = () => click(20, 10);
  const savedSheet = async () => { await flushSave(); const s = await savedLast(); return s && s.wb && s.wb.sheets && s.wb.sheets[0] ? s.wb.sheets[0].sheet : null; };
  const closePanels = () => tools((t) => { t.closePanel(); return true; });
  const colorOff = () => tools((t) => { if (t.getState().autoColor) t.run("planyr.tools.toggle-autocolor"); return true; });

  // ===========================================================================================================================
  check("tools-flags", "Consistency flags: a corner marker on the odd cell of a formula run, listed in the panel, the row jumps the selection, Dismiss clears it (one undo step) and is saved", async () => {
    const wb = wbOf((sh0) => { let sh = sh0; for (let i = 0; i < 6; i++) { sh = setRaw(sh, i, 0, String(i + 1)); sh = setRaw(sh, i, 1, i === 3 ? "99" : `=A${i + 1}*2`); } return sh; });
    await reset(wb); await closePanels(); await park(); await wait(900);
    const flags = await tools((t) => t.getState().flags.map((f) => `${f.row}:${f.col}:${f.kind}`));
    if (missing(flags)) return FAIL("the tools are not installed (no window.__planyrUniverRead.tools)");
    if (!eq(flags, ["3:1:hardcoded"])) return FAIL(`expected exactly the hardcoded 99 in B4 flagged, got ${JSON.stringify(flags)}`);
    const onB4 = await countPx(await cornerClip(3, 1), ORANGE), onB3 = await countPx(await cornerClip(2, 1), ORANGE);
    if (onB4 < 4 || onB3 !== 0) return FAIL(`corner marker pixels: B4 ${onB4} (need ≥4), B3 ${onB3} (need 0)`);
    await tool("toggle-inconsistencies");
    const panel = await ev(() => { const p = document.querySelector('[data-testid="inconsistency-panel"]'); return p ? { rows: p.querySelectorAll('[data-testid="inconsistency-row"]').length, text: p.innerText.replace(/\s+/g, " ") } : null; });
    if (!panel || panel.rows !== 1 || !/B4/.test(panel.text)) return FAIL(`the Inconsistent Formulas panel did not list B4 (${JSON.stringify(panel)})`);
    await pg().locator('[data-testid="inconsistency-panel"] button[title^="Go to"]').first().click(); await wait(300);
    const at = await sel();
    if (!(at.length === 1 && at[0].a1 === "B4")) return FAIL(`clicking the row selected ${JSON.stringify(at)}, not B4`);
    const before = await inSheet((api) => JSON.stringify(api.getActiveWorkbook().save().resources));
    await pg().locator('[data-testid="inconsistency-panel"] button[title="Dismiss this flag"]').first().click(); await wait(1000);
    const after = await tools((t) => t.getState().flags.length);
    if (after !== 0) return FAIL(`Dismiss left ${after} flag(s)`);
    if ((await countPx(await cornerClip(3, 1), ORANGE)) > 0) return FAIL("the marker is still painted after Dismiss");
    const sheet = await savedSheet();
    const col1 = sheet && sheet.columns[1] && sheet.columns[1].id;
    if (!sheet || !col1 || !sheet.dismissedInconsistencies || !sheet.dismissedInconsistencies[`${col1}:3`]) return FAIL(`the dismissal was not saved in sheet.dismissedInconsistencies (${JSON.stringify(sheet && sheet.dismissedInconsistencies)})`);
    await click(12, 4); await press("Control+z"); await wait(1000);
    const back = await tools((t) => t.getState().flags.length);
    const sheet2 = await savedSheet();
    if (back !== 1) return FAIL(`one Ctrl+Z did not bring the flag back (${back} flags)`);
    if (sheet2 && Object.keys(sheet2.dismissedInconsistencies || {}).length) return FAIL("the undone dismissal is still in the saved workbook");
    if ((await countPx(await cornerClip(3, 1), ORANGE)) < 4) return FAIL("the marker did not come back on the canvas after the undo");
    return PASS("B4 flagged as a hardcoded value (marker pixels B4 " + onB4 + " vs B3 0); panel row jumped to B4; Dismiss cleared marker + flag and saved the key; one Ctrl+Z restored all three");
  });

  check("tools-flags-pattern", "Consistency flags: a formula that breaks the pattern is flagged as a different pattern; a clean formula run is not flagged at all", async () => {
    const clean = wbOf((sh0) => { let sh = sh0; for (let i = 0; i < 6; i++) { sh = setRaw(sh, i, 0, String(i + 1)); sh = setRaw(sh, i, 1, `=A${i + 1}*2`); } return sh; });
    await reset(clean); await wait(900);
    const none = await tools((t) => t.getState().flags.length);
    if (missing(none)) return FAIL("the tools are not installed");
    if (none !== 0) return FAIL(`a clean formula column was flagged ${none} time(s)`);
    const odd = wbOf((sh0) => { let sh = sh0; for (let i = 0; i < 6; i++) { sh = setRaw(sh, i, 0, String(i + 1)); sh = setRaw(sh, i, 1, i === 2 ? "=A3*2+100" : `=A${i + 1}*2`); } return sh; });
    await reset(odd); await wait(900);
    const flags = await tools((t) => t.getState().flags.map((f) => `${f.row}:${f.col}:${f.kind}`));
    return eq(flags, ["2:1:shape-mismatch"]) ? PASS("the clean run: 0 flags; =A3*2+100 among =An*2 flagged as a different pattern") : FAIL(`got ${JSON.stringify(flags)}`);
  });

  // ===========================================================================================================================
  check("tools-trace", "Trace precedents / dependents: arrows drawn on the canvas for the active cell, one level further on a second click, cleared by Escape and by an edit", async () => {
    const wb = wbOf((sh0) => { let sh = sh0; [1, 2, 3].forEach((n, i) => { sh = setRaw(sh, i, 0, String(n)); }); sh = setRaw(sh, 0, 2, "=SUM(A1:A3)"); sh = setRaw(sh, 1, 2, "=C1*2"); return sh; });
    await reset(wb);
    if (missing(await colorOff())) return FAIL("the tools are not installed");
    await wait(300); await park(); await wait(300);
    const clip = await gridClip(); const base = await countPx(clip, ARROW);        // nothing selected inside the clip, no text blue: the baseline is the grid alone
    await click(0, 2); await wait(200);
    await tool("trace-precedents");
    const t1 = await tools((t) => { const r = t.getState().rendered; return r && { mode: r.mode, level: r.level, arrows: r.arrows.map((a) => ({ from: a.fromRect, to: a.toCell })) }; });
    if (!t1 || t1.mode !== "precedents" || t1.arrows.length !== 1 || !eq(t1.arrows[0].from, { r1: 0, c1: 0, r2: 2, c2: 0 }) || !eq(t1.arrows[0].to, { row: 0, col: 2 })) return FAIL(`precedents of =SUM(A1:A3): ${JSON.stringify(t1)}`);
    await park(); await wait(400);
    const drawn = await countPx(clip, ARROW);
    if (drawn - base < 60) return FAIL(`no arrow on the canvas: ${drawn} arrow-blue pixels vs ${base} before`);
    await press("Escape"); await wait(400);
    const cleared = await tools((t) => t.getState().trace === null);
    const after = await countPx(clip, ARROW);
    if (!cleared || after > base + 5) return FAIL(`Escape did not clear the trace (state cleared=${cleared}, arrow pixels ${after} vs ${base})`);
    // dependents, one level at a time
    await click(0, 0); await wait(200);
    await tool("trace-dependents");
    const d1 = await tools((t) => t.getState().rendered.level);
    await tool("trace-dependents");
    const d2 = await tools((t) => { const r = t.getState().rendered; return { level: r.level, arrows: r.arrows.length }; });
    if (d1 !== 1 || d2.level !== 2 || d2.arrows < 2) return FAIL(`dependents of A1: level ${d1} then ${JSON.stringify(d2)} (want 1, then level 2 with ≥ 2 arrows)`);
    // an edit removes the arrows (the trace was of the old formulas)
    await click(5, 4); await pg().keyboard.type("7", { delay: 8 }); await press("Enter"); await wait(500);
    const gone = await tools((t) => t.getState().trace === null);
    return gone ? PASS(`precedents: 1 range arrow A1:A3 → C1 (+${drawn - base} arrow pixels), Escape cleared it; dependents level 1 then 2 (${d2.arrows} arrows); an edit cleared the trace`) : FAIL("an edit left the trace on screen");
  });

  // ===========================================================================================================================
  check("tools-palette", "Command palette: Ctrl+K opens it, it lists Univer's and Planyr's commands, typing 'bold' + Enter bolds the cell as ONE undo step, and a Planyr tool runs from it", async () => {
    const wb = wbOf((sh0) => { let sh = sh0; sh = setRaw(sh, 1, 2, "apple"); [1, 2, 3].forEach((n, i) => { sh = setRaw(sh, i, 0, String(n)); }); sh = setRaw(sh, 0, 3, "=SUM(A1:A3)"); return sh; });
    await reset(wb); await click(1, 2); await wait(200);
    const before = await cell(1, 2);
    await press("Control+k"); await wait(500);
    const open = await ev(() => { const p = document.querySelector('[data-testid="model-command-palette"]'); return p ? { rows: p.querySelectorAll("button[data-testid^='model-command-']").length } : null; });
    if (!open) return FAIL("Ctrl+K did not open the command palette");
    if (open.rows < 30) return FAIL(`the palette lists only ${open.rows} commands`);
    await pg().keyboard.type("bold", { delay: 15 }); await wait(250);
    const first = await ev(() => { const r = document.querySelector("button[data-testid^='model-command-']"); return r ? r.getAttribute("data-testid") : null; });
    if (first !== "model-command-bold") return FAIL(`typing "bold" put ${first} first`);
    await press("Enter"); await wait(450);
    const closed = await ev(() => !document.querySelector('[data-testid="model-command-palette"]'));
    const after = await cell(1, 2);
    if (!closed || before.bold !== "normal" || after.bold !== "bold") return FAIL(`Enter on Bold: palette closed ${closed}, bold ${before.bold} → ${after.bold}`);
    await click(1, 2); await press("Control+z"); await wait(300);
    const undone = await cell(1, 2);
    if (undone.bold !== "normal") return FAIL(`one Ctrl+Z left bold = ${undone.bold}`);
    await click(0, 3); await press("Control+k"); await wait(400);
    await pg().keyboard.type("trace prec", { delay: 15 }); await wait(250); await press("Enter"); await wait(500);
    const traced = await tools((t) => { const r = t.getState().rendered; return r && r.mode; });
    // a registry row the plugin has no key for: "Number Format: Currency (whole)" runs the tools' own number-format command, one undo step
    await click(0, 0); await press("Control+k"); await wait(400);
    await pg().keyboard.type("currency (whole)", { delay: 12 }); await wait(250); await press("Enter"); await wait(500);
    const nf = await inSheet((api) => api.getActiveWorkbook().getActiveSheet().getRange(0, 0).getNumberFormat());
    await click(0, 0); await press("Control+z"); await wait(300);
    const nf0 = await inSheet((api) => api.getActiveWorkbook().getActiveSheet().getRange(0, 0).getNumberFormat());
    if (nf !== "$#,##0" || nf0 === "$#,##0") return FAIL(`Number Format: Currency (whole) → ${JSON.stringify(nf)}, after one Ctrl+Z ${JSON.stringify(nf0)}`);
    await press("Control+k"); await wait(300); await press("Escape"); await wait(250);
    const esc = await ev(() => !document.querySelector('[data-testid="model-command-palette"]'));
    return traced === "precedents" && esc ? PASS(`Ctrl+K lists ${open.rows} commands; "bold" + Enter bolded C2 (one Ctrl+Z undid it); "trace prec" ran Trace Precedents; Esc closes`) : FAIL(`trace from palette: ${traced}; Esc closes: ${esc}`);
  });

  // ===========================================================================================================================
  check("tools-names", "Name Manager: define a name from the selection, a formula resolves it, rename rewrites the formula (one undo step), delete, and the saved workbook keeps the name per sheet", async () => {
    const wb = wbOf((sh0) => { let sh = sh0; [10, 20, 30].forEach((n, i) => { sh = setRaw(sh, i, 0, String(n)); }); return sh; });
    await reset(wb); await closePanels(); await click(0, 0); await pg().keyboard.down("Shift"); await click(2, 0); await pg().keyboard.up("Shift"); await wait(250);
    if (missing(await tools(() => true))) return FAIL("the tools are not installed");
    await tool("toggle-name-manager");
    const refers = await ev(() => { const p = document.querySelector('[data-testid="name-manager"]'); return p ? p.innerText.replace(/\s+/g, " ") : null; });
    if (!refers || !/A1:A3/.test(refers)) return FAIL(`the Name Manager did not read the selection (A1:A3): ${refers}`);
    await pg().locator('[data-testid="name-manager-new-input"]').fill("Lots"); await pg().locator('[data-testid="name-manager-create"]').click(); await wait(600);
    const names1 = await inSheet((api) => { const r = (api.getActiveWorkbook().save().resources || []).find((x) => x.name === "SHEET_DEFINED_NAME_PLUGIN"); return r ? Object.values(JSON.parse(r.data)).map((d) => `${d.name}=${d.formulaOrRefString}`) : []; });
    if (!names1.some((n) => /^Lots=.*\$A\$1:\$A\$3$/.test(n))) return FAIL(`Univer did not get the name Lots → A1:A3 (${JSON.stringify(names1)})`);
    await click(0, 2); await pg().keyboard.type("=SUM(Lots)", { delay: 8 }); await press("Enter"); await wait(500);
    const sum = await val1(0, 2);
    if (sum !== 60) return FAIL(`=SUM(Lots) = ${JSON.stringify(sum)}, want 60 — the formula did not resolve the new name`);
    // rename: the formula follows, and the whole rename is ONE undo step
    await pg().locator('[data-testid="name-manager-row"] button[title="Rename"]').first().click(); await wait(150);
    await pg().keyboard.press("Control+a"); await pg().keyboard.type("Parcels", { delay: 10 }); await pg().keyboard.press("Enter"); await wait(900);
    const renamed = await cell(0, 2);
    if (!/Parcels/.test(String(renamed.f)) || renamed.v !== 60) return FAIL(`after renaming Lots → Parcels the formula is ${JSON.stringify(renamed.f)} = ${renamed.v}`);
    await click(8, 4); await press("Control+z"); await wait(700);
    const undone = await cell(0, 2);
    const nm = await inSheet((api) => { const r = (api.getActiveWorkbook().save().resources || []).find((x) => x.name === "SHEET_DEFINED_NAME_PLUGIN"); return r ? Object.values(JSON.parse(r.data)).map((d) => d.name) : []; });
    if (!/Lots/.test(String(undone.f)) || !eq(nm, ["Lots"])) return FAIL(`one Ctrl+Z after the rename left formula ${JSON.stringify(undone.f)} and names ${JSON.stringify(nm)}`);
    await press("Control+y"); await wait(700);
    const sheet = await savedSheet();
    const saved = sheet && sheet.names && sheet.names.parcels;
    if (!saved || saved.r1 !== 1 || saved.r2 !== 3 || saved.c1 !== 1 || saved.c2 !== 1) return FAIL(`the saved workbook's names: ${JSON.stringify(sheet && sheet.names)} (want parcels → rows 1–3, column 1)`);
    await pg().locator('[data-testid="name-manager-row"] button[aria-label^="Delete"]').first().click(); await wait(700);
    const gone = await tools((t) => t.getState().sheet.names);
    const err = await val1(0, 2);
    return Object.keys(gone).length === 0 ? PASS(`Lots → A1:A3 in Univer; =SUM(Lots) = 60; rename rewrote the formula and undid in one Ctrl+Z; saved as sheet.names.parcels (rows 1–3, col 1); delete left a ${JSON.stringify(err)} in the formula`) : FAIL(`delete left names ${JSON.stringify(gone)}`);
  });

  check("tools-names-retarget", "Name Manager: 'Use selection' points an existing name at a new range and the formula's answer follows", async () => {
    const wb = wbOf((sh0) => { let sh = sh0; [10, 20, 30, 40].forEach((n, i) => { sh = setRaw(sh, i, 0, String(n)); }); return sh; });
    await reset(wb); await closePanels(); await click(0, 0); await pg().keyboard.down("Shift"); await click(1, 0); await pg().keyboard.up("Shift"); await wait(250);
    if (missing(await tools(() => true))) return FAIL("the tools are not installed");
    await tool("toggle-name-manager");
    await pg().locator('[data-testid="name-manager-new-input"]').fill("Pool"); await pg().locator('[data-testid="name-manager-create"]').click(); await wait(500);
    await click(0, 2); await pg().keyboard.type("=SUM(Pool)", { delay: 8 }); await press("Enter"); await wait(450);
    if ((await val1(0, 2)) !== 30) return FAIL(`=SUM(Pool) on A1:A2 = ${await val1(0, 2)}, want 30`);
    await click(0, 0); await pg().keyboard.down("Shift"); await click(3, 0); await pg().keyboard.up("Shift"); await wait(300);
    await pg().locator('[data-testid="name-manager-row"] button[title^="Point this name"]').first().click(); await wait(800);
    const sum = await val1(0, 2);
    return sum === 100 ? PASS("Pool moved from A1:A2 to A1:A4 and =SUM(Pool) went 30 → 100") : FAIL(`=SUM(Pool) after retarget = ${sum}, want 100`);
  });

  // ===========================================================================================================================
  check("tools-color", "Input / formula colours: a typed input is blue, a formula keeps the text colour, a colour you set wins, and the toggle turns it off", async () => {
    const wb = wbOf((sh0) => { let sh = sh0; sh = setRaw(sh, 0, 0, "1234567"); sh = setRaw(sh, 1, 0, "=A1+1"); sh = setRaw(sh, 2, 0, "7654321"); return sh; });
    await reset(wb);
    await tools((t) => { if (!t.getState().autoColor) t.run("planyr.tools.toggle-autocolor"); return true; });
    await park(); await wait(700);
    const inkOf = async (r) => { const p = await pt(r, 0); return countPx({ x: p.left + 2, y: p.top + 2, width: Math.max(4, p.w - 4), height: Math.max(4, p.h - 4) }, INPUT_BLUE); };
    const input = await inkOf(0), formula = await inkOf(1);
    if (input < 12) return FAIL(`a typed input shows ${input} blue pixels (the colour convention is not drawn)`);
    if (formula > 2) return FAIL(`a formula shows ${formula} blue pixels (it must keep the text colour)`);
    // a manual font colour always wins
    await click(2, 0); await pg().evaluate(() => { const api = window.__planyrUniverRead.api(); api.getActiveWorkbook().getActiveSheet().getRange(2, 0).setFontColor("#FF0000"); });
    await park(); await wait(500);
    const manual = await inkOf(2);
    await pg().evaluate(() => window.__planyrUniverRead.tools().run("planyr.tools.toggle-autocolor")); await park(); await wait(600);
    const off = await inkOf(0);
    await pg().evaluate(() => window.__planyrUniverRead.tools().run("planyr.tools.toggle-autocolor")); await park(); await wait(600);
    const on = await inkOf(0);
    // the colour is a DRAWING choice: nothing about it reaches the saved workbook
    const sheet = await savedSheet();
    const unchanged = sheet && Object.values(sheet.styles || {}).every((s) => !/^#(1D4ED8|15803D)$/i.test(String(s.color || "")));
    return manual < 3 && off < 3 && on >= 12 && unchanged
      ? PASS(`input blue ${input} px, formula ${formula} px; a red font colour won (${manual} blue px); toggled off ${off} px, back on ${on} px; no colour written into the saved cells`)
      : FAIL(`manual-colour cell ${manual} blue px (want <3); toggled off ${off} (want <3); back on ${on} (want ≥12); saved styles untouched ${unchanged}`);
  });
}
