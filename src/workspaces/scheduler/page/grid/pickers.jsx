import { HDARK, HEALTH, HK, MENU_STOPS_GRID, NO_AUTOFILL, anchorHidden, anchorSurroundings, useAnchoredPopover } from "../common.jsx";
import { parsePreds } from "../../../../shared/schedule/engine/predecessors.js";
import { ROW_H } from "../layout.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;


// ── HealthPicker ──────────────────────────────────────────
// One picker open at a time — any picker dispatches this when opening; others listen and close
const PICKER_EVENT = "planar-picker-open";

export function HealthPicker({value, onChange}) {
  const [open, setOpen]   = useState(false);
  const [hiIdx, setHiIdx] = useState(-1);
  const dotRef  = useRef(null);
  const menuRef = useRef(null);
  const idRef   = useRef(`hp-${Math.random()}`);
  // NEW-1 — follows its cell while open; closes (no commit) when the cell leaves the visible grid.
  const pos = useAnchoredPopover(open, dotRef, r => ({top: r.bottom + 4, left: r.left + r.width / 2 - 10}), () => setOpen(false));

  useEffect(() => {
    const onOther = e => { if (e.detail !== idRef.current) setOpen(false); };
    document.addEventListener(PICKER_EVENT, onOther);
    return () => document.removeEventListener(PICKER_EVENT, onOther);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Don't pre-highlight the current value — standard dropdown behavior shows all options
    // equally on open; user navigates via hover/arrow keys. The trigger itself still shows
    // the current value with its halo so they know what's currently set.
    setHiIdx(-1);

    const handleDown = e => {
      if (!dotRef.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  // Capture-phase keydown — fires BEFORE the global row-navigation handler
  useEffect(() => {
    if (!open) return;
    const handleKey = e => {
      // B1341729 — Tab is an EXIT gesture like any other, so it CLOSES the menu (it used to fall
      // through the guard below, leaving an open popover floating over the grid while focus moved
      // on). It chooses nothing: a menu's highlight is in-progress, never finished, so leaving
      // without pressing Enter correctly keeps the value that was already there.
      if (e.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown","ArrowUp","Enter","Escape"," "].includes(e.key)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") { setHiIdx(i => Math.min(HK.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { setHiIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" || e.key === " ") {
        // Read the highlighted index via the updater (its closure is stale), but defer the
        // commit + close so they don't run setState during render.
        setHiIdx(i => { const sel = HK[i] ?? value; setTimeout(() => { onChange(sel); setOpen(false); }, 0); return i; });
      }
    };
    document.addEventListener("keydown", handleKey, true); // capture = true
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, value, onChange]);

  const handleDotClick = e => {
    // Match StatusPicker exactly: open on click with stopPropagation. Earlier this was
    // on mousedown to "win the race" against the cell re-render, but jsdom tests showed
    // that race wasn't real — the perceived two-click was a small hit area, now fixed
    // by the full-cell trigger below. onClick is more reliable in practice.
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, {detail: idRef.current}));
    setOpen(o => !o);
  };

  const h = HEALTH[value] || HEALTH.gray;
  const dot = h.dot;
  const DotSpan = ({hk, size=13, active=false, noPointer=false}) => {
    const hh = HEALTH[hk] || HEALTH.gray;
    return <span style={{width:size,height:size,borderRadius:"50%",background:hh.dot,border:hh.border,
      display:"block",flexShrink:0,boxShadow:active?`0 0 0 2px ${hh.dot === "#ffffff" ? "#d1d5db" : hh.dot}44`:"none",
      transition:"box-shadow .15s",pointerEvents:noPointer?"none":"auto"}} />;
  };
  return (
    <>
      <span ref={dotRef} onClick={handleDotClick}
        data-health-dot="true"
        title="Set status"
        onMouseEnter={e=>{ if(!open) e.currentTarget.style.background="rgba(0,0,0,0.045)"; }}
        onMouseLeave={e=>{ if(!open) e.currentTarget.style.background="transparent"; }}
        style={{display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
          width:"100%",height:"100%",cursor:"pointer",
          background:open?"rgba(9,105,218,0.07)":"transparent",
          transition:"background .12s"}}>
        {/* Inner pill + dot are pointer-events:none so a click on the dot itself bubbles
            cleanly to the outer trigger's onClick instead of getting absorbed by inner
            spans — fixes the "click on the colored circle does nothing" hit-target issue. */}
        <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",position:"relative",
          width:24,height:18,borderRadius:4,pointerEvents:"none",
          outline:open?`1.5px solid ${dot === "#ffffff" ? "#d1d5db" : dot}`:"1.5px solid transparent",
          outlineOffset:0,transition:"outline-color .1s"}}>
          <DotSpan hk={value} active={open} noPointer />
        </span>
      </span>
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} {...MENU_STOPS_GRID}
          style={{position:"fixed",top:pos.top,left:pos.left,
            background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:6,
            padding:"5px 4px",display:"flex",flexDirection:"column",gap:2,
            zIndex:9999,boxShadow:"0 4px 14px rgba(0,0,0,0.15)"}}>
          {/* ⛔ RULES-DECIDE (2026-08-25, owner correction): the "Automatic" entry that used to sit
              here is RETIRED along with healthOverride — there is no lock left to hand back, so a
              control that only ever cleared one would do nothing. */}
          {HK.map((hk, i) => (
            <span key={hk} title={HEALTH[hk].label}
              onMouseEnter={()=>setHiIdx(i)}
              onMouseLeave={()=>setHiIdx(-1)}
              onClick={e => { e.stopPropagation(); onChange(hk); setOpen(false); }}
              style={{display:"flex",alignItems:"center",justifyContent:"center",
                width:28,height:20,borderRadius:4,cursor:"pointer",
                outline: i===hiIdx ? `1.5px solid ${HEALTH[hk].dot === "#ffffff" ? "#d1d5db" : HEALTH[hk].dot}` : "1.5px solid transparent",
                outlineOffset:0,transition:"outline-color .1s",
                background: i===hiIdx ? "var(--surf)" : "transparent"}}>
              {/* active driven by hiIdx only — no auto-halo on the current value so the menu
                  doesn't "drop down to the current color." pointer-events:none on the dot so
                  direct clicks land on this <span>'s onClick rather than getting absorbed. */}
              <DotSpan hk={hk} active={i===hiIdx} noPointer />
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── StatusPicker ──────────────────────────────────────────
export function StatusPicker({value, onChange}) {
  const [open, setOpen]   = useState(false);
  const [hiIdx, setHiIdx] = useState(-1);
  const ref     = useRef(null);
  const menuRef = useRef(null);
  const idRef   = useRef(`sp-${Math.random()}`);
  // NEW-1 — follows its cell while open; closes (no commit) when the cell leaves the visible grid.
  const pos = useAnchoredPopover(open, ref, r => ({top: r.bottom + 4, left: r.left}), () => setOpen(false));

  useEffect(() => {
    const onOther = e => { if (e.detail !== idRef.current) setOpen(false); };
    document.addEventListener(PICKER_EVENT, onOther);
    return () => document.removeEventListener(PICKER_EVENT, onOther);
  }, []);

  useEffect(() => {
    if (!open) return;
    setHiIdx(-1); // standard dropdown: no current-value preselection
    const handleDown = e => {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  // Capture-phase keydown — fires before the global row-navigation handler
  useEffect(() => {
    if (!open) return;
    const handleKey = e => {
      // B1341729 — Tab is an EXIT gesture like any other, so it CLOSES the menu (it used to fall
      // through the guard below, leaving an open popover floating over the grid while focus moved
      // on). It chooses nothing: a menu's highlight is in-progress, never finished, so leaving
      // without pressing Enter correctly keeps the value that was already there.
      if (e.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown","ArrowUp","Enter","Escape"," "].includes(e.key)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") { setHiIdx(i => Math.min(HK.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { setHiIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter" || e.key === " ") {
        setHiIdx(i => { const sel = HK[i] ?? value; setTimeout(() => { onChange(sel); setOpen(false); }, 0); return i; });
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, value, onChange]);

  const handleClick = e => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, {detail: idRef.current}));
    setOpen(o => !o);
  };

  const Pill = ({hk, showDot=false}) => {
    const hh = HEALTH[hk] || HEALTH.gray;
    const dotColor = hh.dot === "#ffffff" ? "#d1d5db" : hh.dot;
    return (
      <span style={{background:hh.bar,border:`1px solid ${dotColor}88`,borderRadius:4,
        padding:"2px 9px",fontSize:11,display:"inline-flex",alignItems:"center",gap:5,
        color:HDARK[hk],fontFamily:"'Inter',system-ui,sans-serif",whiteSpace:"nowrap",userSelect:"none"}}>
        {showDot && <span style={{width:7,height:7,borderRadius:2,flexShrink:0,
          background: hh.dot === "#ffffff" ? "#fff" : dotColor,
          border: hh.dot === "#ffffff" ? "1.5px solid #d1d5db" : "none"}} />}
        {hh.label}
      </span>
    );
  };

  return (
    <>
      <span ref={ref} onClick={handleClick}
        style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,color:"var(--mut)",fontSize:11,fontFamily:"'Inter',system-ui,sans-serif"}}>
        {(HEALTH[value]||HEALTH.gray).label}
      </span>
      {open && pos && ReactDOM.createPortal(
        <div ref={menuRef} {...MENU_STOPS_GRID}
          style={{position:"fixed",top:pos.top,left:pos.left,background:"var(--bg)",
            border:"1px solid var(--bd2)",borderRadius:6,padding:"5px 6px",
            display:"flex",flexDirection:"column",gap:3,
            zIndex:9999,boxShadow:"0 4px 14px rgba(0,0,0,0.15)"}}>
          {/* ⛔ RULES-DECIDE (2026-08-25, owner correction): "Automatic" retired along with
              healthOverride — see HealthPicker's own note above. */}
          {HK.map((hk, i) => (
            <span key={hk} onMouseEnter={()=>setHiIdx(i)} onMouseLeave={()=>setHiIdx(-1)}
              onClick={e=>{e.stopPropagation();onChange(hk);setOpen(false);}}
              style={{cursor:"pointer",padding:"1px 0",borderRadius:3,display:"block",
                background: i===hiIdx ? "var(--surf)" : "transparent"}}>
              <Pill hk={hk} showDot={true} />
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Predecessor inline editor ────────────────────────────
// Plain-English readback of a typed predecessor string, spelling out working vs calendar days
// so the "cd" suffix is discoverable + confirmable while typing. Pure — leans on parsePreds.
export const predLagPlainEnglish = raw => {
  const preds = parsePreds(raw);
  if (!preds.length) return "";
  return preds.map(p => {
    const base = { FS:`After task ${p.id} finishes`, SS:`When task ${p.id} starts`,
                   FF:`As task ${p.id} finishes`,   SF:`Until task ${p.id} starts` }[p.type]
                 || `After task ${p.id} finishes`;
    if (!p.lag) return base;
    const n = Math.abs(p.lag), unit = p.lagUnit === "calendar" ? "calendar" : "working";
    const days = `${n} ${unit} day${n === 1 ? "" : "s"}`;
    return p.lag > 0 ? `${base}, then ${days}` : `${base}, ${days} earlier`;
  }).join(" · ");
};
// Uncontrolled input (never fights the caret) + a sibling live hint. The parent cell drops its
// overflow:hidden while this cell is being edited so the hint can escape the 24px row.
export function PredEditor({ seedVal, taskId, colKey, commit, commitAndAdvance, setEdit, tabStep }) {
  const [hint, setHint] = useState(() => predLagPlainEnglish(seedVal));
  return (
    <React.Fragment>
      <input {...NO_AUTOFILL} autoFocus className="ei"
        placeholder="e.g. 2, 3SS, 4FF+2d  ·  add 'cd' for calendar days"
        defaultValue={seedVal}
        onChange={e => setHint(predLagPlainEnglish(e.target.value))}
        onBlur={e => commit(taskId, colKey, e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(taskId, colKey, e.target.value); return; }
          if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
          if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(taskId, colKey, e.target.value); tabStep(e.shiftKey); }
        }} />
      <div style={{ position:"absolute", top:"100%", left:0, marginTop:2, zIndex:40,
        minWidth:210, maxWidth:340, background:"var(--surf,#f6f8fa)",
        border:"1px solid var(--bd2,#d0d7de)", borderRadius:6, boxShadow:"0 4px 14px rgba(0,0,0,0.14)",
        padding:"6px 9px", fontSize:11, lineHeight:1.45, textAlign:"left", whiteSpace:"normal",
        pointerEvents:"none", fontFamily:"'Inter', system-ui, sans-serif" }}>
        {hint ? <div style={{ fontWeight:600, color:"var(--txt,#1f2328)", marginBottom:3 }}>{hint}</div> : null}
        <div style={{ color:"var(--mut,#57606a)" }}>'d' = working days · 'cd' = calendar days (weekends counted)</div>
      </div>
    </React.Fragment>
  );
}

// ── Cell ─────────────────────────────────────────────────
// ── NEW-1 (2026-11-06) — TASK ICONS: the slot between the chevron and the task name, the picker, the collapsed-phase summary.
// The library, search, 2-icon rule and phase summary are PURE and live in /sequence/taskIcons.js (window.PlanyrTaskIcons);
// this is only the drawing. Emoji draw as bundled Twemoji SVGs (a missing file falls back to the plain character, never a
// broken image); "c:<name>" ids draw as inline SVG. Icons are their own task field — editing a name never touches them.
// Amended 2026-11-09 (B2671196 ×2): the slot takes ZERO width when a task has no icons (the chevron sits right against the name) and
// exactly its icons' width when it has some — the old fixed width that kept names aligned across 0/1/2 icons is intentionally gone.
// taskIconsW is the one place that width is computed, so the name EDITOR's text starts where the displayed name starts.
const TASK_ICON_PX = 16, TASK_ICON_GAP = 2, TASK_ICON_PAD = 2, TASK_ICON_AFTER = 2;
export const taskIconsW = n => n > 0 ? n * TASK_ICON_PX + (n - 1) * TASK_ICON_GAP + 2 * TASK_ICON_PAD + TASK_ICON_AFTER : 0;
let TASK_ICON_UID = 0;   // per-rendered-instance counter: a drawing with a <mask> (the Permit) needs an id no other icon on the page shares
function TaskIconGlyph({id, size = 16, faded = false}) {
  const [failed, setFailed] = React.useState(false);
  const uidRef = React.useRef(null);
  if (uidRef.current === null) uidRef.current = "ti" + (++TASK_ICON_UID);
  const TI = window.PlanyrTaskIcons;
  const st = {display:"block", flexShrink:0, opacity: faded ? 0.55 : 1};
  if (TI.isCustom(id)) {
    const nm = TI.customName(id);
    if (!TI.CUSTOM_SVG[nm]) return null;   // an id from a newer client: keep it stored, draw nothing
    return <svg viewBox={TI.customViewBox(nm)} width={size} height={size} aria-hidden="true" style={st} dangerouslySetInnerHTML={{__html: TI.customMarkup(nm, uidRef.current)}} />;
  }
  if (TI.isBuiltinSvg(id)) {   // built-in line art ("svg:<name>"): currentColor, so it follows the text colour of the row / picker it sits in
    const b = TI.BUILTIN_SVG[TI.svgName(id)];
    if (!b) return null;   // an id from a newer client: keep it stored, draw nothing
    return <svg viewBox={b.viewBox} width={size} height={size} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={st} dangerouslySetInnerHTML={{__html: b.markup}} />;
  }
  if (failed) return <span aria-hidden="true" style={{...st, width:size, height:size, fontSize:Math.round(size*0.8), lineHeight:size+"px", textAlign:"center"}}>{id}</span>;
  return <img src={"/sequence/vendor/twemoji/" + TI.twemojiFile(id) + ".svg"} width={size} height={size} alt="" draggable={false} style={st} onError={() => setFailed(true)} />;
}

function TaskIconPicker({anchorRef, icons, onChange, onClose}) {
  const TI = window.PlanyrTaskIcons;
  const [q, setQ] = React.useState("");
  const rootRef = React.useRef(null);
  const PW = 336;
  const pos = useAnchoredPopover(true, anchorRef, r => {
    const room = window.innerHeight - r.bottom - 12, above = room < 300 && r.top > room;
    const maxH = Math.max(220, Math.min(420, (above ? r.top : room) - 8));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PW - 8));
    return above ? {left, bottom: window.innerHeight - r.top + 4, maxH} : {left, top: r.bottom + 4, maxH};
  }, onClose);
  React.useEffect(() => {
    const down = e => { const el = rootRef.current, a = anchorRef.current; if (el && el.contains(e.target)) return; if (a && a.contains(e.target)) return; onClose(); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);
  const groups = TI.searchTaskIcons(q);
  const shown = TI.normalizeTaskIcons(icons);
  if (!pos) return null;
  return ReactDOM.createPortal(
    <div ref={rootRef} data-task-icon-picker {...MENU_STOPS_GRID} role="dialog" aria-label="Choose task icons"
      onKeyDown={e => { e.nativeEvent.stopImmediatePropagation(); e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      onDoubleClick={e => e.stopPropagation()}
      style={{position:"fixed", left:pos.left, top:pos.top, bottom:pos.bottom, width:PW, maxHeight:pos.maxH, zIndex:100000, display:"flex", flexDirection:"column",
        background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:9, boxShadow:"0 8px 28px rgba(0,0,0,.18)", fontFamily:"'Inter',system-ui,sans-serif", overflow:"hidden"}}>
      <div style={{padding:"8px 8px 6px", borderBottom:"1px solid var(--bd)", flexShrink:0}}>
        <input {...NO_AUTOFILL} autoFocus type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search icons — tia, sewer, roof, tilt…"
          aria-label="Search icons"
          style={{width:"100%", height:28, border:"1px solid var(--bd2)", borderRadius:6, padding:"0 8px", fontSize:12, fontFamily:"inherit", outline:"none", color:"var(--txt)", background:"var(--bg)"}}
          onFocus={e => { e.target.style.borderColor = "var(--blue)"; }} onBlur={e => { e.target.style.borderColor = ""; }} />
      </div>
      <div style={{overflowY:"auto", padding:"4px 8px 8px", flex:"1 1 auto", minHeight:0}}>
        {groups.length === 0 && <div style={{padding:"18px 6px", fontSize:12, color:"var(--mut)", textAlign:"center"}}>Nothing matches “{q.trim()}”. Try another word.</div>}
        {groups.map(g => (
          <div key={g.key} data-icon-group={g.key}>
            <div style={{fontSize:9.5, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--mut)", padding:"8px 2px 3px"}}>{g.title}</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:2}}>
              {g.items.map(it => {
                const on = shown.includes(it.id), lab = TI.iconLabel(it.id, it.label);
                return (
                  <button key={it.id} type="button" className="ti-pick-cell" data-icon-id={it.id} aria-pressed={on} aria-label={lab} title={lab}
                    onClick={() => onChange(TI.toggleTaskIcon(shown, it.id))}>
                    <TaskIconGlyph id={it.id} size={22} />
                    {TI.isDrawn(it.id) && <span aria-hidden="true" style={{position:"absolute", top:3, right:3, width:5, height:5, borderRadius:"50%", background:"#16a34a"}} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"flex", alignItems:"center", gap:6, padding:"7px 8px", borderTop:"1px solid var(--bd)", flexShrink:0, background:"var(--surf)"}}>
        <a href="/sequence/vendor/twemoji/CREDITS.txt" target="_blank" rel="noopener" title="Emoji art: Twemoji, CC-BY 4.0" style={{fontSize:10, color:"var(--mut)", textDecoration:"none", marginRight:"auto"}}>Emoji art: Twemoji (CC-BY 4.0)</a>
        <button type="button" data-icon-clear disabled={shown.length === 0} onClick={() => onChange([])}
          style={{height:24, padding:"0 10px", fontSize:11.5, fontFamily:"inherit", borderRadius:5, border:"1px solid var(--bd2)", background:"var(--bg)", color:shown.length ? "var(--txt)" : "var(--mut)", cursor:shown.length ? "pointer" : "default"}}>Clear</button>
        <button type="button" data-icon-done onClick={onClose}
          style={{height:24, padding:"0 12px", fontSize:11.5, fontWeight:600, fontFamily:"inherit", borderRadius:5, border:"1px solid var(--blue)", background:"var(--blue)", color:"#fff", cursor:"pointer"}}>Done</button>
      </div>
    </div>,
    document.body
  );
}

export function TaskIconSlot({task, updateTask}) {
  const TI = window.PlanyrTaskIcons;
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const icons = TI.normalizeTaskIcons(task.icons);
  const close = React.useCallback(() => setOpen(false), []);
  // No icons → NOTHING is rendered (no hover glyph, no reserved width). The first icon is added from the right-click menu.
  if (icons.length === 0) return null;
  return (
    <>
      <span ref={ref} data-task-icon-slot={icons.length} role="button" aria-label="Task icons" aria-haspopup="dialog" aria-expanded={open}
        onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{height:ROW_H - 2, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"flex-start", gap:TASK_ICON_GAP, padding:"0 " + TASK_ICON_PAD + "px", marginRight:TASK_ICON_AFTER, borderRadius:3, cursor:"pointer", userSelect:"none"}}>
        {icons.map(id => <span key={id} data-task-icon={id} title={TI.iconLabel(id)} style={{display:"inline-flex"}}><TaskIconGlyph id={id} size={TASK_ICON_PX} /></span>)}
      </span>
      {open && <TaskIconPicker anchorRef={ref} icons={icons} onChange={next => updateTask(task.id, {icons: next})} onClose={close} />}
    </>
  );
}

// The picker opened from the row's RIGHT-CLICK menu ("Set icon…" / "Change icon…"). It lives at the app level (the menu does) and
// anchors to that task's NAME in the grid; if the name column is hidden or the row is not in the grid (Gantt-only), it anchors to
// the point that was right-clicked. It reads the LIVE task, so every pick is written through and shows on the row at once.
export function TaskIconPickerHost({ctx, tasks, updateTask, onClose}) {
  const anchorRef = React.useRef(null);
  const pointRef = React.useRef(null);
  if (!anchorRef.current) {
    let el = document.querySelector('[data-task-row="' + ctx.taskId + '"] [data-task-name]');
    if (el) { const s = anchorSurroundings(el); if (anchorHidden(el.getBoundingClientRect(), s.area, s.occluders)) el = null; }   // name scrolled out of sight → use the click point instead of closing at once
    if (!el) {
      el = document.createElement("span");   // a 1px marker where the right-click happened (name column hidden, or a Gantt-only view)
      el.style.cssText = "position:fixed;width:1px;height:1px;pointer-events:none;visibility:hidden;left:" + ctx.x + "px;top:" + ctx.y + "px";
      document.body.appendChild(el); pointRef.current = el;
    }
    anchorRef.current = el;
  }
  React.useEffect(() => () => { if (pointRef.current) pointRef.current.remove(); }, []);
  const task = (tasks || []).find(t => t.id === ctx.taskId);
  if (!task) return null;
  return <TaskIconPicker anchorRef={anchorRef} icons={window.PlanyrTaskIcons.normalizeTaskIcons(task.icons)} onChange={next => updateTask(ctx.taskId, {icons: next}, ctx.projId)} onClose={onClose} />;
}

// Collapsed summary/phase row: the distinct icons of every leaf task inside it (faded). No task count (owner, 2026-11-09). Nothing when expanded.
export function PhaseIconSummary({tasks, taskId}) {
  const sum = window.PlanyrTaskIcons.phaseIconSummary(tasks, taskId);
  if (!sum.icons.length) return null;   // amended 2026-11-09: there is no "N tasks" count any more — no icons inside, nothing shown
  const MAXI = 8, vis = sum.icons.slice(0, MAXI), more = sum.icons.length - vis.length;
  return (
    <span data-phase-icons style={{display:"inline-flex", alignItems:"center", gap:3, marginLeft:8, flex:"0 1000 auto", minWidth:0, overflow:"hidden", whiteSpace:"nowrap"}}>   {/* shrinks ~1000x faster than the name: in a narrow column the summary yields first, the phase name keeps its room */}
      {vis.map(id => <TaskIconGlyph key={id} id={id} size={13} faded />)}
      {more > 0 && <span style={{fontSize:10, color:"var(--mut)"}}>+{more}</span>}
    </span>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  PICKER_EVENT: [() => PICKER_EVENT],
  HealthPicker: [() => HealthPicker],
  StatusPicker: [() => StatusPicker],
  predLagPlainEnglish: [() => predLagPlainEnglish],
  PredEditor: [() => PredEditor],
  TASK_ICON_PX: [() => TASK_ICON_PX],
  TASK_ICON_GAP: [() => TASK_ICON_GAP],
  TASK_ICON_PAD: [() => TASK_ICON_PAD],
  TASK_ICON_AFTER: [() => TASK_ICON_AFTER],
  taskIconsW: [() => taskIconsW],
  TASK_ICON_UID: [() => TASK_ICON_UID, (v) => { TASK_ICON_UID = v; }],
  TaskIconGlyph: [() => TaskIconGlyph],
  TaskIconPicker: [() => TaskIconPicker],
  TaskIconSlot: [() => TaskIconSlot],
  TaskIconPickerHost: [() => TaskIconPickerHost],
  PhaseIconSummary: [() => PhaseIconSummary],
});
