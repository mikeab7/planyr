import { NO_AUTOFILL } from "../common.jsx";
import { adjacentMeetingDate } from "../../../../shared/schedule/engine/meetings.js";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEPS, ROW_COLORS, stepFontSize } from "../common/formatConsts.js";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;


// ── SwatchGrid / CaretPopover — shared by the format mini-toolbar's two color carets ──
// Same 1-"none"+19-color palette, same layout, that used to sit inside the context menu
// itself (NEW-1, chat 2026-09-11): "nothing about which colours are available changes;
// they just stop occupying the top third of the menu."
const SwatchGrid = ({current, onPick}) => (
  <div style={{padding:"4px 5px",display:"grid",gridTemplateColumns:"repeat(10, 18px)",gap:2,justifyContent:"start"}}>
    <button title="None (clear)" onClick={()=>onPick(null)} type="button"
      style={{width:18,height:18,borderRadius:2,background:"var(--bg)",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",
        border: current==null ? "1.5px solid #4f46e5" : "1px solid #d1d5db"}}>
      <svg width="9" height="9" viewBox="0 0 10 10">
        <line x1="1" y1="1" x2="9" y2="9" stroke={current==null?"#4f46e5":"#9ca3af"} strokeWidth="1.5"/>
        <line x1="9" y1="1" x2="1" y2="9" stroke={current==null?"#4f46e5":"#9ca3af"} strokeWidth="1.5"/>
      </svg>
    </button>
    {ROW_COLORS.slice(0, 19).map(rc => (
      <button key={rc.color} title={rc.label} onClick={()=>onPick(rc.color)} type="button"
        style={{width:18,height:18,borderRadius:2,background:rc.color,cursor:"pointer",padding:0,
          border:current===rc.color?"1.5px solid #111827":"1px solid #d1d5db",
          boxShadow:current===rc.color?"inset 0 0 0 1px #fff":"none"}} />
    ))}
  </div>
);
const CaretPopover = ({children, popRef, openLeft}) => (
  <div ref={popRef} onMouseDown={e=>e.stopPropagation()}
    style={{position:"absolute", top:"100%", marginTop:4, ...(openLeft?{right:0}:{left:0}),
      background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:6,
      boxShadow:"0 8px 24px rgba(0,0,0,0.18)", zIndex:10002}}>
    {children}
  </div>
);

