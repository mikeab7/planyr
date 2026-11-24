import { ROW_H } from "../layout.js";
import { fmtD, toShortDate } from "../../../../shared/schedule/engine/tasks.js";
import { ContactPicker, DepCell, HEALTH, NO_AUTOFILL } from "../common.jsx";
import { ownerDisplayParts, ownerListOf } from "../../../../shared/schedule/engine/owners.js";
import { durTooltip, fmtPreds, fmtTaskDuration, normPreds, taskDurUnit, taskDurValue } from "../../../../shared/schedule/engine/predecessors.js";
import { MEETING_BODY_INDEX, agendaLeadSummary, cadenceSummary, dropDuplicateLagPatch, findMeetingBodyElsewhere, meetingBindingTrace, meetingBoundInfo, meetingCostDays, meetingDoubleLagFlag, meetingFloatBD, startIsPinned, unpinStartPatch } from "../../../../shared/schedule/engine/meetings.js";
import { fdLocal } from "../../../../shared/schedule/engine/calendar.js";
import { effectivePercentComplete } from "../../../../shared/schedule/healthEngine.js";
import { focusChipTitle, rowCanFocus, stepVisibleColIdx } from "./gridNav.js";
import { HealthPicker, PhaseIconSummary, PredEditor, StatusPicker, TaskIconSlot, predLagPlainEnglish, taskIconsW } from "./pickers.jsx";
import { exposeToHarness } from "../harnessGlobals.js";


