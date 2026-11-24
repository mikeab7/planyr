import { HDARK, HEALTH, NO_AUTOFILL } from "../common.jsx";
import { exposeToHarness } from "../harnessGlobals.js";


// ── Task-complete celebration ("Ring & Spark" toast) ──────
// A small toast rises from the bottom-center when a task transitions to
// Complete: the green dot pops in, the check draws itself, a ring pulses
// outward, and a few sparks fan up — then it sinks away after ~2.3s.
// Bottom-anchored (not in the row) so it stays visible even when the
// successor prompt modal opens; z-index above all modals, pointer-events:none
// so it never blocks a click. Pure Web Animations API on a body-level node —
// survives React re-renders. A new completion replaces the previous toast.
export function celebrateTaskComplete(taskName) {
  try {
    document.getElementById("planar-celebrate-toast")?.remove();
    document.getElementById("planar-delete-toast")?.remove(); // same anchor spot — never stack
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const toast = document.createElement("div");
    toast.id = "planar-celebrate-toast";
    // env(safe-area-inset-bottom) keeps it clear of the iPhone home bar
    toast.style.cssText = "position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:100002;pointer-events:none;";

    const card = document.createElement("div");
    card.style.cssText = "display:flex;align-items:center;gap:11px;background:var(--bg);border:1px solid #d0d7de;border-radius:10px;padding:10px 16px 10px 13px;box-shadow:0 6px 24px rgba(27,31,36,.16),0 1px 3px rgba(27,31,36,.08);font-family:'Inter',system-ui,-apple-system,sans-serif;";
    toast.appendChild(card);

    // Dot + ring + sparks share one positioning context; nothing in the
    // ancestor chain clips, so sparks can fly past the card's top edge.
    const dotWrap = document.createElement("span");
    dotWrap.style.cssText = "position:relative;width:20px;height:20px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;";
    const ring = document.createElement("span");
    ring.style.cssText = "position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2px solid #16a34a;opacity:0;";
    const dot = document.createElement("span");
    dot.style.cssText = "position:relative;width:20px;height:20px;border-radius:50%;background:#16a34a;display:inline-flex;align-items:center;justify-content:center;";
    dot.innerHTML = '<svg width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M3 6.7 L5.5 9.2 L10 3.8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray:14;stroke-dashoffset:14;"/></svg>';
    dotWrap.appendChild(ring);
    dotWrap.appendChild(dot);
    card.appendChild(dotWrap);

    // textContent (not innerHTML) so task names can never inject markup
    const text = document.createElement("span");
    const nameEl = document.createElement("div");
    nameEl.style.cssText = "font-size:12.5px;font-weight:600;color:#1f2328;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35;";
    nameEl.textContent = (taskName || "Task").toString();
    const subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;font-weight:500;color:#15803d;line-height:1.35;";
    subEl.textContent = "Marked complete";
    text.appendChild(nameEl); text.appendChild(subEl);
    card.appendChild(text);

    document.body.appendChild(toast);

    const chk  = dot.querySelector("path");
    const LIFE = 2300; // ms fully visible before the exit begins
    const exit = (dur) => {
      toast.animate(
        [{transform:"translateX(-50%) translateY(0)", opacity:1},
         {transform:"translateX(-50%) translateY(10px)", opacity:0}],
        {duration:dur, easing:"cubic-bezier(.4,0,1,1)", fill:"forwards"}
      );
      setTimeout(() => toast.remove(), dur + 30);
    };

    if (reduce) {
      // Reduced motion: keep the informative toast, drop the theatrics
      if (chk) chk.style.strokeDashoffset = "0";
      toast.animate([{opacity:0},{opacity:1}], {duration:150, fill:"forwards"});
      setTimeout(() => exit(200), LIFE);
      return;
    }

    // Entry: rise with a slight overshoot
    toast.animate(
      [{transform:"translateX(-50%) translateY(16px)", opacity:0},
       {transform:"translateX(-50%) translateY(-2px)", opacity:1, offset:.7},
       {transform:"translateX(-50%) translateY(0)",    opacity:1}],
      {duration:300, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"}
    );
    // Dot pops into existence
    dot.animate(
      [{transform:"scale(.4)"},{transform:"scale(1.28)",offset:.55},{transform:"scale(.95)",offset:.8},{transform:"scale(1)"}],
      {duration:420, delay:90, easing:"cubic-bezier(.34,1.56,.64,1)", fill:"backwards"}
    );
    // Check draws in (style fallback in case WAAPI can't tween SVG dashoffset)
    if (chk) {
      chk.animate([{strokeDashoffset:14},{strokeDashoffset:0}], {duration:320, delay:200, easing:"cubic-bezier(.65,0,.35,1)", fill:"forwards"});
      setTimeout(() => { chk.style.strokeDashoffset = "0"; }, 540);
    }
    // Ring pulses outward
    ring.animate(
      [{transform:"scale(.9)", opacity:.55},{transform:"scale(2.6)", opacity:0}],
      {duration:620, delay:160, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"}
    );
    // Sparks fan upward out of the card
    const colors = ["#16a34a","#22c55e","#4f46e5","#16a34a","#34d399","#4f46e5"];
    const N = 6;
    for (let i = 0; i < N; i++) {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:${colors[i % colors.length]};opacity:0;`;
      dotWrap.appendChild(s);
      const ang  = (-90 + (i / (N - 1) - 0.5) * 150) * Math.PI / 180; // fan upward
      const dist = 22 + Math.random() * 14;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      s.animate(
        [{transform:"translate(0,0) scale(1)",                       opacity:1},
         {transform:`translate(${dx*.55}px,${dy*.55}px) scale(.7)`,  opacity:1, offset:.4},
         {transform:`translate(${dx}px,${dy}px) scale(.35)`,         opacity:0}],
        {duration:580, delay:170, easing:"cubic-bezier(.18,.7,.3,1)", fill:"forwards"}
      );
    }
    setTimeout(() => exit(240), LIFE);
  } catch (e) { /* celebration is decorative — never let it break a real update */ }
}

// ── Row-deletion toast ────────────────────────────────────
// Confirmation that rows were removed, in the same bottom-center style as the
// completion toast. Shows how many rows went (and, when parents were swept,
// how many tasks total including subtasks) plus a Ctrl+Z reminder — deletes
// flow through setData, so the existing undo history restores them fully.
export function notifyRowsDeleted(rowCount, totalCount) {
  try {
    document.getElementById("planar-delete-toast")?.remove();
    document.getElementById("planar-celebrate-toast")?.remove(); // same anchor spot — never stack
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const toast = document.createElement("div");
    toast.id = "planar-delete-toast";
    toast.style.cssText = "position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:100002;pointer-events:none;";
    const card = document.createElement("div");
    card.style.cssText = "display:flex;align-items:center;gap:11px;background:var(--bg);border:1px solid #d0d7de;border-radius:10px;padding:10px 16px 10px 13px;box-shadow:0 6px 24px rgba(27,31,36,.16),0 1px 3px rgba(27,31,36,.08);font-family:'Inter',system-ui,-apple-system,sans-serif;";
    toast.appendChild(card);

    const dot = document.createElement("span");
    dot.style.cssText = "width:20px;height:20px;border-radius:50%;background:#dc2626;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;";
    dot.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.4 H10"/><path d="M4.6 3.4 V2.4 A.7 .7 0 0 1 5.3 1.7 H6.7 A.7 .7 0 0 1 7.4 2.4 V3.4"/><path d="M3.1 3.4 L3.7 9.9 A.8 .8 0 0 0 4.5 10.6 H7.5 A.8 .8 0 0 0 8.3 9.9 L8.9 3.4"/><path d="M5.1 5.4 V8.6 M6.9 5.4 V8.6"/></svg>';
    card.appendChild(dot);

    const text = document.createElement("span");
    const nameEl = document.createElement("div");
    nameEl.style.cssText = "font-size:12.5px;font-weight:600;color:#1f2328;line-height:1.35;";
    nameEl.textContent = rowCount === 1 ? "1 row deleted" : `${rowCount} rows deleted`;
    const subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;font-weight:500;color:#57606a;line-height:1.35;";
    subEl.textContent = (totalCount > rowCount ? `${totalCount} tasks removed including subtasks · ` : "") + "Ctrl+Z to undo";
    text.appendChild(nameEl); text.appendChild(subEl);
    card.appendChild(text);

    document.body.appendChild(toast);

    const LIFE = 2600; // a touch longer than the celebration — it carries the undo hint
    const exit = (dur) => {
      toast.animate(
        [{transform:"translateX(-50%) translateY(0)", opacity:1},
         {transform:"translateX(-50%) translateY(10px)", opacity:0}],
        {duration:dur, easing:"cubic-bezier(.4,0,1,1)", fill:"forwards"}
      );
      setTimeout(() => toast.remove(), dur + 30);
    };
    if (reduce) {
      toast.animate([{opacity:0},{opacity:1}], {duration:150, fill:"forwards"});
      setTimeout(() => exit(200), LIFE);
      return;
    }
    toast.animate(
      [{transform:"translateX(-50%) translateY(16px)", opacity:0},
       {transform:"translateX(-50%) translateY(-2px)", opacity:1, offset:.7},
       {transform:"translateX(-50%) translateY(0)",    opacity:1}],
      {duration:280, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"}
    );
    setTimeout(() => exit(240), LIFE);
  } catch (e) { /* informational — never let the toast block a delete */ }
}

// ── Successor Prompt ──────────────────────────────────────
// NEW-1 — shared by both footer buttons (Skip, Update Successors) so "same size" is a single
// object, not two style literals kept in sync by hand.
const FOOTER_BTN_STYLE = {
  fontSize:12, width:150, height:34, display:'flex', alignItems:'center', justifyContent:'center',
  borderRadius:6, fontFamily:'inherit', fontWeight:600, cursor:'pointer',
  border:'1px solid #e5e7eb', background:'var(--bg)', color:'#374151',
};
export function SuccessorPromptModal({ prompt, updateTask, onClose, onOpenTask }) {
  const { completedTask, projId, projName, successors } = prompt;
  const readyToStart  = successors.filter(t => t.health === 'gray');
  const alreadyActive = successors.filter(t => t.health !== 'gray');

  const [pending, setPending] = React.useState(() => {
    const m = {};
    successors.forEach(t => { m[t.id] = t.health === 'gray' ? 'yellow' : null; });
    return m;
  });

  const changeCount = Object.values(pending).filter(v => v !== null).length;

  function apply() {
    Object.entries(pending).forEach(([tid, hk]) => {
      if (hk !== null) updateTask(Number(tid), { health: hk }, projId);
    });
    onClose();
  }

  function StatusPills({ task }) {
    const opts = [
      { k:'gray',   label:'Not Started' },
      { k:'yellow', label:'In Progress' },
      { k:'red',    label:'Needs Attn.' },
      { k:'green',  label:'Complete' },
    ];
    const cur = pending[task.id];
    const isGray = task.health === 'gray';
    return (
      <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',marginTop:6}}>
        {!isGray && (
          <button data-successor-pill="nochange" onClick={()=>setPending(p=>({...p,[task.id]:null}))}
            style={{fontSize:10,padding:'3px 8px',borderRadius:12,fontFamily:'inherit',cursor:'pointer',
              border: cur===null?'1.5px solid #6366f1':'1px solid #d1d5db',
              background:cur===null?'#eef2ff':'#f9fafb',
              color:cur===null?'#4f46e5':'#6b7280',fontWeight:cur===null?600:400}}>
            No change
          </button>
        )}
        {opts.map(o => {
          const h = HEALTH[o.k]||HEALTH.gray;
          const sel = pending[task.id]===o.k;
          return (
            <button key={o.k} data-successor-pill={o.k} onClick={()=>setPending(p=>({...p,[task.id]:o.k}))}
              style={{display:'flex',alignItems:'center',gap:5,fontSize:10,padding:'3px 9px',
                borderRadius:12,fontFamily:'inherit',cursor:'pointer',
                border: sel?`1.5px solid ${h.dot==='#ffffff'?'#d1d5db':h.dot}`:'1px solid #e5e7eb',
                background:sel?h.bar:'#f9fafb',
                color:sel?HDARK[o.k]:'#6b7280',fontWeight:sel?600:400}}>
              <span style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
                background:h.dot==='#ffffff'?'#d1d5db':h.dot}} />
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  function TaskRow({ task, accent }) {
    const h = HEALTH[task.health]||HEALTH.gray;
    return (
      <div data-successor-row={task.id} style={{padding:'10px 14px',borderRadius:7,marginBottom:8,
        background:accent?'#fafbff':'#f9fafb',
        border:`1px solid ${accent?'#e0e4f8':'#e5e7eb'}`}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div style={{fontWeight:500,fontSize:13,color:'#1f2328',flex:1,minWidth:0,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={task.name}>
            {task.name}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
            <span style={{width:7,height:7,borderRadius:'50%',
              background:h.dot==='#ffffff'?'#d1d5db':h.dot}} />
            <span style={{fontSize:10,color:'#6b7280',whiteSpace:'nowrap'}}>{h.label}</span>
          </div>
        </div>
        <StatusPills task={task} />
        {onOpenTask && (
          <div style={{marginTop:7}}>
            <span onClick={()=>onOpenTask(projId, task.id)}
              style={{fontSize:11,color:'#4f46e5',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:3,fontWeight:500}}>
              Open in Projects
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-successor-modal onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:'fixed',inset:0,zIndex:4000,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(15,23,42,.35)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 16px 48px rgba(0,0,0,.18)',
        width:480,maxWidth:'94vw',maxHeight:'82vh',display:'flex',flexDirection:'column',overflow:'hidden'}}
        tabIndex={-1} ref={el=>el?.focus()}
        /* NEW-1 — Enter's meaning does not change: it applies `pending` exactly as it always has
         * (defaults every Ready-to-Start row to In Progress; that's the muscle memory the owner
         * keeps). Completing a successor goes through this SAME Enter/apply() path — pick the
         * Complete pill on its row, then Enter — there is no second accept mechanism here.
         * ⛔ The former "Mark Complete" bulk button and its Ctrl/Cmd+Enter twin were removed as a
         * redundant third footer control (the Complete pill already does the job); do not re-add a
         * second Enter-adjacent accept key without re-reading B463920 first — the
         * overlayAtKeyStartRef latch only needs ONE thing to stay true: a keystroke that dismisses
         * this modal must never read as "no overlay was open" to the grid's own key handler. */
        onKeyDown={e=>{
          if (e.key==='Escape') { onClose(); return; }
          if (e.key==='Enter' && changeCount>0) apply();
        }}>
        {/* Header */}
        <div style={{padding:'18px 20px 14px',borderBottom:'1px solid #e5e7eb',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:'#dcfce7',flexShrink:0,
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:600,color:'#16a34a',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:2}}>Task Completed</div>
                <div style={{fontSize:14,fontWeight:600,color:'#1f2328',maxWidth:340,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={completedTask.name}>{completedTask.name}</div>
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,padding:'4px',borderRadius:4,lineHeight:1,flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.color='#374151'} onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>✕</button>
          </div>
          <div style={{fontSize:11,color:'#6b7280',marginTop:8,paddingLeft:42}}>
            {projName} · {successors.length} successor{successors.length!==1?'s':''} to review
          </div>
        </div>
        {/* Body */}
        <div style={{flex:1,overflowY:'auto',padding:'14px 20px'}}>
          {readyToStart.length>0 && (<>
            <div style={{fontSize:10,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'#6366f1'}} /> Ready to Start
            </div>
            {readyToStart.map(t=><TaskRow key={t.id} task={t} accent={true}/>)}
          </>)}
          {alreadyActive.length>0 && (<>
            <div style={{fontSize:10,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8,marginTop:readyToStart.length?12:0,display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:'#9ca3af'}} /> Already Active
            </div>
            {alreadyActive.map(t=><TaskRow key={t.id} task={t} accent={false}/>)}
          </>)}
        </div>
        {/* Footer — NEW-1: back to TWO buttons, same width/weight/height (FOOTER_BTN_STYLE). The
            owner flagged the three-button footer as "horrible UI" — the removed "Mark Complete"
            button was redundant with the Complete pill two lines up (pick Complete on the pill,
            press Update Successors — same outcome), and having it as its own control broke the
            row's visual balance. Completing a successor is still one click away; it just no
            longer gets its own footer button. */}
        <div style={{padding:'12px 20px',borderTop:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,background:'#f9fafb',flexShrink:0}}>
          <span style={{fontSize:11,color:'#9ca3af',marginRight:'auto'}}>
            {changeCount>0?`${changeCount} update${changeCount!==1?'s':''} pending`:'No changes'}
          </span>
          <button data-successor-apply="skip" onClick={onClose} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Skip
          </button>
          <button data-successor-apply="update" onClick={apply} disabled={!changeCount}
            title="Applies the status picked for each row above · Enter"
            style={{...FOOTER_BTN_STYLE,
              cursor:changeCount?'pointer':'default',
              border:changeCount?'1px solid #4f46e5':'1px solid #e5e7eb',
              background:changeCount?'#4f46e5':'#f3f4f6',
              color:changeCount?'#fff':'#9ca3af'}}>
            Update Successors
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete-with-children prompt ────────────────────────────
// Owner correction (verbatim): don't silently cascade, don't silently promote — ask, with exactly
// two choices plus Cancel, and "the action buttons must be the same size as each other" (his
// standing complaint about the successor modal above, before that one was fixed). Reuses
// FOOTER_BTN_STYLE directly rather than a look-alike copy, so equal sizing is the SAME shared
// object, not two literals that could drift apart independently — measured in
// ui-audit/verify-schedule-indent-outdent-delete.mjs via getBoundingClientRect on all three.
export function DeleteChildrenModal({ rowCount, totalCount, onCascade, onPromote, onCancel }) {
  const subtaskCount = totalCount - rowCount;
  const title = rowCount > 1 ? `Delete ${rowCount} tasks?` : "Delete this task?";
  const body = rowCount > 1
    ? `${subtaskCount} subtask${subtaskCount !== 1 ? "s" : ""} would come with ${rowCount > 1 ? "them" : "it"}.`
    : `This task has ${subtaskCount} subtask${subtaskCount !== 1 ? "s" : ""}.`;
  return (
    <div data-delete-children-modal onMouseDown={e=>{if(e.target===e.currentTarget)onCancel();}}
      style={{position:'fixed',inset:0,zIndex:4000,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(15,23,42,.35)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 16px 48px rgba(0,0,0,.18)',
        width:460,maxWidth:'94vw',display:'flex',flexDirection:'column',overflow:'hidden'}}
        tabIndex={-1} ref={el=>el?.focus()}
        onKeyDown={e=>{ if (e.key==='Escape') onCancel(); }}>
        <div style={{padding:'18px 20px 14px',borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontSize:14,fontWeight:600,color:'#1f2328'}}>{title}</div>
          <div style={{fontSize:12,color:'#6b7280',marginTop:6}}>
            {body} Delete them too, or keep them — they'll move up to this task's parent, in the same order.
          </div>
        </div>
        <div style={{padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,background:'#f9fafb'}}>
          <button data-delete-children-choice="cancel" onClick={onCancel} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Cancel
          </button>
          <button data-delete-children-choice="promote" onClick={onPromote} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Keep subtasks
          </button>
          <button data-delete-children-choice="cascade" onClick={onCascade}
            style={{...FOOTER_BTN_STYLE, border:'1px solid #dc2626', background:'#dc2626', color:'#fff'}}>
            Delete all {totalCount}
          </button>
        </div>
      </div>
    </div>
  );
}

// NEW-ROWMOVE — "Move to…": names the destination instead of aiming a drag at it, so it works
// whether or not the target group is expanded or even on screen. Steel-manned against drag for the
// owner's actual scenario (gathering scattered permitting/entitlement tasks into a Phase 2 group he
// just created): drag needs the destination visible and needs a precise drop; this needs only its
// name, typed once per task moved. Ships alongside drag rather than instead of it — drag is still
// the better tool for a quick local reorder.
export function MoveToModal({ tasks, sourceIds, onCommit, onCancel }) {
  const [query, setQuery] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  // Every task the moved block can legally land under: everything EXCEPT the moved rows themselves
  // and any of their own descendants (moveSelectionToDestination refuses those anyway — filtering
  // here just keeps the list from offering a destination that would be rejected on commit).
  const blocked = React.useMemo(() => {
    const b = new Set(sourceIds);
    let grew = true;
    while (grew) { grew = false; tasks.forEach(t => { if (t.parentId != null && b.has(t.parentId) && !b.has(t.id)) { b.add(t.id); grew = true; } }); }
    return b;
  }, [tasks, sourceIds]);

  // Depth-labeled list for every candidate, walked WITHOUT the isExpanded gate (unlike
  // flatOrderWithLevel) — a collapsed destination must still be searchable and pickable by name.
  const options = React.useMemo(() => {
    const kidsBy = new Map();
    tasks.forEach(t => { const p = t.parentId ?? null; if (!kidsBy.has(p)) kidsBy.set(p, []); kidsBy.get(p).push(t); });
    const out = [];
    const walk = (parentId, level) => (kidsBy.get(parentId) || []).forEach(t => { if (!blocked.has(t.id)) out.push({ id: t.id, name: t.name || `Task ${t.id}`, level }); walk(t.id, level + 1); });
    walk(null, 0);
    const q = query.trim().toLowerCase();
    const filtered = q ? out.filter(o => o.name.toLowerCase().includes(q)) : out;
    return [{ id: null, name: "— Top level —", level: 0 }, ...filtered];
  }, [tasks, blocked, query]);

  const commit = (id) => { if (id !== undefined) onCommit(id, "end"); };
  return (
    <div data-move-to-modal onMouseDown={e=>{if(e.target===e.currentTarget)onCancel();}}
      style={{position:'fixed',inset:0,zIndex:4000,display:'flex',alignItems:'center',
        justifyContent:'center',background:'rgba(15,23,42,.35)'}}>
      <div style={{background:'var(--bg)',borderRadius:12,boxShadow:'0 16px 48px rgba(0,0,0,.18)',
        width:420,maxWidth:'94vw',maxHeight:'70vh',display:'flex',flexDirection:'column',overflow:'hidden'}}
        tabIndex={-1}
        onKeyDown={e=>{
          if (e.key === 'Escape') { onCancel(); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(options.length - 1, h + 1)); return; }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(0, h - 1)); return; }
          if (e.key === 'Enter')    { e.preventDefault(); commit(options[hi]?.id); return; }
        }}>
        <div style={{padding:'14px 16px 10px',borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontSize:14,fontWeight:600,color:'#1f2328',marginBottom:8}}>
            Move {sourceIds.length > 1 ? `${sourceIds.length} tasks` : "task"} to…
          </div>
          <input {...NO_AUTOFILL} ref={inputRef} value={query} onChange={e=>{setQuery(e.target.value); setHi(0);}}
            placeholder="Search tasks…" style={{width:'100%',boxSizing:'border-box',fontSize:13,padding:'7px 9px',
            border:'1px solid #d1d5db',borderRadius:6,outline:'none',fontFamily:'inherit'}} />
        </div>
        <div style={{overflow:'auto',flex:1,padding:'4px 0'}}>
          {options.length === 1 && <div style={{padding:'10px 16px',fontSize:12,color:'#9ca3af'}}>No matching tasks</div>}
          {options.map((o, i) => (
            <div key={o.id ?? '__top'} data-move-to-option={o.id ?? "top"} onMouseEnter={()=>setHi(i)} onClick={()=>commit(o.id)}
              style={{padding:'6px 14px',paddingLeft:14 + o.level * 16,fontSize:13,cursor:'pointer',
                background: i === hi ? '#eff6ff' : 'transparent', color: o.id === null ? '#4b5563' : '#1f2328',
                fontStyle: o.id === null ? 'italic' : 'normal', whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {o.name}
            </div>
          ))}
        </div>
        <div style={{padding:'10px 16px',display:'flex',justifyContent:'flex-end',gap:8,background:'#f9fafb',borderTop:'1px solid #e5e7eb'}}>
          <button onClick={onCancel} style={FOOTER_BTN_STYLE}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#6b7280'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e5e7eb'}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  celebrateTaskComplete: [() => celebrateTaskComplete],
  notifyRowsDeleted: [() => notifyRowsDeleted],
  FOOTER_BTN_STYLE: [() => FOOTER_BTN_STYLE],
  SuccessorPromptModal: [() => SuccessorPromptModal],
  DeleteChildrenModal: [() => DeleteChildrenModal],
  MoveToModal: [() => MoveToModal],
});