// ── FormatMiniToolbar ─────────────────────────────────────
// NEW-1/NEW-2 (chat, 2026-09-11, owner-approved mock-up) — the Word-mini-toolbar-style
// floating strip that replaced the context menu's old top-of-menu formatting section.
// Own surface (border/radius/shadow), positioned by the caller just above (or, if there's
// no room, below) the command menu, and forwards its DOM ref so the menu's own outside-
// click/Escape/scroll close logic can treat both as one unit (see TaskContextMenu below).
const FormatMiniToolbar = React.forwardRef(function FormatMiniToolbar(
  {fmt, onSetBold, onSetItalic, onSetUnderline, onSetTextColor, onSetFill, onSetFontSize, onClearFormat, top, left, maxWidth}, ref) {
  const fb = fmt;
  const [openCaret, setOpenCaret] = useState(null); // 'size' | 'color' | 'fill' | null
  const popRef = useRef(null);
  useEffect(() => {
    if (!openCaret) return;
    const down = e => {
      if (popRef.current?.contains(e.target)) return;          // inside the open popover — keep it open
      if (e.target.closest?.("[data-caret-toggle]")) return;   // the caret button owns its own toggle
      setOpenCaret(null);
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [openCaret]);

  const sizeDisplay = fb.size === "mixed" ? "" : (fb.size != null ? String(fb.size) : "");
  const [sizeText, setSizeText] = useState(sizeDisplay);
  useEffect(() => { setSizeText(sizeDisplay); }, [sizeDisplay]);
  const commitSize = raw => {
    const trimmed = String(raw).trim();
    if (trimmed === "") { onSetFontSize(null); return; }
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n)) { setSizeText(sizeDisplay); return; }
    onSetFontSize(Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n * 2) / 2)));
  };

  const MiniBtn = ({active, disabled, onClick, title, children, w = 20}) => (
    <button title={title} onClick={disabled ? undefined : onClick} disabled={disabled} type="button"
      style={{width:w,height:20,borderRadius:3,padding:0,cursor:disabled?"default":"pointer",flexShrink:0,
        display:"inline-flex",alignItems:"center",justifyContent:"center",
        color: disabled ? "#c0c8d0" : active ? "#fff" : "var(--txt)",
        background: active ? "#4f46e5" : "transparent",
        border: `1px solid ${active ? "#4338ca" : "transparent"}`,
        opacity: disabled ? 0.5 : 1}}
      onMouseEnter={e=>{ if(!disabled && !active) e.currentTarget.style.background="#e5e7eb"; }}
      onMouseLeave={e=>{ if(!disabled && !active) e.currentTarget.style.background="transparent"; }}>
      {children}
    </button>
  );
  const Row = ({children}) => <div style={{display:"flex",alignItems:"center",gap:2,height:22}}>{children}</div>;
  const Group = ({children, style}) => <div style={{display:"flex",flexDirection:"column",gap:1,padding:"3px 5px",justifyContent:"center",flexShrink:0,...style}}>{children}</div>;
  const VRule = () => <div style={{width:1,alignSelf:"stretch",background:"var(--bd2)",margin:"3px 0"}} />;
  // Text-colour / highlight caret button: an icon over a colored bar (the color it will
  // apply), with a caret that opens the SAME 20-swatch palette. (c) — same colours, same
  // "none" option; only WHERE they live changed.
  const ColorCaret = ({kind, icon, current, title, onPick}) => (
    <div style={{position:"relative",display:"flex",alignItems:"center",gap:1}}>
      <MiniBtn title={title} onClick={()=>{}} w={22}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          {icon}
          <div style={{width:13,height:2.5,background:current||"transparent",border:current?"none":"1px dashed #c0c8d0",borderRadius:1}} />
        </div>
      </MiniBtn>
      <button data-caret-toggle title={`${title} options`} type="button" onClick={()=>setOpenCaret(c=>c===kind?null:kind)}
        style={{width:11,height:20,border:"none",background:"transparent",cursor:"pointer",color:"var(--mut)",flexShrink:0,fontSize:8,padding:0}}>▾</button>
      {openCaret===kind && <CaretPopover popRef={popRef}><SwatchGrid current={current} onPick={c=>{ onPick(c); setOpenCaret(null); }} /></CaretPopover>}
    </div>
  );

  return (
    <div ref={ref} onMouseDown={e=>e.stopPropagation()}
      style={{position:"fixed",top,left,maxWidth,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:8,
        boxShadow:"0 6px 20px rgba(0,0,0,0.16)",display:"flex",flexWrap:"wrap",alignItems:"stretch",
        fontFamily:"'Inter',system-ui,sans-serif",zIndex:10001,padding:1}}>
      {/* Group 1 — size (type-in + caret + grow/shrink), then B / I / U */}
      <Group>
        <Row>
          <input {...NO_AUTOFILL} value={sizeText} onChange={e=>setSizeText(e.target.value)}
            onBlur={e=>commitSize(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commitSize(e.target.value); e.currentTarget.blur(); } else if(e.key==="Escape"){ setSizeText(sizeDisplay); e.currentTarget.blur(); } }}
            placeholder="—" title="Text size" aria-label="Text size"
            style={{width:28,height:20,fontSize:11,border:"1px solid var(--bd2)",borderRadius:3,textAlign:"center",padding:0,fontFamily:"'Inter',system-ui,sans-serif"}} />
          <div style={{position:"relative"}}>
            <button data-caret-toggle title="Text size options" type="button" onClick={()=>setOpenCaret(c=>c==="size"?null:"size")}
              style={{width:11,height:20,border:"none",background:"transparent",cursor:"pointer",color:"var(--mut)",flexShrink:0,fontSize:8,padding:0}}>▾</button>
            {openCaret==="size" && (
              <CaretPopover popRef={popRef}>
                <div style={{padding:"2px 0",minWidth:56,maxHeight:220,overflow:"auto"}}>
                  {FONT_SIZE_STEPS.map(v => (
                    <div key={v} onClick={()=>{ onSetFontSize(v); setOpenCaret(null); }}
                      style={{padding:"4px 10px",fontSize:11,cursor:"pointer",textAlign:"left",
                        background: fb.size===v ? "var(--surf)" : "transparent", fontWeight: fb.size===v?700:400}}>{v}</div>
                  ))}
                </div>
              </CaretPopover>
            )}
          </div>
          <MiniBtn title="Shrink text" onClick={()=>onSetFontSize(stepFontSize(fb.size==="mixed"?(fb.naturalSize??12):(fb.size??fb.naturalSize??12), -1))}><span style={{fontSize:10,fontWeight:700}}>A−</span></MiniBtn>
          <MiniBtn title="Grow text"   onClick={()=>onSetFontSize(stepFontSize(fb.size==="mixed"?(fb.naturalSize??12):(fb.size??fb.naturalSize??12), +1))}><span style={{fontSize:10,fontWeight:700}}>A+</span></MiniBtn>
        </Row>
        <Row>
          <MiniBtn active={!!fb.bold}      onClick={()=>onSetBold(!fb.bold)}           title="Bold"><span style={{fontWeight:800,fontSize:12}}>B</span></MiniBtn>
          <MiniBtn active={!!fb.italic}    onClick={()=>onSetItalic(!fb.italic)}       title="Italic"><span style={{fontStyle:"italic",fontWeight:600,fontSize:12,fontFamily:"Georgia,'Times New Roman',serif"}}>I</span></MiniBtn>
          <MiniBtn active={!!fb.underline} onClick={()=>onSetUnderline(!fb.underline)} title="Underline"><span style={{fontWeight:700,fontSize:12,textDecoration:"underline"}}>U</span></MiniBtn>
        </Row>
      </Group>
      <VRule/>
      {/* Group 2 — text colour, then highlight/fill; both open the same swatch palette */}
      <Group>
        <Row>
          <ColorCaret kind="color" title="Text color" current={fb.color}
            icon={<span style={{fontSize:11,fontWeight:800,lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>A</span>}
            onPick={onSetTextColor} />
        </Row>
        <Row>
          <ColorCaret kind="fill" title="Highlight / fill" current={fb.fill}
            icon={
              <svg width="12" height="10" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11l8 8a2 2 0 0 0 2.8 0L22 10.5 12.5 1 4 9.5a2 2 0 0 0 0 2.8z" />
                <path d="M5 9h13" />
              </svg>
            }
            onPick={onSetFill} />
        </Row>
      </Group>
      <VRule/>
      <Group style={{justifyContent:"center"}}>
        <MiniBtn title="Clear formatting" disabled={!fb.hasAny} onClick={onClearFormat} w={20}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 20H7l-4-4 8-8 12 12-4 4" />
            <path d="M9 11l4 4" />
            <path d="M22 21H7" />
          </svg>
        </MiniBtn>
      </Group>
      <VRule/>
      {/* Group 3 — plain, non-clickable selection-count readout ((d) in the item: this is
          what "CELL FORMAT" turned into — a readout, never a toggle). */}
      <Group style={{justifyContent:"center",alignItems:"center",minWidth:52}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--txt)",textAlign:"center",lineHeight:1.1,userSelect:"none"}}>{fb.count} {fb.unit}</div>
        <div style={{fontSize:8,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--mut)",textAlign:"center",userSelect:"none"}}>Selected</div>
      </Group>
    </div>
  );
});