export function Cell({task, col, colMasterIdxs, edit, setEdit, commit, commitAndAdvance, applyCommit, proj, succMap, getTaskName, setNotesCtx, projId, updateTask, editStartChar, isExpandedParent, dispHealth, setSelectedColIdx, contacts, addContact, formulaCell, expandAnchorRef, data}) {
  // B212 — Tab/Shift+Tab while editing advance only through VISIBLE columns (display order),
  // skipping hidden ones, via the shared stepVisibleColIdx helper.
  const tabStep = back => setSelectedColIdx(i => stepVisibleColIdx(colMasterIdxs, i, back ? -1 : +1));
  // NEW-2 — this cell's own per-column format entry (bold/italic/fill/underline/color/size).
  // `s` is fresh per (task, col) — folding cf.size/color/underline in here reaches every case
  // below that spreads {...s} without itself re-asserting a fixed fontSize/color (the same
  // partial reach bold/italic already have via the wrapper's cascade — cases with their own
  // semantic color, like a conflict date's red, keep it, same as they already keep their own
  // fontWeight over a cellFmt.bold cascade).
  const cf = task.cellFmt?.[col.k];
  const s = {fontSize:cf?.size || 12,padding:"0 8px",height:ROW_H,display:"flex",alignItems:"center",overflow:"hidden",whiteSpace:"nowrap",
    color: cf?.color || undefined, textDecoration: cf?.underline ? "underline" : undefined};
  const mono = {fontFamily:"'Inter',system-ui,sans-serif"};

  // B583 — Formula column: a derived, read-only display value computed by GridView
  // (after the date cascade). Errors render in red with the Excel-style code + tooltip;
  // a healthy value renders right-aligned like the other computed/number columns.
  if (col.t === "formula") {
    const fc = formulaCell;
    if (!fc || fc.display === "" || fc.display == null) return <span style={{...s, justifyContent:"flex-end", color:"var(--mut)"}} />;
    if (!fc.ok) return (
      <span style={{...s, ...mono, justifyContent:"flex-end", color:"var(--danger, #d83a3a)", fontSize:11, fontWeight:600}}
        title={(fc.detail ? fc.error + " — " + fc.detail : fc.error)}>{fc.display}</span>
    );
    return <span style={{...s, ...mono, justifyContent:"flex-end", color:"var(--txt)", fontSize:11}} title={fc.display}>{fc.display}</span>;
  }

  // Picker columns (health/status) are NEVER text-editable — their popover IS the editor.
  // If something accidentally sets edit to a picker column, ignore it (don't render as input).
  const isPickerCol = col.k === "health" || col.k === "status";
  const isEdit = !isPickerCol && edit?.taskId === task.id && edit?.col === col.k;

  if (isEdit) {
    // Parent tasks: start/end/duration are computed from children — never editable
    const isParentDateLocked = task.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
    if (!isParentDateLocked) {
      // Date columns: plain text input accepting "5/7", "5/7/26", "5/7/2026"
      if (col.t==="date") {
        const seedVal = editStartChar != null ? editStartChar : toShortDate(task[col.k]);
        return (
          <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="M/D or M/D/YY"
            style={{textAlign:"center", fontSize:11}}
            defaultValue={seedVal}
            onBlur={e => commit(task.id, col.k, e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(task.id, col.k, e.target.value); return; }
              if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
              if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(task.id, col.k, e.target.value); tabStep(e.shiftKey); }
            }} />
        );
      }
      // Task name: match the level-based font size, weight, and indentation of the
      // display text so the row doesn't visibly resize when you start editing.
      // Also honor per-task bold/italic overrides so editing matches the displayed style.
      if (col.k === "name") {
        const ls = [{fontSize:13,fontWeight:600},{fontSize:12,fontWeight:500},{fontSize:11.5,fontWeight:400},{fontSize:11,fontWeight:400}][Math.min(task.level,3)];
        const seedVal = editStartChar != null ? editStartChar : (task.name ?? "");
        const cf = task.cellFmt?.name;
        const fw = (task.bold || cf?.bold) ? 700 : ls.fontWeight;
        const fs = (task.italic || cf?.italic) ? "italic" : "normal";
        // NEW-2 — size/color/underline follow the SAME cell-overrides-row-overrides-default
        // precedence as fw/fs above, just for a value instead of a boolean (?? rather than ||).
        const fSize = cf?.size ?? task.fontSize ?? ls.fontSize;
        const fColor = cf?.color ?? task.textColor ?? undefined;
        const fUnderline = (task.underline || cf?.underline) ? "underline" : "none";
        return (
          <input {...NO_AUTOFILL} autoFocus className="ei"
            defaultValue={seedVal}
            style={{fontSize:fSize, fontWeight:fw, fontStyle:fs, color:fColor, textDecoration:fUnderline, paddingLeft:20+taskIconsW(window.PlanyrTaskIcons.normalizeTaskIcons(task.icons).length)+task.level*14}}
            onFocus={e => { if (editStartChar == null) e.target.select(); }}
            onBlur={e => commit(task.id, "name", e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(task.id, "name", e.target.value); return; }
              if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
              if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(task.id, "name", e.target.value); tabStep(e.shiftKey); }
            }} />
        );
      }
      // Owner / responsible party: an ORDERED LIST of contacts (NEW-1) — chips + autocomplete.
      // Typing a first character NEVER replaces the existing owners any more (that was the single-
      // value picker's "select-all, then type replaces" behavior) — it seeds the NEXT chip instead,
      // so a quick keystroke can only ADD an owner, never silently wipe the others.
      if (col.k === "responsibleParty") {
        return (
          <ContactPicker
            variant="grid"
            owners={ownerListOf(task)}
            seedText={editStartChar != null ? editStartChar : ''}
            contacts={contacts || []}
            onOwnersChange={(names, newContacts) => {
              (newContacts || []).forEach(nc => addContact && addContact(nc));
              applyCommit(task.id, "responsibleParty", names);
            }}
            onClose={() => setEdit(null)}
          />
        );
      }
      // For all other editable inputs, seed with the typed char if available, else existing value
      const seedVal = editStartChar != null
        ? editStartChar
        : col.k==="predecessors" ? fmtPreds(task.predecessors) : (task[col.k] ?? "");
      // Predecessors get a richer editor: a live plain-English readback + the calendar-days ('cd') hint.
      if (col.k === "predecessors") {
        return <PredEditor seedVal={seedVal} taskId={task.id} colKey={col.k}
          commit={commit} commitAndAdvance={commitAndAdvance} setEdit={setEdit} tabStep={tabStep} />;
      }
      return (
        <input {...NO_AUTOFILL} autoFocus className="ei"
          placeholder={col.k==="duration" ? "e.g. 10d, 3w, 30cd, 2mo" : undefined}
          style={(col.k==="duration"||col.k==="percentComplete") ? {textAlign:"center", fontSize:11} : undefined}
          defaultValue={seedVal}
          onBlur={e => commit(task.id, col.k, e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter")  { e.nativeEvent.stopImmediatePropagation(); commitAndAdvance(task.id, col.k, e.target.value); return; }
            if (e.key === "Escape") { e.nativeEvent.stopImmediatePropagation(); setEdit(null); return; }
            if (e.key === "Tab")    { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); commit(task.id, col.k, e.target.value); tabStep(e.shiftKey); }
          }} />
      );
    }
    // isParentDateLocked: fall through to display rendering below
  }

  switch(col.k) {
    case "id": {
      // Compact format-override indicators next to the ID: small color square left of
      // the number when a fill is set, tiny B/I letter badges right of it when those
      // toggles are on. Lets users scan the ID column to spot formatted rows without
      // opening the right-click menu.
      const hasCellFmt = !!(task.cellFmt && Object.keys(task.cellFmt).length);
      const hasFmt = !!task.rowColor || !!task.bold || !!task.italic || !!task.underline || !!task.textColor || !!task.fontSize || hasCellFmt;
      const fmtSummary = hasFmt
        ? `Formatted: ${[task.rowColor && "fill color", task.bold && "bold", task.italic && "italic", task.underline && "underline", task.textColor && "text color", task.fontSize && "text size", hasCellFmt && "cell formats"].filter(Boolean).join(", ")}`
        : "Click to select row";
      return (
        // B<NEW> — paddingLeft was 4 while the drag grip (a separate absolutely-positioned
        // overlay, left:0 width:8) sits on top of it, so the number's own left edge landed
        // UNDER the grip icon with no visible gap ("crab icon" — voice transcription for
        // GRAB icon — "butted right up against the number", owner report 2026-08-25). 12
        // clears the grip's 8px strip plus a small breathing gap, without touching the
        // grip's hit area (still exactly 8px, pointer-events always on — CHROME-NEVER-
        // EATS-A-PRESS: widening the grip itself previously broke row-range select).
        <span title={fmtSummary} style={{...s,...mono,color:"var(--mut)",fontSize:11,cursor:"pointer",userSelect:"none",display:"flex",alignItems:"center",gap:3,paddingLeft:12}}>
          {task.rowColor && <span style={{width:7,height:7,borderRadius:1.5,background:task.rowColor,border:"1px solid rgba(0,0,0,0.2)",flexShrink:0}} />}
          <span>{task.id}</span>
          {task.bold && <span style={{fontSize:8.5,fontWeight:800,color:"#4f46e5",lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>B</span>}
          {task.italic && <span style={{fontSize:8.5,fontWeight:700,fontStyle:"italic",color:"#4f46e5",lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>I</span>}
          {task.underline && <span style={{fontSize:8.5,fontWeight:700,textDecoration:"underline",color:"#4f46e5",lineHeight:1,fontFamily:"'Inter',system-ui,sans-serif"}}>U</span>}
        </span>
      );
    }
    case "name": return (
      <span style={{...s,paddingLeft:4+task.level*14,gap:0,flex:1,minWidth:0}}>
        {proj?.tasks.some(t=>t.parentId===task.id) ? (
          <span
            className="ti-chev"
            onClick={e=>{
              e.stopPropagation();
              const opening = !task.isExpanded;
              // B463922 (×2) — tell GridView's scroll-anchor effect this row is the one whose
              // reveal the click was FOR, so a stale selection elsewhere can't outrank it and
              // throw the new children off screen. Expand only: a collapse never needs this.
              if (opening && expandAnchorRef) expandAnchorRef.current = task.id;
              updateTask(task.id,{isExpanded:opening});
            }}
            /* B463922 — the click already refused to move the selection (stopPropagation), but the
               grid selects on MOUSEDOWN, so folding a group still stole the selection from the cell
               you were editing: every keystroke after it went to the group row instead, and the
               keep-the-selection-visible effect started chasing a row nobody was editing. Stop the
               press too, so showing/hiding a group is a view action and nothing more. */
            onMouseDown={e=>e.stopPropagation()}
            onDoubleClick={e=>e.stopPropagation()}
            title={task.isExpanded?"Collapse":"Expand"}
            /* NEW-1 (task icons) — a real Tabler chevron (right when collapsed, down when open) replaces the text-glyph
               triangle in a bordered box. Same element, title and handlers, so every harness that finds the toggle still does. */
            style={{
              cursor:"pointer",flexShrink:0,
              width:16,height:ROW_H - 2,
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              borderRadius:3,
              color:task.isExpanded?"var(--blue)":"var(--mut)",
              userSelect:"none",
            }}
          >
            <i className={"ti " + (task.isExpanded ? "ti-chevron-down" : "ti-chevron-right")} aria-hidden="true" style={{fontSize:14,lineHeight:1}} />
          </span>
        ) : (
          <span style={{width:16,flexShrink:0,display:"inline-block"}} />
        )}
        <TaskIconSlot task={task} updateTask={updateTask} />
        {(() => { const ls=[{fontSize:13,fontWeight:600},{fontSize:12,fontWeight:500},{fontSize:11.5,fontWeight:400},{fontSize:11,fontWeight:400}][Math.min(task.level,3)]; const cf = task.cellFmt?.name; const isEmpty = !task.name; const fw = (task.bold || cf?.bold) ? 700 : ls.fontWeight; const fs = (task.italic || cf?.italic || isEmpty) ? "italic" : "normal";
          // NEW-2 — same cell-overrides-row-overrides-default precedence as fw/fs, for a value not a boolean.
          const fSize = cf?.size ?? task.fontSize ?? ls.fontSize; const fColor = cf?.color ?? task.textColor; const fUnderline = (task.underline || cf?.underline) ? "underline" : "none"; return (
          <span title={task.name || undefined} data-task-name style={{overflow:"hidden",textOverflow:"ellipsis",color:isEmpty?"var(--mut)":(fColor||"#1f2328"),fontStyle:fs,fontSize:fSize,fontWeight:fw,textDecoration:fUnderline,minWidth:0}}>
            {task.name || "New task"}
          </span>
        ); })()}
        {!task.isExpanded && task.hasChildren && <PhaseIconSummary tasks={proj?.tasks} taskId={task.id} />}
        {rowCanFocus(task) && (
          <span
            data-focus-chip={task.focused ? "on" : "off"}
            onClick={e=>{ e.stopPropagation(); updateTask(task.id, {focused: !task.focused}); }}
            onDoubleClick={e=>e.stopPropagation()}
            title={focusChipTitle(task)}
            style={{
              marginLeft:"auto", flexShrink:0, cursor:"pointer", userSelect:"none",
              display:"inline-flex", alignItems:"center", gap:5,
              fontSize:10, fontWeight:600, lineHeight:1, whiteSpace:"nowrap",
              color:"var(--mut)",
              padding:"2px 7px", borderRadius:10,
              background: task.focused ? "var(--surf)" : "transparent",
              border: `1px solid ${task.focused ? "var(--bd2)" : "transparent"}`,
              transition:"background .12s,border-color .12s",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="var(--surf)"; e.currentTarget.style.borderColor="var(--bd2)"; }}
            onMouseLeave={e=>{ if(!task.focused){ e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="transparent"; } }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.65,flexShrink:0}}>
              <path d="M3 5h18M6 12h12M10 19h4"/>
            </svg>
            {/* Status breakdown only when focused (children hidden); when expanded you can already see statuses */}
            {task.focused && task.hideableDone > 0 && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"#16a34a",flexShrink:0}} />
                {task.hideableDone}
              </span>
            )}
            {task.focused && task.hideablePaused > 0 && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"#9ca3af",flexShrink:0}} />
                {task.hideablePaused}
              </span>
            )}
            {task.focused && task.hideableUpcoming > 0 && (
              <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"var(--bg)",border:"1.5px solid #d1d5db",flexShrink:0}} />
                {task.hideableUpcoming}
              </span>
            )}
          </span>
        )}
      </span>
    );
    case "start": case "end": {
      const rawDate = task[col.k];
      if (!rawDate) return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)",fontSize:11}} />;
      const [y,m,d] = rawDate.split('-');
      const dateStr = String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2);
      // Start pin (existing) + Finish lock (B616) — one padlock, identical icon + interaction.
      const isStart = col.k === "start";
      const isPinned = !task.hasChildren && (isStart ? startIsPinned(task) : task.pinnedEnd);
      // B443250 — the start cell carries its own conflict: a pinned start EARLIER than the predecessor
      // chain allows. The pin still wins (that is the contract); this makes the override visible instead
      // of silently resolved, reusing B616's locked-finish treatment exactly.
      const isConflict = !task.hasChildren && (isStart ? !!task.startConflict : !!task.finishConflict);
      const unpin = e => {
        e.stopPropagation();
        if (isStart) updateTask(task.id, unpinStartPatch(task), projId);   // B2642096 ×2 — clears the stepped pin as well
        else         updateTask(task.id, {pinnedEnd: false, durValue: taskDurValue(task), durUnit: taskDurUnit(task)}, projId);  // unlock → finish flows from start + duration
      };
      return (
        <span style={{...s,...mono,justifyContent:"center",color: isConflict ? "var(--danger,#d83a3a)" : task.hasChildren ? "#94a3b8" : "var(--mut)",fontSize:11,fontWeight: isConflict ? 700 : undefined}}
          title={task.hasChildren ? "Computed from subtasks"
            : isConflict ? (isStart
                ? "Pinned start is earlier than the predecessors allow — the pin is winning and the dependency is being overridden. Unpin to follow the predecessors, or change the dependency."
                : "Locked finish can't be met — the predecessor chain needs more time. Move the finish, shorten the duration, or change the dependency.")
            : isPinned ? (isStart ? "Start pinned — click the lock to let the predecessor drive this date" : "Finish locked (hard constraint) — click the lock to let it flow from start + duration")
            : undefined}>
          {isConflict && <span style={{marginRight:2,flexShrink:0,fontSize:11}}>⚠</span>}
          {isPinned && (
            <span
              title={isStart ? "Pinned start — click to unpin and let the predecessor drive this date" : "Locked finish — click to unlock and let it flow from start + duration"}
              onClick={unpin}
              style={{display:"inline-flex",alignItems:"center",marginRight:3,cursor:"pointer",color: isConflict ? "var(--danger,#d83a3a)" : "var(--amber)",opacity:0.85,flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.opacity="1"}
              onMouseLeave={e=>e.currentTarget.style.opacity="0.85"}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
          )}
          {isStart && !task.hasChildren && task.meetingBound && MEETING_BODY_INDEX[task.meetingBodyId] && (() => {
            // B816 — the civic mark: a meeting calendar fixes this date (distinct from the padlock — a person
            // fixed this date). Three states track severity; clicking/hovering explains the row in plain English.
            const info = meetingBoundInfo(task);
            const color = info?.state === "danger" ? "var(--danger,#d83a3a)" : info?.state === "warning" ? "var(--warn-text,#b45309)" : "var(--mut)";
            const b = info?.body || {};
            // NEW-2 (B<PENDING>, 2026-09-23) — "how was this date reached": names the driving predecessor,
            // the lag it adds, the earliest-ready date that produces, and any of the body's own meetings
            // that were too early to make (skipped because their agenda deadline fell before that earliest
            // date) — READ-ONLY narration via meetingBindingTrace, never a second engine.
            const trace = meetingBindingTrace(task, id => (proj?.tasks || []).find(t => t.id === id), b);
            const traceLines = [];
            if (trace && trace.driver) {
              const { dep, predTask } = trace.driver;
              const typeWord = {FS:"finish-to-start", SS:"start-to-start", FF:"finish-to-finish", SF:"start-to-finish"}[(dep.type||"FS").toUpperCase()] || "finish-to-start";
              const lagPhrase = dep.lag ? `, plus a ${Math.abs(dep.lag)}-${dep.lagUnit === "calendar" ? "calendar" : "working"}-day lag (${typeWord}),` : ` (${typeWord}, no lag)`;
              traceLines.push(`Driven by "${predTask.name || "task " + predTask.id}", finishing ${fmtD(predTask.end || predTask.start)}${lagPhrase} ready no earlier than ${fmtD(trace.earliestDate)}.`);
              if (trace.skipped.length) traceLines.push(`Skipped ${trace.skipped.length === 1 ? "meeting" : "meetings"}: ${trace.skipped.map(sk => `${fmtD(sk.meetingDate)} (agenda closed ${fmtD(sk.deadline)}, before the packet was ready)`).join("; ")}.`);
            }
            const dupFlag = meetingDoubleLagFlag(task, b);
            const title = [
              `${b.name || "Meeting body"}${b.jurisdiction ? " · " + b.jurisdiction : ""}`,
              `Meets ${cadenceSummary(b)}; ${agendaLeadSummary(b)}.`,
              task.start ? `Hearing ${fmtD(task.start)} — file the agenda by ${fmtD(info?.deadline)}${b.cutoffTime ? " (" + b.cutoffTime + ")" : ""}.` : "No eligible meeting yet — waiting on a predecessor date.",
              ...traceLines,
              dupFlag ? "⚠ Possible double count: this task's own link lag and this calendar's filing lead look like they're counting the same wait — see the ⚠×2 mark on this row." : null,
              info?.state === "danger" ? (task.meetingDateOffCalendar
                ? "⚠ INFEASIBLE: this date isn't a scheduled meeting day for this body at all — roll to the next meeting or unpin."
                : "⚠ INFEASIBLE: this date is pinned but the agenda has already closed — roll to the next meeting or unpin.") :
                info?.state === "warning" ? `⚠ Only ${info.floatBD} working day(s) of float before the agenda deadline.` :
                "This is a meeting-calendar date: it can't be freely typed, has no duration, and slips by a full cycle if the deadline is missed.",
              b.verifiedOn ? `Calendar verified ${fmtD(b.verifiedOn)}.` : "Calendar is rule-derived (unverified).",
            ].filter(Boolean).join("\n");
            return (<>
              <span title={title} style={{display:"inline-flex",alignItems:"center",marginRight:3,color,flexShrink:0,cursor:"help"}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M4 10h16"/><path d="M12 3 3 8h18L12 3Z"/>
                </svg>
              </span>
              {dupFlag && (() => {
                // NEW-2 — the one-click fix: drops ONLY the flagged predecessor edge's lag (keeps the
                // edge + the binding), reversible with Ctrl+Z like any other edit, and never fires on
                // its own — it's a plain click handler on a visible, clearly-labelled mark.
                const fixTitle = `⚠ Possible double count: the ${dupFlag.lagN}-${dupFlag.unit}-day link lag and "${b.name || "this calendar"}"'s own ${dupFlag.leadN}-${dupFlag.unit}-day filing lead may both be counting the same wait, pushing this task out an extra meeting cycle.\nClick to drop the duplicate lag (keeps the predecessor link and the meeting binding). Undo with Ctrl+Z.`;
                return (
                  <span title={fixTitle}
                    onClick={e => { e.stopPropagation(); const patch = dropDuplicateLagPatch(task, dupFlag); if (patch) updateTask(task.id, {predecessors: patch}, projId); }}
                    style={{display:"inline-flex",alignItems:"center",marginRight:3,color:"var(--warn-text,#b45309)",flexShrink:0,cursor:"pointer"}}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"/>
                    </svg>
                  </span>
                );
              })()}
            </>);
          })()}
          {isStart && !task.hasChildren && task.meetingBound && !MEETING_BODY_INDEX[task.meetingBodyId] && (() => {
            // B864 — the binding points at a meeting calendar that no longer exists (a lost meeting body).
            // The normal civic mark above renders only when the body IS present, so without this the broken
            // binding is INVISIBLE. Surface it LOUDLY: a danger-toned calendar with an alert dot; its date is
            // held at the last known value (cascade soft-pins it) but won't update until the calendar returns.
            const title = [
              "⚠ Bound to a meeting calendar that no longer exists" + (task.meetingBodyId ? ` (id ${task.meetingBodyId})` : "") + ".",
              "Its date is held at the last known value but won't update on its own — this usually means the calendar was lost when another browser tab saved over it.",
              "Fix: re-create or re-select the calendar in Settings → Meeting Calendars, or unbind this task (right-click → Meeting binding).",
            ].join("\n");
            return (
              <span title={title} aria-label="Bound to a missing meeting calendar" style={{position:"relative",display:"inline-flex",alignItems:"center",marginRight:3,color:"var(--danger,#d83a3a)",flexShrink:0,cursor:"help"}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M4 10h16"/><path d="M12 3 3 8h18L12 3Z"/>
                </svg>
                <span aria-hidden style={{position:"absolute",top:-2,right:-2,width:5,height:5,borderRadius:"50%",background:"var(--danger,#d83a3a)"}}/>
              </span>
            );
          })()}
          {isStart && !task.hasChildren && task.deadlineForTaskId != null && (() => {
            // Deadline-row mark: this row always sits on its anchor's call/file-by date (one-way
            // derivation from the anchor's meeting binding — see the cascadeDates post-pass).
            const anchor = (proj?.tasks || []).find(a => a.id === task.deadlineForTaskId);
            const body = anchor ? MEETING_BODY_INDEX[anchor.meetingBodyId] : null;
            const color = task.deadlineInfeasible ? "var(--danger,#d83a3a)" : "var(--mut)";
            const title = [
              anchor ? `Deadline row for "${anchor.name || "task " + anchor.id}"${body && body.name ? ` (${body.name})` : ""}.` : "Deadline row — its anchor task is missing; the date no longer auto-updates.",
              body ? `Always sits ${agendaLeadSummary(body).replace("agenda due ", "")} the meeting — moves automatically when the meeting date moves.` : "",
              task.deadlineInfeasible ? "⚠ INFEASIBLE: this row's predecessors land AFTER the call/file-by date." : "",
            ].filter(Boolean).join("\n");
            return (
              <span title={title} style={{display:"inline-flex",alignItems:"center",marginRight:3,color,flexShrink:0,cursor:"help"}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/>
                </svg>
              </span>
            );
          })()}
          {dateStr}
        </span>
      );
    }
    case "meetingBody": {
      // B816 — bind a task to a meeting body (native select = robust, no popover positioning). Setting a
      // body makes the task a milestone that snaps to the body's cadence; clearing it returns it to normal.
      if (task.hasChildren) return <span style={{...s,justifyContent:"center",color:"#94a3b8"}} title="A summary/parent can't be meeting-bound">—</span>;
      if (task.deadlineForTaskId != null) {
        // A deadline row derives its date from its anchor's binding — not directly bindable here.
        const anchor = (proj?.tasks || []).find(a => a.id === task.deadlineForTaskId);
        const body = anchor ? MEETING_BODY_INDEX[anchor.meetingBodyId] : null;
        return <span style={{...s,fontSize:10,color:"var(--mut)"}} title={anchor ? `Deadline row for "${anchor.name || "task " + anchor.id}" — unlink via right-click to bind it directly` : "Deadline row (anchor missing)"}>deadline{body && body.name ? ` · ${body.name}` : ""}</span>;
      }
      const bodies = Array.isArray(proj?.meetingBodies) ? proj.meetingBodies : [];
      const cur = task.meetingBound ? (task.meetingBodyId || "") : "";
      const localMatch = cur ? bodies.find(b => b.id === cur) : null;
      // NEW-1 (B<PENDING>, 2026-09-23) — a task can be bound to a body that lives on a DIFFERENT
      // schedule (its id is globally unique — B816). The local `bodies` array can't name it, which
      // used to read as "set up…" (unbound) when this schedule has none of its own, or a blank
      // native <select> (no matching <option>) when it has some but not this one — either way an
      // actually-bound task read as unbound here. Resolve against every other schedule before
      // falling back to the old empty-state / select paths.
      const foreign = (task.meetingBound && cur && !localMatch) ? findMeetingBodyElsewhere(data, projId, cur) : null;
      if (task.meetingBound && !localMatch && foreign) {
        return (
          <span style={{...s,fontSize:10,color:"var(--txt)"}}
            title={`Bound to "${foreign.body.name || "Meeting body"}" from ${foreign.schedName} — right-click → Meeting binding to change it or copy it into this schedule.`}>
            {foreign.body.name || "Meeting body"} · {foreign.schedName}
          </span>
        );
      }
      if (task.meetingBound && !localMatch && !foreign) {
        return (
          <span style={{...s,fontSize:10,color:"var(--danger,#d83a3a)"}}
            title="Bound to a meeting calendar that no longer exists anywhere on the account — right-click → Meeting binding to unbind it.">
            ⚠ calendar missing
          </span>
        );
      }
      if (!bodies.length) return (
        <span style={{...s,justifyContent:"center",color:"var(--amber)",fontSize:10,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2}}
          title="Click to set up meeting calendars"
          onClick={e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent("planar-open-settings", {detail:"meetings"})); }}>set up…</span>);
      return (
        <span style={{...s,padding:0}} data-picker-cell={`meeting-${task.id}`}>
          <select value={cur}
            onClick={e => e.stopPropagation()}
            onChange={e => { const v = e.target.value; updateTask(task.id, v ? {meetingBound:true, meetingBodyId:v} : {meetingBound:false, meetingBodyId:null, pinnedMeetingDate:undefined}, projId); }}
            style={{width:"100%",fontSize:11,border:"none",background:"transparent",color: cur ? "var(--txt)" : "var(--mut)",cursor:"pointer",padding:"0 4px"}}>
            <option value="">— none —</option>
            {bodies.map(b => <option key={b.id} value={b.id}>{b.name || "Meeting body"}</option>)}
          </select>
        </span>
      );
    }
    case "floatToDeadline": {
      // B817 — working days from today to the agenda deadline. Blank on unbound rows.
      const fb = task.hasChildren ? null : meetingFloatBD(task, fdLocal(new Date()));
      if (fb == null) return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)"}} />;
      const c = fb < 0 ? "var(--danger,#d83a3a)" : fb <= 2 ? "var(--warn-text,#b45309)" : "var(--mut)";
      return <span style={{...s,...mono,justifyContent:"center",color:c,fontWeight: fb <= 2 ? 700 : undefined}}
        title="Float to deadline — working days from today until the agenda-submittal deadline (≤2 reads at-risk)">{fb}d</span>;
    }
    case "costIfMissed": {
      // B817 — calendar days the hearing slips if this deadline is missed (gap to the next eligible meeting).
      const cost = task.hasChildren ? null : meetingCostDays(task, MEETING_BODY_INDEX[task.meetingBodyId]);
      if (cost == null) return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)"}} />;
      return <span style={{...s,...mono,justifyContent:"center",color:"var(--mut)"}}
        title="Cost if missed — calendar days the hearing slips to the next eligible meeting (one day of slip is routinely a month)">+{cost}d</span>;
    }
    case "duration":
      return <span style={{...s,...mono,color: task.hasChildren ? "#94a3b8" : "var(--mut)"}}
        title={task.hasChildren ? "Computed from subtasks" : (durTooltip(task) || undefined)}>
        {fmtTaskDuration(task, task.hasChildren)}
      </span>;
    case "predecessors": {
      const preds = normPreds(task.predecessors);
      // B443249 — name the predecessors that drive nothing. `predUnresolved` is set by the cascade, so the
      // mark can never disagree with the engine that ignored them.
      const un = new Set(task.predUnresolved || []);
      const unNames = [...un].map(id => { const n = getTaskName(id); return n ? `${id} · ${n}` : `${id} (no longer in this schedule)`; });
      return <DepCell items={preds} renderLabel={p => fmtPreds([p])} renderName={p => getTaskName(p.id)} s={s}
        flagged={p => un.has(p.id)}
        title={unNames.length
          // NEW-1 — a flagged id can ALSO be one of this task's own ancestors (its summary row), never
          // just "no dates" — a summary's dates come FROM its tasks, so listing it back as a predecessor
          // is a cycle the app can't resolve and ignores, same as a dateless predecessor.
          ? `This date is NOT driven by ${unNames.length === 1 ? "" : "any of "}${unNames.join("; ")} — ${unNames.length === 1 ? "it has" : "they have"} no dates, or it's this task's own summary row (a cycle). The date shown comes from the remaining predecessors only.`
          : predLagPlainEnglish(fmtPreds(preds))} />;
    }
    case "successors": {
      const ids = succMap[task.id] || [];
      return <DepCell items={ids} renderLabel={id => String(id)} renderName={id => getTaskName(id)} s={s} />;
    }
    case "health": {
      if (isExpandedParent) return <span style={{...s, justifyContent:"center", padding:0}} />;
      return (
        <span style={{...s, justifyContent:"center", padding:0}} data-picker-cell={`health-${task.id}`}>
          <HealthPicker value={dispHealth || task.health} onChange={hk => commit(task.id, "health", hk)} />
        </span>
      );
    }
    case "status":
      if (isExpandedParent) return <span style={{...s, padding:"0 4px"}} />;
      return (
        <span style={{...s,padding:"0 4px"}} data-picker-cell={`status-${task.id}`}>
          <StatusPicker value={dispHealth || task.health} onChange={hk => commit(task.id, "status", hk)} />
        </span>
      );
    case "percentComplete":
      return (
        <span style={{...s,gap:6}}>
          <span style={{width:50,height:3,background:"#e2e8f0",borderRadius:2,overflow:"hidden",flexShrink:0}}>
            <span style={{width:`${effectivePercentComplete(task, proj?.tasks)}%`,height:"100%",background:(HEALTH[task.health]||HEALTH.gray).dot,display:"block"}} />
          </span>
          <span style={{...mono,fontSize:11,color:"var(--mut)"}} title={task.hasChildren ? "Rolled up from this row's tasks" : undefined}>{effectivePercentComplete(task, proj?.tasks)}%</span>
        </span>
      );
    case "responsibleParty": {
      // Match the neighboring data cells (dates, duration, notes): muted, 11px. NEW-1 — the column
      // must not widen, so a multi-owner task shows "First +N"; the full list is on hover.
      const { label, title } = ownerDisplayParts(ownerListOf(task));
      return <span title={title || undefined} style={{...s,color:"var(--mut)",fontSize:11}}>{label}</span>;
    }
    case "cost":
    case "budget":
    case "actualCost": {
      // B212 — Cost / Budget / Actual all render the same way: parents show the rolled sum
      // of their leaf values, leaves show their own; an empty value renders blank (never an
      // error), so the columns are safe to switch on for a project that tracks no money yet.
      const rolledKey = col.k==="cost" ? "rolledCost" : col.k==="budget" ? "rolledBudget" : "rolledActual";
      const v = task[rolledKey] ?? (Number(task[col.k]) || 0);
      const rolled = task.hasChildren;
      const tip = rolled ? "Sum of subtask "+(col.k==="cost"?"costs":col.k==="budget"?"budgets":"actuals") : undefined;
      const st = {...s, ...mono, fontSize:11, justifyContent:"flex-end", color: rolled ? "#94a3b8" : "var(--mut)"};
      if (!v) return <span style={st} title={tip} />;
      return <span style={st} title={tip}>
        {"$" + Number(v).toLocaleString("en-US", {maximumFractionDigits:2})}
      </span>;
    }
    case "notes": {
      const _count = task.notes.length;
      const latest = task.notes[task.notes.length - 1];
      return (
        <span style={{...s,gap:6,cursor:"pointer"}} onClick={e=>{e.stopPropagation();setNotesCtx({taskId:task.id,projectId:projId});}}>

          {/* Full text fills the cell — CSS ellipsis trims at the real cell
              edge, so widening the column reveals more (no hard char limit) */}
          <span style={{color:"var(--mut)",fontSize:11,flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {latest ? (() => { const [,m,d] = latest.date.split('-'); return `${+m}/${+d} | ${latest.text}`; })() : "+"}
          </span>
        </span>
      );
    }
    default: return <span style={s}>{task[col.k]}</span>;
  }
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  Cell: [() => Cell],
});
