/* The Excel-keys section of the Univer parity checklist (NEW-1, 2026-10-30; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Every key the free Univer build lacks and the Planyr plugin (src/workspaces/model/lib/univerExcelKeys/) adds is driven with REAL
 * keystrokes against the REAL <UniverSheet>, and its effect is read back through Univer's facade (the grid is a canvas). Each check
 * is STRICT — it FAILS (never "not in the free build") when the key does nothing — so it is red on a build without the plugin, and
 * each action is also required to be ONE undo step (a single Ctrl+Z restores the sheet exactly).
 *
 * Registered from verify-univer-parity.mjs, which passes in its own plumbing (`h`), so the same checks run against the sandbox host
 * and, through `bind()`, against the real signed-in app (verify-univer-live.mjs). */
export function registerExcelKeyChecks(h) {
  const { check, PASS, FAIL, reset, click, press, sel, cell, val1, inSheet, ev, wait, hiddenState, heldClick, eq } = h;
  const pg = () => h.page();
  const key = (k, opts) => pg().keyboard.press(k, opts);

  /** Everything on the active sheet that an edit can change — values, RESOLVED styles, sizes, merges, freeze, hidden, number formats. */
  const snap = () => inSheet((api, ws) => {
    const s = api.getActiveWorkbook().save(); const sd = s.sheets[ws.getSheetId()];
    const cells = {};
    for (const r of Object.keys(sd.cellData || {})) for (const c of Object.keys(sd.cellData[r])) {
      const x = sd.cellData[r][c]; if (!x || (x.v == null && x.f == null && x.s == null && x.p == null)) continue;
      const st = typeof x.s === "string" ? s.styles[x.s] : x.s;
      cells[`${r}:${c}`] = { v: x.v ?? null, f: x.f ?? null, t: x.t ?? null, s: st && Object.keys(st).length ? st : null };
    }
    const res = (s.resources || []).filter((q) => /NUMFMT|MERGE|FILTER|DEFINED_NAME/i.test(q.name)).map((q) => [q.name, q.data]);
    // `hd: 0`, an empty entry and `ah` (Univer's cached auto-height) all mean "nothing the person set" — an undo leaves them behind, so they are not a difference
    const lean = (m) => { const o = {}; for (const k of Object.keys(m || {})) { const e = { ...m[k] }; delete e.ah; if (!e.hd) delete e.hd; for (const q of Object.keys(e)) if (e[q] == null) delete e[q]; if (Object.keys(e).length) o[k] = e; } return o; };
    return JSON.stringify({ cells, rows: lean(sd.rowData), cols: lean(sd.columnData), merge: sd.mergeData, freeze: sd.freeze, rc: sd.rowCount, cc: sd.columnCount, res });
  });
  /** One Ctrl+Z must put the sheet back EXACTLY as `before`. */
  let lastDiff = "";
  const undoOnce = async (before) => {
    await press("Control+z"); await wait(250); const after = await snap();
    if (after === before) { lastDiff = ""; return true; }
    let i = 0; while (i < before.length && before[i] === after[i]) i++;
    lastDiff = `first difference at char ${i}: before …${before.slice(Math.max(0, i - 40), i + 80)}… after …${after.slice(Math.max(0, i - 40), i + 80)}…`;
    console.log("   UNDO-DIFF", lastDiff);
    return false;
  };
  const block = async (r, c, rows, cols) => {
    await click(r, c);
    for (let i = 1; i < rows; i++) await press("Shift+ArrowDown");
    for (let i = 1; i < cols; i++) await press("Shift+ArrowRight");
  };
  /** the cell exactly as saved: its stored value and number type, not the text a person sees */
  const rawCell = (r, c) => inSheet((api, ws, [rr, cc]) => { const x = api.getActiveWorkbook().save().sheets[ws.getSheetId()].cellData[rr]; const q = x && x[cc]; return q ? { v: q.v ?? null, t: q.t ?? null } : { v: null, t: null }; }, [r, c]);
  const maxes = () => inSheet((api, ws) => ({ rows: ws.getMaxRows(), cols: ws.getMaxColumns() }));
  const styleOf = (r, c) => inSheet((api, ws, [rr, cc]) => {
    const s = api.getActiveWorkbook().save(); const sd = s.sheets[ws.getSheetId()];
    const x = sd.cellData && sd.cellData[rr] && sd.cellData[rr][cc]; const st = x && x.s && (typeof x.s === "string" ? s.styles[x.s] : x.s);
    return st || {};
  }, [r, c]);
  const edges = async (r, c) => { const st = await styleOf(r, c); return Object.keys(st.bd || {}).filter((k) => st.bd[k]).sort().join(""); };
  const altTap = async () => { await pg().keyboard.down("Alt"); await pg().keyboard.up("Alt"); await wait(160); };
  const alt = async (letters) => { await altTap(); for (const ch of letters) { await key(ch); await wait(140); } await wait(250); };
  const tipPanel = () => ev(() => { const p = document.querySelector('[data-testid="excel-keys-keytip-panel"]'); return p && p.style.display !== "none" ? p.innerText.replace(/\s+/g, " ") : null; });
  const notices = () => ev(() => (window.__notices || []).slice());
  /** put values / formulas straight into the sheet (setup only — the key under test is always a real keystroke); the same on the sandbox and the live page */
  const put = (cells) => inSheet((api, ws, list) => { for (const [r, c, v] of list) ws.getRange(r, c).setValue(v); }, cells);
  const dlg = (testid) => ev((t) => !!document.querySelector(`[data-testid="${t}"]`), testid);

  // ---- format keys --------------------------------------------------------------------------------------------------------
  check("key-strike", "Ctrl+5 strikethrough (one undo step)", async () => {
    await reset(); await click(1, 2); const before = await snap();
    await press("Control+5"); const on = (await cell(1, 2)).line;
    if (!/line-through/.test(on)) return FAIL(`no strikethrough after Ctrl+5 (style line is "${on}")`);
    if (!(await undoOnce(before))) return FAIL("Ctrl+5 was not one undo step");
    await press("Control+y"); await wait(200); await press("Control+5"); const off = (await cell(1, 2)).line;
    return !/line-through/.test(off) ? PASS("strikethrough on; one Ctrl+Z removed it; a second Ctrl+5 toggled it off") : FAIL(`second Ctrl+5 left "${off}"`);
  });
  check("key-format-cells", "Ctrl+1 opens the number-format dialog", async () => {
    await reset(); await click(0, 0); await press("Control+1"); await wait(400);
    const open = await ev(() => /Number format/i.test(document.body.innerText) && !!([...document.querySelectorAll("button")].find((b) => /^confirm$/i.test(b.innerText.trim()))));
    await ev(() => { const b = [...document.querySelectorAll("button")].find((x) => /^cancel$/i.test(x.innerText.trim())); if (b) b.click(); }); await wait(300);
    const closed = await ev(() => ![...document.querySelectorAll("button")].find((b) => /^confirm$/i.test(b.innerText.trim())));
    return open && closed ? PASS("the number-format panel (Format types, Confirm / Cancel) opened on Ctrl+1 and closed on Cancel") : FAIL(`opened=${open} closed-after-cancel=${closed}`);
  });
  const NUMFMT = [
    ["key-currency", "Ctrl+Shift+$ currency", "Control+Shift+$", "$#,##0.00", "$1.00"],
    ["key-percent", "Ctrl+Shift+% percent", "Control+Shift+%", "0%", "100%"],
    ["key-number", "Ctrl+Shift+! number with commas", "Control+Shift+!", "#,##0.00", "1.00"],
    ["key-date", "Ctrl+Shift+# date", "Control+Shift+#", "d-mmm-yy", "1-Jan-00"],
  ];
  for (const [id, label, k, pattern, shown] of NUMFMT) {
    check(id, `${label} (a whole selection, one undo step)`, async () => {
      await reset(); await block(0, 0, 2, 1); const before = await snap();            // A1:A2 = 1, 2
      await press(k);
      const nf = [(await cell(0, 0)).nf, (await cell(1, 0)).nf, (await cell(2, 0)).nf];
      const disp = await inSheet((api, ws) => ws.getRange(0, 0).getDisplayValue());
      if (!(nf[0] === pattern && nf[1] === pattern && !nf[2])) return FAIL(`formats after ${k}: ${JSON.stringify(nf)} (want ${pattern} on A1:A2 only)`);
      if (disp !== shown) return FAIL(`A1 shows "${disp}", want "${shown}"`);
      return (await undoOnce(before)) ? PASS(`A1:A2 ${pattern} (A1 shows ${disp}), A3 untouched; one Ctrl+Z restored the sheet`) : FAIL("one Ctrl+Z did not restore the sheet");
    });
  }
  check("key-general", "Ctrl+Shift+~ back to General", async () => {
    await reset(); await click(0, 0); await press("Control+Shift+$"); const was = (await cell(0, 0)).nf;
    const before = await snap(); await press("Control+Shift+~"); const nf = (await cell(0, 0)).nf;
    const disp = await inSheet((api, ws) => ws.getRange(0, 0).getDisplayValue());
    if (was !== "$#,##0.00") return FAIL(`setup: currency did not apply (${was})`);
    if (!(!nf || /general/i.test(nf)) || disp !== "1") return FAIL(`after Ctrl+Shift+~ format is ${JSON.stringify(nf)} and A1 shows "${disp}"`);
    return (await undoOnce(before)) ? PASS(`General again (A1 shows ${disp}); one undo step`) : FAIL("one Ctrl+Z did not restore the sheet");
  });
  check("key-border", "Ctrl+Shift+& outline border / Ctrl+Shift+_ remove borders (one undo step each)", async () => {
    await reset(); await block(0, 0, 2, 2);
    const b0 = await snap(); await press("Control+Shift+&");
    const e = [await edges(0, 0), await edges(0, 1), await edges(1, 0), await edges(1, 1)];
    // an OUTLINE: A1 owns top+left only, B2 bottom+right only, nothing inside
    const outline = e[0] === "lt" && e[1] === "rt" && e[2] === "bl" && e[3] === "br".split("").sort().join("");
    const okOutline = e[0] === "lt" && e[3] === "br" && !/[rb]/.test(e[0]) && !/[lt]/.test(e[3]);
    if (!okOutline) return FAIL(`outline edges A1 "${e[0]}" B1 "${e[1]}" A2 "${e[2]}" B2 "${e[3]}" (want A1 = lt, B2 = br)`);
    if (!(await undoOnce(b0))) return FAIL("one Ctrl+Z did not remove the whole outline");
    await press("Control+y"); await wait(200); const b1 = await snap();
    await press("Control+Shift+_"); const gone = [await edges(0, 0), await edges(1, 1)];
    if (gone.some((x) => x)) return FAIL(`borders left after Ctrl+Shift+_: ${JSON.stringify(gone)}`);
    return (await undoOnce(b1)) ? PASS(`outline A1 "${e[0]}" … B2 "${e[3]}"; Ctrl+Shift+_ cleared them; each was one undo step`) : FAIL("one Ctrl+Z did not restore the borders");
    void outline;
  });

  // ---- selection ----------------------------------------------------------------------------------------------------------------
  check("key-row-col", "Shift+Space selects the whole row; Ctrl+Space the whole column (of every selected cell)", async () => {
    await reset(); const { rows, cols } = await maxes();
    await click(2, 2); await press("Shift+Space"); const row = (await sel())[0];
    await click(9, 9); await click(2, 2); await press("Control+Space"); const col = (await sel())[0];
    await block(1, 1, 2, 2); await press("Shift+Space"); const rows2 = (await sel())[0];
    await block(1, 1, 2, 2); await press("Control+Space"); const cols2 = (await sel())[0];
    const rOk = row && row.r1 === 2 && row.r2 === 2 && row.c1 === 0 && row.c2 === cols - 1;
    const cOk = col && col.c1 === 2 && col.c2 === 2 && col.r1 === 0 && col.r2 === rows - 1;
    const r2Ok = rows2 && rows2.r1 === 1 && rows2.r2 === 2 && rows2.c1 === 0 && rows2.c2 === cols - 1;
    const c2Ok = cols2 && cols2.c1 === 1 && cols2.c2 === 2 && cols2.r1 === 0 && cols2.r2 === rows - 1;
    return rOk && cOk && r2Ok && c2Ok ? PASS("one cell → whole row 3 / whole column C; B2:C3 → rows 2-3 whole / columns B-C whole") : FAIL(`row=${row && row.a1} col=${col && col.a1} block-rows=${rows2 && rows2.a1} block-cols=${cols2 && cols2.a1}`);
  });

  // ---- insert / delete ---------------------------------------------------------------------------------------------------------
  check("key-insert-delete", "Ctrl+Shift+= inserts, Ctrl+- deletes: whole lines at once, cells ask Excel's shift prompt", async () => {
    const out = [];
    // (a) a whole row selected: no prompt, a row appears above, one undo step; Ctrl+- removes it again
    await reset(); await click(2, 0); await press("Shift+Space"); let before = await snap();
    await press("Control+Shift+="); await wait(250);
    if (await dlg("excel-keys-choice-dialog")) return FAIL("a whole row was selected but Ctrl+Shift+= still asked what to insert");
    const moved = [await val1(2, 0), await val1(3, 0)];
    if (!(moved[0] == null && moved[1] === 3)) return FAIL(`whole-row insert: A3 is ${JSON.stringify(moved[0])}, A4 is ${JSON.stringify(moved[1])} (want empty, 3)`);
    if (!(await undoOnce(before))) return FAIL("whole-row insert was not one undo step");
    out.push("whole row inserted without a prompt, one undo step");
    await click(2, 0); await press("Shift+Space"); before = await snap();
    await press("Control+-"); await wait(250);
    const del = [await val1(2, 0)];
    if (del[0] !== 4) return FAIL(`whole-row delete: A3 is ${JSON.stringify(del[0])}, want 4`);
    if (!(await undoOnce(before))) return FAIL("whole-row delete was not one undo step");
    out.push("whole row deleted");
    // the numpad's + and - are the same chords
    await reset(); await click(2, 0); await press("Shift+Space"); before = await snap();
    await press("Control+NumpadAdd"); await wait(250);
    if (!((await val1(2, 0)) == null && (await val1(3, 0)) === 3)) return FAIL("Ctrl+numpad + did not insert the selected row");
    await press("Control+NumpadSubtract"); await wait(250);
    if ((await snap()) !== before) return FAIL("Ctrl+numpad - did not delete the row Ctrl+numpad + inserted");
    out.push("numpad + / - work");
    // (b) a whole column
    await reset(); await click(0, 1); await press("Control+Space"); before = await snap();
    await press("Control+Shift+="); await wait(250);
    const col = [await val1(0, 1), await val1(0, 2)];
    if (!(col[0] == null && col[1] === "alpha")) return FAIL(`whole-column insert: B1 ${JSON.stringify(col[0])}, C1 ${JSON.stringify(col[1])} (want empty, "alpha")`);
    if (!(await undoOnce(before))) return FAIL("whole-column insert was not one undo step");
    out.push("whole column inserted");
    // (c) cells: the prompt appears; Enter takes the default (shift right); undo is one step
    await reset(); await click(1, 0); before = await snap();
    await press("Control+Shift+="); await wait(250);
    if (!(await dlg("excel-keys-choice-dialog"))) return FAIL("Ctrl+Shift+= on a single cell opened no Insert prompt");
    await press("Enter"); await wait(300);
    const sh = [await val1(1, 0), await val1(1, 1)];
    if (!(sh[0] == null && sh[1] === 2)) return FAIL(`shift-right insert: A2 ${JSON.stringify(sh[0])}, B2 ${JSON.stringify(sh[1])} (want empty, 2 — the old A2 moved right)`);
    if (!(await undoOnce(before))) return FAIL("shift-right insert was not one undo step");
    out.push("cell insert asked, Enter = shift right, one undo");
    // (d) the D key picks "Shift cells down"; Escape changes nothing
    await reset(); await click(1, 0); before = await snap();
    await press("Control+Shift+="); await wait(250); await press("d"); await press("Enter"); await wait(300);
    const dn = [await val1(1, 0), await val1(2, 0)];
    if (!(dn[0] == null && dn[1] === 2)) return FAIL(`shift-down insert: A2 ${JSON.stringify(dn[0])}, A3 ${JSON.stringify(dn[1])} (want empty, 2)`);
    await press("Control+z"); await wait(250);
    await press("Control+Shift+="); await wait(250); await press("Escape"); await wait(250);
    if ((await snap()) !== before || (await dlg("excel-keys-choice-dialog"))) return FAIL("Escape on the Insert prompt changed the sheet or left the prompt open");
    out.push("D = shift down, Esc cancels");
    // (e) Delete: the prompt, Enter = shift LEFT, the cells to the right move over
    await reset(); await click(1, 0); before = await snap();
    await press("Control+-"); await wait(250);
    if (!(await dlg("excel-keys-choice-dialog"))) return FAIL("Ctrl+- on a single cell opened no Delete prompt");
    await press("Enter"); await wait(300);
    const dl = [await val1(1, 0)];
    if (dl[0] !== "beta") return FAIL(`shift-left delete: A2 is ${JSON.stringify(dl[0])}, want "beta" (B2 moved over)`);
    if (!(await undoOnce(before))) return FAIL("shift-left delete was not one undo step");
    out.push("cell delete asked, Enter = shift left");
    // (f) two separate ranges: refused out loud, nothing changes
    await reset(); await click(0, 0); await heldClick(3, 3, "Control"); before = await snap();
    await press("Control+Shift+="); await wait(250);
    const n = await notices();
    if ((await snap()) !== before || !n.some((t) => /multiple selections/i.test(t))) return FAIL(`several ranges: changed=${(await snap()) !== before} notices=${JSON.stringify(n)}`);
    out.push("two ranges refused with Excel's wording");
    return PASS(out.join("; "));
  });

  // ---- hide / unhide -----------------------------------------------------------------------------------------------------------
  check("key-hide", "Ctrl+9 / Ctrl+Shift+9 hide / unhide rows, Ctrl+0 / Ctrl+Shift+0 columns (one undo step each)", async () => {
    await reset(); await click(2, 2); let before = await snap();
    await press("Control+9"); const r = (await hiddenState()).rows;
    if (!r.includes(2)) return FAIL(`Ctrl+9 did not hide row 3 (hidden rows ${JSON.stringify(r)})`);
    if (!(await undoOnce(before))) return FAIL("Ctrl+9 was not one undo step");
    await press("Control+y"); await wait(200);
    await block(0, 0, 5, 1); await press("Control+Shift+("); await wait(250);       // the selection spans the hidden row 3
    const un = (await hiddenState()).rows;
    if (un.includes(2)) return FAIL(`Ctrl+Shift+9 left row 3 hidden (${JSON.stringify(un)})`);
    await reset(); await click(2, 2); before = await snap();
    await press("Control+0"); const c = (await hiddenState()).cols;
    if (!c.includes(2)) return FAIL(`Ctrl+0 did not hide column C (hidden columns ${JSON.stringify(c)})`);
    if (!(await undoOnce(before))) return FAIL("Ctrl+0 was not one undo step");
    await press("Control+y"); await wait(200);
    await block(0, 0, 1, 5); await press("Control+Shift+)"); await wait(250);
    const uc = (await hiddenState()).cols;
    return uc.includes(2) ? FAIL(`Ctrl+Shift+0 left column C hidden (${JSON.stringify(uc)})`) : PASS("row 3 and column C hid and unhid; hiding was one undo step each");
  });

  // ---- today / now / copy above -----------------------------------------------------------------------------------------------
  check("key-today", "Ctrl+; today's date, Ctrl+Shift+; the time — real date / time values (one undo step)", async () => {
    await reset(); await click(7, 3); const before = await snap();
    await press("Control+;");
    const rawD = await rawCell(7, 3);
    const info = await inSheet((api, ws) => { const g = ws.getRange(7, 3); return { v: null, nf: g.getNumberFormat(), shown: g.getDisplayValue(), y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: new Date().getDate() }; });
    const serial = Math.round((Date.UTC(info.y, info.m - 1, info.d) - Date.UTC(1899, 11, 30)) / 86400000);
    info.v = rawD.v;
    if (info.v !== serial) return FAIL(`Ctrl+; stored ${JSON.stringify(info.v)}, want today's date serial ${serial}`);
    if (!new RegExp(`^${info.m}/${info.d}/${info.y}$`).test(info.shown)) return FAIL(`Ctrl+; shows "${info.shown}", want ${info.m}/${info.d}/${info.y}`);
    if (!(await undoOnce(before))) return FAIL("Ctrl+; was not one undo step");
    await press("Control+y"); await wait(200);
    await click(8, 3); const b2 = await snap();
    await press("Control+Shift+:");
    const rawT = await rawCell(8, 3);
    const t = await inSheet((api, ws) => { const g = ws.getRange(8, 3); return { v: null, shown: g.getDisplayValue(), min: new Date().getHours() * 60 + new Date().getMinutes() }; });
    t.v = rawT.v; const mins = Math.round(t.v * 1440);
    if (!(typeof t.v === "number" && t.v > 0 && t.v < 1 && Math.abs(mins - t.min) <= 1) || !/^\d{1,2}:\d\d (AM|PM)$/.test(t.shown)) return FAIL(`Ctrl+Shift+; stored ${JSON.stringify(t.v)} shown "${t.shown}" (now is minute ${t.min})`);
    return (await undoOnce(b2)) ? PASS(`date ${info.shown} (serial ${serial}); time ${t.shown}; each one undo step`) : FAIL("Ctrl+Shift+; was not one undo step");
  });
  check("key-copy-above", "Ctrl+' copies the formula from the cell above; Ctrl+Shift+\" copies its value (one undo step)", async () => {
    await reset(); await put([[0, 0, 7], [1, 0, 5]]); await wait(300);            // B3 is the seed's =A1+A2, now 12; B4 holds a constant
    await click(3, 1); let before = await snap();
    await press("Control+'");
    const f = await inSheet((api, ws) => ws.getRange(3, 1).getFormula());
    if (f !== "=A1+A2") return FAIL(`Ctrl+' left B4's formula as ${JSON.stringify(f)}, want =A1+A2 (copied as-is, references not shifted)`);
    if (!(await undoOnce(before))) return FAIL("Ctrl+' was not one undo step");
    await click(3, 1); before = await snap();
    await press("Control+Shift+\""); const v = await inSheet((api, ws) => ({ v: ws.getRange(3, 1).getValue(), f: ws.getRange(3, 1).getFormula() }));
    if (v.v !== 12 || v.f) return FAIL(`Ctrl+Shift+" put ${JSON.stringify(v)} in B4, want the value 12 and no formula`);
    if (!(await undoOnce(before))) return FAIL("Ctrl+Shift+\" was not one undo step");
    await click(0, 0); const b3 = await snap(); await press("Control+'"); await wait(200);
    const n = await notices();
    return (await snap()) === b3 && n.some((x) => /no cell above/i.test(x)) ? PASS("formula copied as written; value copied as a number; the top row says there is nothing above") : FAIL(`top row: notices ${JSON.stringify(n)}`);
  });

  // ---- the editor keeps its keys -----------------------------------------------------------------------------------------------
  check("excel-keys-editor-guard", "None of these keys fire while a cell is open for editing (Excel's editor owns them)", async () => {
    await reset(); await click(1, 2); await press("F2"); await wait(200);
    const before = await snap();
    for (const k of ["Control+Shift+$", "Control+Shift+%", "Control+9", "Control+0", "Control+Shift+&", "Control+Shift+=", "Control+-"]) { await key(k); await wait(80); }
    const during = (await snap()) === before && !(await dlg("excel-keys-choice-dialog"));
    await altTap(); const tips = await tipPanel();
    await press("Escape"); await wait(200);
    if (!during) return FAIL("a chord changed the sheet (or opened a prompt) while the cell editor was open");
    if (tips) return FAIL(`the Alt key-tips opened inside the cell editor ("${tips}")`);
    // CONTROL ARM: the same keys DO act the moment the editor is closed
    await click(1, 2); await press("Control+9"); const hid = (await hiddenState()).rows.includes(1);
    return hid ? PASS("7 chords and Alt did nothing in the editor; Ctrl+9 hid the row once it was closed (the keys are live)") : FAIL("known-good arm: Ctrl+9 did not hide a row outside the editor, so the guard result is void");
  });
  check("excel-keys-namebox-guard", "…or while the name box has focus", async () => {
    await reset(); await click(2, 2);
    const focused = await ev(() => { const i = document.querySelector('input[class*="name" i], [class*="formula-bar" i] input, [data-u-comp="formula-bar"] input'); if (!i) return false; i.focus(); return document.activeElement === i; });
    if (!focused) return FAIL("VOID: could not focus the name box input to test the guard");
    const before = await snap(); await key("Control+9"); await key("Control+Shift+$"); await wait(250);
    const same = (await snap()) === before;
    await ev(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    if (!same) return FAIL("a chord changed the sheet while the name box had focus");
    // CONTROL ARM: the same key acts the moment the grid has focus again (otherwise "did nothing" proves nothing)
    await wait(300); await click(5, 4); await wait(200); await click(2, 2); await wait(200); await press("Control+9");
    return (await hiddenState()).rows.includes(2) ? PASS("Ctrl+9 and Ctrl+Shift+$ did nothing while the name box had focus; Ctrl+9 hid the row once the grid had focus again") : FAIL("known-good arm: Ctrl+9 did not hide a row with the grid focused, so the guard result is void");
  });

  // ---- Alt key-tips ---------------------------------------------------------------------------------------------------------------
  check("alt-keytips", "Alt shows the key-tip strip; Esc backs out one level; a bare Alt keyup is cancelled so the browser menu never takes focus", async () => {
    await reset(); await click(0, 0);
    // a CAPTURE listener on window, added after the plugin's: it runs after the plugin's own (which stops propagation to the document)
    await ev(() => { window.__altUp = []; window.addEventListener("keyup", (e) => { if (e.key === "Alt") window.__altUp.push(e.defaultPrevented); }, true); });
    await altTap(); const top = await tipPanel();
    const badgeTop = await ev(() => [...document.querySelectorAll('[data-testid="excel-keys-keytip-badge"]')].map((b) => b.textContent));
    const prevented = await ev(() => window.__altUp.slice());
    await key("h"); await wait(150); const home = await tipPanel();
    const badgeHome = await ev(() => [...document.querySelectorAll('[data-testid="excel-keys-keytip-badge"]')].map((b) => b.textContent));
    await key("Escape"); await wait(150); const back = await tipPanel();
    await key("Escape"); await wait(150); const gone = await tipPanel();
    if (!top || !/H/.test(top)) return FAIL(`Alt alone showed no key-tip strip (${JSON.stringify(top)})`);
    if (prevented[0] !== true) return FAIL(`the Alt keyup was NOT cancelled (defaultPrevented=${JSON.stringify(prevented)}) — Windows browsers would focus their menu bar`);
    if (!(home && /Alt › H/.test(home) && /Autofit|Borders|Format/i.test(home))) return FAIL(`Alt H showed ${JSON.stringify(home)}`);
    if (!(back && !/Alt › H/.test(back))) return FAIL(`first Esc did not back out one level (${JSON.stringify(back)})`);
    if (gone) return FAIL(`second Esc did not close the strip (${JSON.stringify(gone)})`);
    if (!(badgeTop.includes("H1") && badgeTop.includes("H2")) || !(badgeHome.includes("1") && badgeHome.includes("2") && badgeHome.includes("3"))) return FAIL(`key-tip badges on the toolbar: after Alt ${JSON.stringify(badgeTop)}, after Alt H ${JSON.stringify(badgeHome)} (want H1 H2 … then 1 2 3 …)`);
    if (await ev(() => document.querySelectorAll('[data-testid="excel-keys-keytip-badge"]').length)) return FAIL("badges stayed on the toolbar after the sequence closed");
    // CONTROL ARM: Alt+Enter is a chord, not "Alt alone" — it must NOT open the strip
    await key("Alt+Enter"); await wait(150); const chord = await tipPanel(); await key("Escape"); await wait(100);
    return chord ? FAIL("Alt+Enter opened the key-tip strip") : PASS("Alt → strip (H = Home …); Alt keyup defaultPrevented; Esc, Esc backs out; Alt+Enter is still a chord");
  });
  const ALT = [];
  const alt1 = (id, label, letters, run) => ALT.push({ id, label, letters, run });
  alt1("H O I", "autofit column width", "HOI", async () => {
    await reset(); await inSheet((api, ws) => { ws.setColumnWidth(1, 400); }); await click(0, 1); const w0 = await inSheet((a, ws) => ws.getColumnWidth(1)); const before = await snap();
    await alt("HOI"); const w1 = await inSheet((a, ws) => ws.getColumnWidth(1));
    return w1 < w0 - 20 && (await undoOnce(before)) ? PASS(`column B ${Math.round(w0)} → ${Math.round(w1)}; one undo`) : FAIL(`width ${w0} → ${w1}`);
  });
  alt1("H O A", "autofit row height", "HOA", async () => {
    await reset(); await inSheet((api, ws) => { ws.setRowHeight(1, 120); }); await click(1, 0); const h0 = await inSheet((a, ws) => ws.getRowHeight(1)); const before = await snap();
    await alt("HOA"); const h1 = await inSheet((a, ws) => ws.getRowHeight(1));
    return h1 < h0 - 20 && (await undoOnce(before)) ? PASS(`row 2 ${Math.round(h0)} → ${Math.round(h1)}; one undo`) : FAIL(`height ${h0} → ${h1}`);
  });
  alt1("H O W", "column width…", "HOW", async () => {
    await reset(); await click(0, 1); const before = await snap();
    await alt("HOW"); if (!(await dlg("excel-keys-number-dialog"))) return FAIL("no width prompt");
    await pg().keyboard.press("Control+a"); await pg().keyboard.type("222"); await press("Enter"); await wait(300);
    const w = await inSheet((a, ws) => ws.getColumnWidth(1));
    return w === 222 && (await undoOnce(before)) ? PASS("typed 222 → column B is 222 wide; one undo") : FAIL(`width ${w}`);
  });
  alt1("H O H", "row height…", "HOH", async () => {
    await reset(); await click(1, 0); const before = await snap();
    await alt("HOH"); if (!(await dlg("excel-keys-number-dialog"))) return FAIL("no height prompt");
    await pg().keyboard.press("Control+a"); await pg().keyboard.type("55"); await press("Enter"); await wait(300);
    const hh = await inSheet((a, ws) => ws.getRowHeight(1));
    return hh === 55 && (await undoOnce(before)) ? PASS("typed 55 → row 2 is 55 high; one undo") : FAIL(`height ${hh}`);
  });
  alt1("H B A/N/O/T", "borders: all · none · outline · thick box", "HBA", async () => {
    await reset(); await block(0, 0, 2, 2); const b0 = await snap();
    await alt("HBA"); const all = [await edges(0, 0), await edges(1, 1)];
    if (!(all[0].length === 4 && all[1].length === 4)) return FAIL(`H B A: A1 "${all[0]}", B2 "${all[1]}" (want all four edges on each)`);
    if (!(await undoOnce(b0))) return FAIL("H B A was not one undo step");
    await press("Control+y"); await wait(200); await alt("HBN"); const none = [await edges(0, 0), await edges(1, 1)];
    if (none.some((x) => x)) return FAIL(`H B N left ${JSON.stringify(none)}`);
    await alt("HBO"); const o = [await edges(0, 0), await edges(1, 1)];
    if (!(o[0] === "lt" && o[1] === "br")) return FAIL(`H B O: A1 "${o[0]}" B2 "${o[1]}"`);
    await alt("HBN"); await alt("HBT"); const th = await styleOf(0, 0);
    return th.bd && th.bd.t && th.bd.t.s !== 1 && th.bd.t.s !== undefined ? PASS("all / none / outline / thick box each applied") : FAIL(`H B T style ${JSON.stringify(th.bd)}`);
  });
  alt1("H H / H F C", "fill colour and font colour open the palette", "HH", async () => {
    await reset(); await click(0, 0);
    const open = (cmd) => ev((c) => { const t = document.querySelector(`[data-u-command="${c}"] button[aria-haspopup="menu"]`); return !!t && t.getAttribute("aria-expanded") === "true"; }, cmd);
    await alt("HH"); await wait(250); const fill = await open("sheet.command.set-background-color"); await key("Escape"); await wait(250);
    await click(0, 0); await alt("HFC"); await wait(250); const font = await open("sheet.command.set-range-text-color"); await key("Escape"); await wait(250);
    const still = await open("sheet.command.set-range-text-color");
    return fill && font && !still ? PASS("H H opened the toolbar's fill-colour palette, H F C the font-colour palette; Esc closed it") : FAIL(`fill palette open=${fill}, font palette open=${font}, still open after Esc=${still}`);
  });
  alt1("H A L/C/R · T/M/B", "alignment", "HAL", async () => {
    await reset(); await click(1, 2); const before = await snap(); const out = [];
    for (const [letters, want, prop] of [["HAL", 1, "ht"], ["HAC", 2, "ht"], ["HAR", 3, "ht"], ["HAT", 1, "vt"], ["HAM", 2, "vt"], ["HAB", 3, "vt"]]) {
      await alt(letters); const st = await styleOf(1, 2); out.push(`${letters}=${st[prop]}`);
      if (st[prop] !== want) return FAIL(`${letters}: ${prop} is ${st[prop]}, want ${want}`);
    }
    await ev(() => 0);
    return PASS(out.join(" "));
  });
  alt1("H W", "wrap text toggles", "HW", async () => {
    await reset(); await click(1, 2); const before = await snap();
    await alt("HW"); const on = (await cell(1, 2)).wrap; const mid = await snap();
    await alt("HW"); const off = (await cell(1, 2)).wrap;
    return on && !off && (await undoOnce(mid)) ? PASS("wrap on, then off; one undo step") : FAIL(`wrap ${on} then ${off}`);
  });
  alt1("H M M/U/C", "merge · unmerge · merge & centre", "HMM", async () => {
    await reset(); await block(4, 3, 1, 2); const b0 = await snap();
    await alt("HMM"); const m1 = await inSheet((a, ws) => ws.getRange(4, 3).isPartOfMerge());
    if (!m1) return FAIL("H M M did not merge D5:E5");
    if (!(await undoOnce(b0))) return FAIL("H M M was not one undo step");
    await press("Control+y"); await wait(200); await alt("HMU"); const m2 = await inSheet((a, ws) => ws.getRange(4, 3).isPartOfMerge());
    if (m2) return FAIL("H M U left D5:E5 merged");
    await block(4, 3, 1, 2); const b1 = await snap(); await alt("HMC");
    const m3 = await inSheet((a, ws) => ws.getRange(4, 3).isPartOfMerge()); const ht = (await styleOf(4, 3)).ht;
    return m3 && ht === 2 && (await undoOnce(b1)) ? PASS("merged, unmerged, merged & centred (one undo step)") : FAIL(`merge&centre merged=${m3} ht=${ht}`);
  });
  alt1("H I R/C · H D R/C", "insert / delete row · column", "HIR", async () => {
    await reset(); await click(2, 1); let before = await snap();
    await alt("HIR"); if (!((await val1(2, 0)) == null && (await val1(3, 0)) === 3)) return FAIL("H I R did not insert a row above row 3");
    if (!(await undoOnce(before))) return FAIL("H I R was not one undo step");
    await click(2, 1); before = await snap(); await alt("HIC"); if (!((await val1(0, 1)) == null && (await val1(0, 2)) === "alpha")) return FAIL("H I C did not insert a column before B");
    if (!(await undoOnce(before))) return FAIL("H I C was not one undo step");
    await click(2, 1); before = await snap(); await alt("HDR"); if ((await val1(2, 0)) !== 4) return FAIL("H D R did not delete row 3");
    if (!(await undoOnce(before))) return FAIL("H D R was not one undo step");
    await click(2, 1); before = await snap(); await alt("HDC"); if ((await val1(0, 1)) !== "cherry") return FAIL("H D C did not delete column B");
    return (await undoOnce(before)) ? PASS("insert and delete of a row and a column, one undo step each") : FAIL("H D C was not one undo step");
  });
  alt1("H E A/F/C", "clear all · formats · contents", "HEA", async () => {
    const bold = async () => ((await styleOf(0, 1)).bl === 1 ? "bold" : "normal");     // B1 "alpha" is the seed's bold cell; an empty cell's style is read from the saved sheet
    await reset(); await block(0, 1, 2, 1); if ((await bold()) !== "bold") return FAIL("VOID: the seed's B1 is not bold");
    const b0 = await snap(); await alt("HEA");
    if (!((await val1(0, 1)) == null && (await bold()) !== "bold")) return FAIL("H E A did not clear the content and format of B1:B2");
    if (!(await undoOnce(b0))) return FAIL("H E A was not one undo step");
    await reset(); await block(0, 1, 2, 1); await alt("HEF");
    const f = [await val1(0, 1), await bold()]; if (!(f[0] === "alpha" && f[1] !== "bold")) return FAIL(`H E F should clear formats but keep the value; B1 is ${JSON.stringify(f)}`);
    await reset(); await block(0, 1, 2, 1); await alt("HEC");
    const c = [await val1(0, 1), await bold()];
    return c[0] == null && c[1] === "bold" ? PASS("clear all / formats only / contents only") : FAIL(`H E C should clear the value but keep the bold; B1 is ${JSON.stringify(c)}`);
  });
  alt1("H S S/O/F", "sort A→Z · Z→A · filter", "HSO", async () => {
    await reset(); await block(0, 0, 5, 1); const b0 = await snap();
    await alt("HSO"); const desc = [0, 1, 2, 3, 4].map((i) => 0).length && await inSheet((a, ws) => [0, 1, 2, 3, 4].map((i) => ws.getRange(i, 0).getValue()));
    if (!eq(desc, [5, 4, 3, 2, 1])) return FAIL(`H S O gave ${JSON.stringify(desc)}`);
    await alt("HSS"); const asc = await inSheet((a, ws) => [0, 1, 2, 3, 4].map((i) => ws.getRange(i, 0).getValue()));
    if (!eq(asc, [1, 2, 3, 4, 5])) return FAIL(`H S S gave ${JSON.stringify(asc)}`);
    void b0;
    await alt("HSF"); const f1 = await inSheet((a, ws) => !!ws.getFilter()); await alt("HSF"); const f2 = await inSheet((a, ws) => !!ws.getFilter());
    return f1 && !f2 ? PASS("sorted Z→A then A→Z; the filter turned on, then off") : FAIL(`filter on=${f1} then=${f2}`);
  });
  alt1("W F F/R/C", "freeze panes", "WFF", async () => {
    await reset(); await click(2, 2); const before = await snap();
    await alt("WFF"); const on = await inSheet((a, ws) => [ws.getFrozenRows(), ws.getFrozenColumns()]);
    await alt("WFF"); const off = await inSheet((a, ws) => [ws.getFrozenRows(), ws.getFrozenColumns()]);
    await alt("WFR"); const row = await inSheet((a, ws) => [ws.getFrozenRows(), ws.getFrozenColumns()]);
    await alt("WFF"); await alt("WFC"); const col = await inSheet((a, ws) => [ws.getFrozenRows(), ws.getFrozenColumns()]);
    void before;
    return eq(on, [2, 2]) && eq(off, [0, 0]) && row[0] === 1 && col[1] === 1 ? PASS("W F F froze above/left of C3 then unfroze; W F R froze the top row; W F C the first column") : FAIL(`on ${JSON.stringify(on)} off ${JSON.stringify(off)} row ${JSON.stringify(row)} col ${JSON.stringify(col)}`);
  });
  alt1("H 5 / H 6", "decrease / increase indent (the indent plugin's own commands)", "H6", async () => {
    await reset(); await click(1, 2); const before = await snap();
    await alt("H6"); const pd = (await styleOf(1, 2)).pd;
    if (!pd) return FAIL(`H 6 left no indent on C2 (style padding ${JSON.stringify(pd)})`);
    if (!(await undoOnce(before))) return FAIL("H 6 was not one undo step");
    await press("Control+y"); await wait(200); await alt("H5"); const back = (await styleOf(1, 2)).pd;
    return !back || JSON.stringify(back) !== JSON.stringify(pd) ? PASS(`H 6 indented C2 (${JSON.stringify(pd)}); one undo; H 5 stepped it back`) : FAIL(`H 5 left ${JSON.stringify(back)}`);
  });
  alt1("H 0 / H 9 / H K / H P / H 1-3 / H N", "decimals, comma, percent, B/I/U, number-format dialog", "H0", async () => {
    await reset(); await put([[0, 0, 1.5]]); await wait(300); await click(0, 0);
    await press("Control+Shift+!"); await alt("H0"); const inc = (await cell(0, 0)).nf;
    await alt("H9"); const dec = (await cell(0, 0)).nf;
    if (!(/0\.000/.test(inc) && /^#,##0\.00$/.test(dec))) return FAIL(`decimals: after H 0 "${inc}", after H 9 "${dec}"`);
    await alt("HK"); const k = (await cell(0, 0)).nf; await alt("HP"); const p = (await cell(0, 0)).nf;
    if (!(/#,##0/.test(k) && /%/.test(p))) return FAIL(`H K "${k}", H P "${p}"`);
    await click(1, 2); await alt("H1"); const b = (await cell(1, 2)).bold; await alt("H2"); const i = (await cell(1, 2)).italic; await alt("H3"); const u = (await cell(1, 2)).line;
    if (!(b === "bold" && i === "italic" && /underline/.test(u))) return FAIL(`H 1/2/3 gave ${b} ${i} ${u}`);
    await alt("HN"); await wait(300);
    const open = await ev(() => !![...document.querySelectorAll("button")].find((x) => /^confirm$/i.test(x.innerText.trim())));
    await ev(() => { const x = [...document.querySelectorAll("button")].find((y) => /^cancel$/i.test(y.innerText.trim())); if (x) x.click(); });
    return open ? PASS(`H 0 "${inc}", H 9 "${dec}", H K "${k}", H P "${p}", H 1/2/3 bold+italic+underline, H N opens the format panel`) : FAIL("H N opened no number-format panel");
  });
  for (const a of ALT) check(`alt-${a.id.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`, `Alt ${a.id} — ${a.label}`, a.run);
}