// ── TaskContextMenu ───────────────────────────────────────
// NEW-1 (chat, 2026-09-11) — this is now COMMANDS ONLY; every formatting control moved into
// the sibling FormatMiniToolbar above, which this component portals alongside itself and
// shares open/close lifecycle with (Escape, click-away, scroll, or choosing any command
// closes both as one unit).
export function TaskContextMenu({x, y, task, projId, onInsertAbove, onInsertBelow, onAddSubtask, onDuplicate, onCutTask, onCopyTaskFull, onPasteTask, hasClipboard, onIndent, onOutdent, onMoveTo, canOutdent, meetingBodies = [], otherBodies = [], bindCount = 1, boundTasks = [], deadlineAnchorName = null, onBindMeeting, onUnbindMeeting, onImportBindMeeting, onAddDeadlineRow, onLinkAsDeadline, onUnlinkDeadline, onAddMeetingCalendar, onStepMeeting, onDelete, deleteCount = 1, onSetHealth, hasIcons = false, onSetIcon, onRemoveIcon, onSetRowColor, onSetBold, onSetItalic, onSetUnderline, onSetTextColor, onSetFontSize, onClearFormat, fmt, onClose}) {
  const menuRef = useRef(null);
  const toolbarRef = useRef(null);

  useEffect(() => {
    const down = e => { if (!menuRef.current?.contains(e.target) && !toolbarRef.current?.contains(e.target)) onClose(); };
    const key  = e => { if (e.key === "Escape") onClose(); };
    // (f) — scroll closes the whole group too, same as click-away/Escape/choosing a command.
    // Registered on the capture phase so a scroll on any nested scrollable ancestor (the grid
    // body, a submenu's own overflow:auto list) is caught — 'scroll' doesn't bubble on its own.
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown",   key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);   // NEW-1 — a resized window leaves the click point stale
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown",   key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const vw = window.innerWidth, vh = window.innerHeight;
  // mh is an estimate of the menu's full rendered height; if y + mh would clip the
  // bottom of the viewport, top shifts up so the menu stays fully visible. Recomputed
  // when row padding changed below — better to slightly overestimate.
  // NEW-1 shrank this considerably once the formatting strip + swatch rows moved out.
  const mw = 220, mh = 460;
  const left = x + mw > vw ? vw - mw - 8 : x;
  const top  = y + mh > vh ? Math.max(8, vh - mh - 8) : y;

  // (e) — the toolbar sits just above the menu with a small gap; if there isn't room above,
  // it drops below the menu instead; either way it's clamped fully on screen. Because `top`
  // (the menu's own placed top) is always at-or-above the row's actual click point `y` (the
  // overflow branch above only ever shifts the menu UP), anchoring the toolbar above `top` —
  // or, in the fallback, below the menu's full height — keeps it off the clicked row either way.
  const TB_W = 258, TB_H = 54, TB_GAP = 6;
  const tbMaxWidth = Math.min(TB_W, vw - 16);
  let tbTop = top - TB_H - TB_GAP;
  if (tbTop < 8) tbTop = Math.min(top + mh + TB_GAP, vh - TB_H - 8);
  const tbLeft = Math.min(Math.max(8, left), vw - tbMaxWidth - 8);

  const Item = ({icon, label, hint, danger, disabled, onClick, children}) => (
    <div onClick={disabled ? undefined : onClick}
      style={{display:"flex",alignItems:"center",gap:7,padding:"3px 11px",cursor:disabled?"default":"pointer",
        fontSize:11,color:disabled?"#c0c8d0":danger?"#dc2626":"var(--txt)",borderRadius:4,
        transition:"background .1s",fontFamily:"'Inter',system-ui,sans-serif",opacity:disabled?0.5:1}}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.background=danger?"#fff1f2":"var(--surf)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
      <i className={`ti ${icon}`} style={{fontSize:12,flexShrink:0,color:disabled?"#c0c8d0":danger?"#dc2626":"var(--mut)",width:14,textAlign:"center"}} aria-hidden="true" />
      <span style={{flex:1}}>{label}{children}</span>
      {hint && <span style={{color:"#b0b7c0",fontSize:9,fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:".03em"}}>{hint}</span>}
    </div>
  );
  const Sep = () => <div style={{height:1,background:"var(--bd)",margin:"2px 0"}} />;
  // Scope-aware toolbar state: fb reflects the cell OR row being formatted
  // (computed by App from the live selection); falls back to row flags.
  const fb = fmt || {bold: !!task.bold, italic: !!task.italic, underline: !!task.underline,
    fill: task.rowColor || null, color: task.textColor || null, size: task.fontSize || null, naturalSize: [13,12,11.5,11][Math.min(task.level||0,3)],
    hasAny: !!task.rowColor || !!task.bold || !!task.italic || !!task.underline || !!task.textColor || !!task.fontSize,
    count: 1, unit: "row", scopeLabel: null};
  const Header = () => (
    <div style={{padding:"5px 11px 4px",borderBottom:"1px solid var(--bd)",marginBottom:2}}>
      <div style={{fontSize:9,color:"var(--mut)",fontFamily:"'Inter',system-ui,sans-serif",letterSpacing:".06em",textTransform:"uppercase",marginBottom:1}}>Task {task.id}</div>
      <div style={{fontSize:11,fontWeight:task.bold?700:500,fontStyle:task.italic?"italic":"normal",color:"var(--txt)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>{task.name || <span style={{color:"var(--mut)",fontStyle:"italic"}}>New task</span>}</div>
    </div>
  );

  // canOutdent is now passed in as a prop — computed by the caller against the WHOLE resolved
  // selection (structuralTargets), not just this one row, so a multi-row right-click correctly
  // disables Outdent only when every targeted row is already at depth 0.
  // B844 — meeting-calendar flyout. Parent label reflects the row's CURRENT state (bound body /
  // deadline link / unbound); the flyout is one radio list ("— none —" + bodies, ✓ on the current
  // choice) plus the deadline-row actions. Opens leftward when the menu is near the right edge.
  const [subMeet, setSubMeet] = useState(false);
  // NEW-1 (B<PENDING>, 2026-09-23) — a bound body can live on ANOTHER schedule (its id is globally
  // unique — B816; the date math already resolves it via MEETING_BODY_INDEX regardless of which
  // schedule it lives on). `meetingBodies` is only THIS schedule's own list, so a foreign binding
  // used to read as `null` here and fall through to the literal string "Meeting body". `otherBodies`
  // (every OTHER schedule's bodies, already schedule-tagged) is searched as the fallback before
  // giving up — genuinely nowhere (task.meetingBodyMissing) is the only case left unresolved.
  const localBody = task.meetingBound ? meetingBodies.find(b => b.id === task.meetingBodyId) : null;
  const foreignMatch = (task.meetingBound && !localBody) ? otherBodies.find(ob => ob.body.id === task.meetingBodyId) : null;
  const meetingBody = localBody || (foreignMatch ? foreignMatch.body : null);
  const curBodyName = !task.meetingBound ? ""
    : meetingBody ? (meetingBody.name || "Meeting body")
    : "⚠ calendar missing";
  const isDeadlineRow = task.deadlineForTaskId != null;
  const subOpenLeft = left + mw + 210 > vw;
  // "step this bound row to the next/previous meeting" reads off the SAME resolver
  // (adjacentMeetingDate → meetingDatesInRange) the snap flyout below uses; shown only when
  // the row is actually bound to a body that resolves (meetingBody truthy), and disabled
  // (never hidden) when there's no next/previous date to compute one.
  const nextMeetingIso = (meetingBody && task.start) ? adjacentMeetingDate(meetingBody, task.start, "next") : null;
  const prevMeetingIso = (meetingBody && task.start) ? adjacentMeetingDate(meetingBody, task.start, "prev") : null;
  const fmtMeetingStep = iso => { const d = new Date(iso + "T12:00:00"); return isNaN(d) ? "" : d.toLocaleDateString("en-US", {weekday:"short", month:"short", day:"numeric"}); };
  const SubCaption = ({children}) => (
    <div style={{padding:"4px 11px 2px",fontSize:9,fontWeight:700,color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase",userSelect:"none"}}>{children}</div>
  );

  return ReactDOM.createPortal(
    <>
      <FormatMiniToolbar ref={toolbarRef} fmt={fb} top={tbTop} left={tbLeft} maxWidth={tbMaxWidth}
        onSetBold={onSetBold} onSetItalic={onSetItalic} onSetUnderline={onSetUnderline}
        onSetTextColor={onSetTextColor} onSetFill={onSetRowColor} onSetFontSize={onSetFontSize}
        onClearFormat={onClearFormat} />
      <div ref={menuRef} style={{position:"fixed",top,left,background:"var(--bg)",border:"1px solid var(--bd2)",
        borderRadius:6,padding:"3px 0",zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.14)",minWidth:mw}}>
        <Header />
        <Item icon="ti-row-insert-top"    label="Insert Row Above"  hint="Ins"  onClick={onInsertAbove} />
        <Item icon="ti-row-insert-bottom" label="Insert Row Below"              onClick={onInsertBelow} />
        <Item icon="ti-sitemap"           label="Add Subtask"                   onClick={onAddSubtask} />
        <Sep />
        {/* NEW-3 (chat, 2026-09-11) — the meeting group now reads step-first: Next meeting,
            Previous meeting (disabled-not-hidden — so the menu never changes height as the row
            selection changes), THEN the bind/snap flyout trigger. Was: flyout, then the two step
            rows; the owner asked for the reverse. */}
        {meetingBody && (<>
          <Item icon="ti-chevron-right" label={nextMeetingIso ? `Next meeting · ${fmtMeetingStep(nextMeetingIso)}` : "Next meeting"} disabled={!nextMeetingIso} onClick={() => onStepMeeting(nextMeetingIso)} />
          <Item icon="ti-chevron-left"  label={prevMeetingIso ? `Previous meeting · ${fmtMeetingStep(prevMeetingIso)}` : "Previous meeting"} disabled={!prevMeetingIso} onClick={() => onStepMeeting(prevMeetingIso)} />
        </>)}
        {/* B844 — meeting-calendar flyout: the parent label reads the row's current state; the
            flyout is one radio list (— none — + bodies) plus the deadline-row actions.
            NEW-1 (B1824576) — a schedule with zero bodies of its own but bodies available on
            OTHER schedules still opens the flyout (not the flat "Add a meeting calendar…" row),
            so "From other schedules" is reachable; a schedule with neither keeps the old flat row. */}
        <div style={{position:"relative"}} onMouseEnter={()=>setSubMeet(true)} onMouseLeave={()=>setSubMeet(false)}>
          {meetingBodies.length === 0 && otherBodies.length === 0 && !isDeadlineRow ? (
            <Item icon="ti-calendar-plus" label="Add a meeting calendar…" onClick={onAddMeetingCalendar} />
          ) : isDeadlineRow ? (
            <Item icon="ti-flag" label={`Deadline for: ${deadlineAnchorName || "(missing task)"}`} hint="▸" />
          ) : task.meetingBound ? (
            <Item icon="ti-calendar-event" label={`Meeting: ${curBodyName}${foreignMatch ? ` — from ${foreignMatch.schedName}` : ""}`} hint="▸" />
          ) : (
            <Item icon="ti-calendar-event" label={bindCount > 1 ? `Bind ${bindCount} rows to meeting calendar` : "Bind to meeting calendar"} hint="▸" />
          )}
          {subMeet && (meetingBodies.length > 0 || otherBodies.length > 0 || isDeadlineRow) && (
            <div style={{position:"absolute", top:-4, ...(subOpenLeft ? {right:"100%"} : {left:"100%"}), minWidth:200, maxHeight:320, overflow:"auto",
              background:"var(--bg)", border:"1px solid var(--bd2)", borderRadius:6, boxShadow:"0 8px 24px rgba(0,0,0,0.18)", padding:"3px 0", zIndex:10000}}>
              {isDeadlineRow ? (<>
                <SubCaption>Deadline row for “{deadlineAnchorName || "missing task"}”</SubCaption>
                <Item icon="ti-flag-off" label="Unlink (keep current date)" onClick={onUnlinkDeadline} />
              </>) : (<>
                <SubCaption>{bindCount > 1 ? `Snap ${bindCount} rows to` : "Snap this row to"}</SubCaption>
                <Item icon={!task.meetingBound ? "ti-check" : "ti-circle"} label="— none —" onClick={onUnbindMeeting} />
                {meetingBodies.map(b => {
                  const isCur = task.meetingBound && task.meetingBodyId === b.id;
                  return <Item key={b.id} icon={isCur ? "ti-check" : "ti-circle"} label={b.name || "Meeting body"} onClick={()=>onBindMeeting(b.id)} />;
                })}
                {otherBodies.length > 0 && (<>
                  <Sep />
                  <SubCaption>From other schedules</SubCaption>
                  {otherBodies.map(ob => {
                    // NEW-1 — the row currently bound to a FOREIGN body (foreignMatch) is checked here,
                    // same as a local body is checked in the list above, and its label makes the click's
                    // effect explicit: it copies that calendar's cadence into THIS schedule (B1824576's
                    // import path) and rebinds to the copy — the binding itself is untouched until he does.
                    const isCur = task.meetingBound && !localBody && task.meetingBodyId === ob.body.id;
                    return (
                      <Item key={`${ob.pid}:${ob.body.id}`} icon={isCur ? "ti-check" : "ti-calendar-event"}
                        label={`${ob.body.name || "Meeting body"} · ${ob.schedName}${isCur ? " — copy into this schedule" : ""}`}
                        onClick={()=>onImportBindMeeting(ob.pid, ob.body.id)} />
                    );
                  })}
                </>)}
                {bindCount === 1 && task.meetingBound && !task.hasChildren && (<>
                  <Sep />
                  <Item icon="ti-flag" label="+ Add deadline row (call/file-by date)" onClick={onAddDeadlineRow} />
                </>)}
                {bindCount === 1 && !task.meetingBound && !task.hasChildren && boundTasks.length > 0 && (<>
                  <Sep />
                  <SubCaption>Use as deadline row for</SubCaption>
                  {boundTasks.slice(0, 8).map(bt => <Item key={bt.id} icon="ti-flag" label={bt.name} onClick={()=>onLinkAsDeadline(bt.id)} />)}
                </>)}
              </>)}
              <Sep />
              <Item icon="ti-settings" label="Manage meeting calendars…" onClick={onAddMeetingCalendar} />
            </div>
          )}
        </div>
        <Sep />
        {/* B2671196 ×2 — the ONLY way to give a task its first icon (the hover "add" glyph and the empty slot are gone). Every row, phase or leaf. */}
        <Item icon="ti-icons"             label={hasIcons ? "Change icon…" : "Set icon…"} onClick={onSetIcon} />
        {hasIcons && <Item icon="ti-icons-off" label="Remove icon" onClick={onRemoveIcon} />}
        <Sep />
        <Item icon="ti-copy"              label="Duplicate Row"                 onClick={onDuplicate} />
        <Item icon="ti-scissors"          label="Cut"               hint="Ctrl+X" onClick={onCutTask} />
        <Item icon="ti-files"             label="Copy"              hint="Ctrl+C" onClick={onCopyTaskFull} />
        <Item icon="ti-clipboard"         label="Paste Below"       hint="Ctrl+V" onClick={onPasteTask} disabled={!hasClipboard} />
        <Sep />
        <Item icon="ti-indent-increase"   label="Indent →"          hint="Alt⇧→" onClick={onIndent} />
        <Item icon="ti-indent-decrease"   label="Outdent ←"         hint="Alt⇧←" onClick={onOutdent} disabled={!canOutdent} />
        <Item icon="ti-folder-symlink"    label="Move to…"                      onClick={onMoveTo} />
        <Sep />
        <Item icon="ti-trash"             label={deleteCount > 1 ? `Delete ${deleteCount} Rows` : "Delete Row"} danger onClick={onDelete} />
      </div>
    </>,
    document.body
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  SwatchGrid: [() => SwatchGrid],
  CaretPopover: [() => CaretPopover],
  FormatMiniToolbar: [() => FormatMiniToolbar],
  TaskContextMenu: [() => TaskContextMenu],
});
