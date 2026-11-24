import { fdLocal } from "../../../../shared/schedule/engine/calendar.js";
import { effectivePercentComplete, leafPercent } from "../../../../shared/schedule/healthEngine.js";
import { normPreds } from "../../../../shared/schedule/engine/predecessors.js";
import { computeDisplayHealth, computeRolledHealth } from "../../../../shared/schedule/engine/health.js";
import { ownerJoin, ownerListOf } from "../../../../shared/schedule/engine/owners.js";
import { crossScheduleLabel } from "../../../../shared/schedule/scheduleOwnership.js";
import { scheduleExportName } from "../../../../shared/schedule/engine/tasks.js";
import { GANTT_INK, GANTT_PROFILES, depAnchors, estLabelWidth, fitCaptionFs, ganttCaptionHalf, ganttLeafGeom, ganttMilestoneGeom, ganttNameSize, ganttNameWeight, ganttSummaryGeom, placeGanttLabel, resolveLabelAlign } from "./GanttView.jsx";
import { barLabelText, escapeHtml } from "../layout.js";
import { exposeToHarness } from "../harnessGlobals.js";



// ── PDF helpers ──────────────────────────────────────────
export const PAGE_SIZES = {
  letter:  {label:"Letter (8.5 × 11 in)",  w:8.5,  h:11,    css:"letter",    short:"Letter"},
  legal:   {label:"Legal (8.5 × 14 in)",   w:8.5,  h:14,    css:"legal",     short:"Legal"},
  tabloid: {label:"Tabloid (11 × 17 in)",  w:11,   h:17,    css:"11in 17in", short:"11×17"},
  a4:      {label:"A4 (8.27 × 11.69 in)", w:8.27, h:11.69, css:"A4",        short:"A4"},
};
function buildGanttSVG(projects, svgWidth, orientation, opts = {}) {
  const noLabels = !!opts.noLabels;
  const ROW_H=18, LABEL_W=noLabels ? 0 : (orientation==="landscape"?200:155);
  const ganttW=svgWidth-LABEL_W;
  // NEW-1 / PDF-PARITY — EVERY glyph in a print row is BOTTOM-ALIGNED on one baseline, exactly as
  // on screen, so the always-above name caption owns the row's upper band. The summary bracket
  // already sat on this baseline; the leaf bar and the milestone diamond used to be vertically
  // CENTRED (an old screen↔print drift), which left a 9px-tall caption nowhere to go but on top of
  // the glyph it names. The bar renderer AND the dependency router both read these helpers, so the
  // two can no longer disagree about where a glyph is.
  // NEW-1 (name rank) — the numbers come from the ONE shared geometry block (GANTT_PROFILES.print), the
  // same helpers the on-screen chart reads: a name keeps its full ranked size and the glyph (bar /
  // bracket / diamond) gives way, so the top level can never print smaller than the level below it.
  const PP=GANTT_PROFILES.print;
  const leafBand=yTop=>{const g=ganttLeafGeom(PP,ROW_H), top=yTop+g.top; return {top,bot:top+g.h,mid:top+g.h/2,h:g.h};};
  const mileBand=(yTop,depth)=>{const g=ganttMilestoneGeom(PP,ROW_H,depth); return {top:yTop+g.top,bot:yTop+g.bot,mid:yTop+g.cy,half:g.half};};
  const summaryBand=(yTop,depth)=>{const g=ganttSummaryGeom(PP,ROW_H,depth);
    return {top:yTop+g.top,bot:yTop+g.bot,mid:yTop+g.mid,SPAN:g.span,LEG:g.leg};};
  const pd=s=>new Date(s+"T12:00:00"), fd=d=>d.toISOString().slice(0,10);
  const allTasks=projects.flatMap(p=>p.tasks);
  if(!allTasks.length) return "";
  // Drop empty AND unparseable dates so a single bad value (imported/hand-edited) can't
  // poison the min/max → NaN geometry across the whole exhibit.
  const dates=allTasks.flatMap(t=>[t.start,t.end]).filter(d=>d&&!isNaN(pd(d))).sort();
  if(!dates.length) return "";
  const minD=dates[0], maxD=dates[dates.length-1];
  const DAY=86400000;
  const addDays=(s,n)=>fd(new Date(pd(s).getTime()+Math.round(n)*DAY));
  const getDepth=(tasks,id)=>{let dep=0,t=tasks.find(x=>x.id===id);while(t&&t.parentId!==null){dep++;t=tasks.find(x=>x.id===t.parentId);}return Math.min(dep,3);};
  // ── Visible time window: auto-fit by default (B401), optional timescale + pan (B361) ──
  // Start from the natural [minD,maxD]; EXTEND it just enough that every start/end label
  // sits on the sheet without clipping (frame it — never move the labels); then apply the
  // owner's timescale unit / fine-zoom / pan if set. Default (no unit, mul 1, pan 0) = pure
  // auto-fit. The discrete unit and the continuous multiplier compose into ONE span, so the
  // sidebar selector and the toolbar control can't fight each other.
  let winStart, winEnd, totalDays, ppd;
  {
    const td0=Math.max(1,Math.ceil((pd(maxD)-pd(minD))/DAY)+2), ppd0=ganttW/td0;
    const xo0=d=>LABEL_W+Math.round((pd(d)-pd(minD))/DAY*ppd0);
    let leadPx=0, trailPx=0;
    try{
      allTasks.forEach(t=>{
        if(!t||!t.start||!t.end||isNaN(pd(t.start))||isNaN(pd(t.end))) return;
        const proj=projects.find(p=>p.tasks.some(x=>x.id===t.id));
        const depth=proj?getDepth(proj.tasks,t.id):0;
        const isMile=t.duration===0, isParent=proj?proj.tasks.some(x=>x.parentId===t.id):false;
        if(opts.barNames===false) return;
        const bx=xo0(t.start), bw=Math.max(3,Math.round((pd(t.end)-pd(t.start))/DAY*ppd0));
        const kind=isMile?"milestone":isParent?"summary":"leaf";
        const align=opts.labelAlign||resolveLabelAlign(proj);
        const fs=ganttNameSize(GANTT_PROFILES.print,depth);
        const nm=t.name==null?"":String(t.name), lw=estLabelWidth(nm,fs);
        const place=placeGanttLabel({kind,align,bx,bw:isMile?0:bw,rowTop:0,barTopY:0,labelW:lw,
          chartL:-1e9,chartR:1e9,capHalf:ganttCaptionHalf(fs)});
        const x0=place.anchor==="start"?place.x:place.anchor==="middle"?place.x-lw/2:place.x-lw, x1=x0+lw;
        if(LABEL_W-x0>leadPx) leadPx=LABEL_W-x0;
        if(x1-svgWidth>trailPx) trailPx=x1-svgWidth;
      });
    }catch(_){ leadPx=0; trailPx=0; }
    // Cap the lead/trail so a long label can't crush the schedule into a sliver of the page —
    // give breathing room, then let an over-long label clamp/flip as before (B401 intent).
    const cap=Math.max(8,Math.ceil(td0*0.22));
    const leadD=Math.min(cap,Math.max(0,Math.ceil((leadPx+4)/ppd0))), trailD=Math.min(cap,Math.max(0,Math.ceil((trailPx+4)/ppd0)));
    const afStart=addDays(minD,-leadD), afEnd=addDays(maxD,trailD+2);
    const afDays=Math.max(1,Math.ceil((pd(afEnd)-pd(afStart))/DAY));
    const PPU={days:14,weeks:3.7,months:1.5,quarters:0.57};   // target px/day per discrete unit
    const mul=(typeof opts.zoomMul==="number"&&opts.zoomMul>0)?opts.zoomMul:1;
    let vis=(opts.timeUnit&&PPU[opts.timeUnit])?(ganttW/PPU[opts.timeUnit]):afDays;
    vis=Math.max(3,Math.min(vis/mul,afDays*16));
    const panFrac=(typeof opts.panFrac==="number"?opts.panFrac:0);
    const scroll=afDays-vis;
    // When zoomed in, default the landing to center on TODAY (clamped) so it lands on current
    // work rather than a far-back empty stretch; the user's pan is an offset from there (B361).
    const todayDays=(pd(fdLocal(new Date()))-pd(afStart))/DAY;
    const todayFrac=scroll>0?Math.max(0,Math.min(1,(todayDays-vis/2)/scroll)):0;
    const eff=Math.max(0,Math.min(1,todayFrac+panFrac));
    const start=scroll>0?addDays(afStart,Math.round(eff*scroll)):addDays(afStart,Math.round(scroll/2));
    winStart=start; winEnd=addDays(start,vis); totalDays=Math.max(1,vis); ppd=ganttW/totalDays;
  }
  const xOf=d=>LABEL_W+Math.round((pd(d)-pd(winStart))/DAY*ppd);
  // Build full month list with date metadata for the axis + adaptive label density.
  const months=[], cur2=new Date(pd(winStart));cur2.setDate(1);
  // Bound the header loop: a valid-but-extreme end date (e.g. a typo'd year 9999, or
  // imported far-future data) would otherwise build ~95k month cells. 12000 months =
  // 1000 years, far beyond any real schedule.
  let _mGuard=12000;
  while(cur2<=pd(winEnd) && _mGuard-->0){
    months.push({x:xOf(fd(cur2)), mo:cur2.getMonth(), yr:cur2.getFullYear(),
      label:cur2.toLocaleDateString("en-US",{month:"short"})});   // "Jun" — the YEAR is its own tier now (B399)
    cur2.setMonth(cur2.getMonth()+1);
  }
  // Each month's right edge = next month's start (last → chart right edge) so tier labels center.
  months.forEach((m,i)=>{ m.x1 = months[i+1] ? months[i+1].x : svgWidth; m.cx=(m.x+m.x1)/2; });
  // Year spans for the top tier (group the months by calendar year).
  const yearSpans=[];
  months.forEach(m=>{ const last=yearSpans[yearSpans.length-1]; if(last&&last.yr===m.yr) last.x1=m.x1; else yearSpans.push({yr:m.yr,x0:m.x,x1:m.x1}); });
  yearSpans.forEach(y=>y.cx=(y.x0+y.x1)/2);
  // Adaptive month-label density — drop labels that would overlap (~26px each); single-letter when tight.
  const monthPx=ppd*30.4;
  const monLabel = m => monthPx>=30 ? m.label : m.label[0];
  const visibleMonths=monthPx>=22?months:monthPx>=12?months.filter(m=>m.mo%2===0):monthPx>=6?months.filter(m=>[0,3,6,9].includes(m.mo)):months.filter(m=>m.mo===0);
  // B399 (owner pick "D") — a two-tier LIGHT header: a YEAR band over a MONTH band, HEADER_H tall.
  const YEAR_TIER=14, MON_TIER=16, HEADER_H=YEAR_TIER+MON_TIER, svgH=HEADER_H+ROW_H*allTasks.length;
  // B397 — paint in explicit LAYERS so the data sits ON TOP of the vertical rules (mirrors the
  // on-screen Gantt's z-order, B222): row bands (bottom) → grid / today / dependency lines →
  // bars + milestones → text labels (top). The per-row string is split into separate buckets
  // (the old `${gridLines}${rows}${yearLines}${arrows}${todayLine}` put the rules over the bars).
  const rowBands=[], barLayer=[], labelLayer=[], nameRecords=[];
  allTasks.forEach((t,i)=>{
    const y=HEADER_H+i*ROW_H, bg=i%2?"#f6f6f6":"#fff";
    // An unscheduled task (no/invalid start or end) gets NO bar — drawing one yields NaN SVG
    // coords (an invisible, broken row). Mirror the on-screen Gantt's "Unscheduled" treatment.
    const blank = !t.start || !t.end || isNaN(pd(t.start)) || isNaN(pd(t.end));
    const bx=xOf(t.start), bw=Math.max(3,Math.round((pd(t.end)-pd(t.start))/86400000*ppd));
    const isMilestone=t.duration===0;
    const proj=projects.find(p=>p.tasks.some(x=>x.id===t.id));
    const depth=proj?getDepth(proj.tasks,t.id):0;
    const isParent=proj?proj.tasks.some(x=>x.parentId===t.id):false;
    const labelHtml = noLabels ? "" :
      (() => {
        const indent=depth*8, nameX=4+indent;
        const maxCh=Math.floor((LABEL_W-nameX-4)/5.2);
        const nm=t.name==null?"":String(t.name);   // a nameless task must not crash the exhibit (was: t.name.length on undefined)
        const nameStr=nm.length>maxCh?nm.slice(0,maxCh-1)+"…":nm;
        const fw=depth===0?"bold":depth===1?"600":"normal", fs=depth===0?9:depth===1?8.5:8;
        return `<text x="${nameX}" y="${y+ROW_H*0.68}" font-size="${fs}" font-weight="${fw}" fill="#1a1a1a" font-family="Arial,sans-serif">${escapeHtml(nameStr)}</text>`;
      })();
    const _barY=y+ROW_H*0.22, _barH=ROW_H*0.55, _midY=y+ROW_H*0.5;
    let blText="";
    if(opts.barLabels && !isParent && !blank){
      const L=barLabelText(t,opts.barLabels.left,opts.barLabels.year), R=barLabelText(t,opts.barLabels.right,opts.barLabels.year);
      const lx=isMilestone?bx-8:bx-3, rx=isMilestone?bx+8:bx+bw+3;
      if(L) blText+=`<text x="${lx}" y="${y+ROW_H*0.68}" font-size="6.5" fill="#555" text-anchor="end" font-family="Arial,sans-serif">${escapeHtml(L)}</text>`;
      if(R) blText+=`<text x="${rx}" y="${y+ROW_H*0.68}" font-size="6.5" fill="#555" font-family="Arial,sans-serif">${escapeHtml(R)}</text>`;
    }
    // B210/B211 — match the on-screen Gantt: navy depth-stepped brackets for summaries,
    // a single gray fill treatment (hollow → partial → solid) for task status.
    const GRAY="#94a3b8";
    const pct = leafPercent(t);
    let barSvg;
    if(blank){
      barSvg="";   // unscheduled — no geometry; an "Unscheduled" tag is added to labelLayer below
    }else if(isParent){
      // a summary (has children) renders as a BRACKET even when its rolled span is 0 days —
      // checked before the milestone branch so a parent whose children are all milestones
      // isn't mistaken for a single diamond (B2).
      // Depth-stepped BRACKET (B210): a thin span + straight-down legs (no triangles). The
      // GRAPHIC keeps its ramp (depth 0 = #2B3340, darkest/thickest, stepping lighter/thinner);
      // magnitudes compressed a touch vs B210 so the always-above caption has clear air (B393).
      const dd=Math.min(depth,3);
      const NAVY=["#2B3340","#46506A","#6E7790","#8A93A8"][dd];
      const legW=1.1, sb=summaryBand(y,depth), SPAN=sb.SPAN, LEG=sb.LEG, sTop=sb.top;
      barSvg=`<rect x="${bx}" y="${sTop}" width="${bw}" height="${SPAN}" rx="1" fill="${NAVY}"/>`
        +`<rect x="${bx}" y="${sTop}" width="${legW}" height="${SPAN+LEG}" fill="${NAVY}"/>`
        +`<rect x="${bx+bw-legW}" y="${sTop}" width="${legW}" height="${SPAN+LEG}" fill="${NAVY}"/>`;
    }else if(isMilestone){
      const done = pct>=100, mb=mileBand(y,depth), h=mb.half;
      barSvg=`<polygon points="${bx},${mb.top} ${bx+h},${mb.mid} ${bx},${mb.bot} ${bx-h},${mb.mid}" fill="${done?GRAY:'#fff'}" stroke="${GRAY}" stroke-width="1.1"/>`;
    }else{
      const lb=leafBand(y), LH=lb.h, by=lb.top, bw2=Math.max(bw,5), r=LH/2;
      if(pct>=100){
        barSvg=`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="${GRAY}"/>`;                         // Complete → solid
      }else if(pct<=0){
        barSvg=`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="#fff" stroke="${GRAY}" stroke-width="1.1"/>`; // Not started → hollow
      }else{
        const fw=Math.max(0.5, Math.min(bw2, bw2*pct/100));                                                                  // In progress → partial
        barSvg=`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="${GRAY}" opacity="0.18"/>`
          +`<rect x="${bx}" y="${by}" width="${fw}" height="${LH}" rx="${r}" fill="${GRAY}"/>`
          +`<rect x="${bx}" y="${by}" width="${bw2}" height="${LH}" rx="${r}" fill="none" stroke="${GRAY}" stroke-width="0.8"/>`;
      }
    }
    // In-chart NAME on the bar/bracket/diamond (B394) — the layer GanttView draws but the
    // exhibit used to omit. Same placement helper, alignment, uniform ink and weight ramp as
    // on-screen so the two paths can't drift; uniform near-black (no B210 depth-navy here
    // either); escaped via escapeHtml (B248). Default on (opts.barNames !== false).
    // Skip a name whose bar is fully OUTSIDE the visible window (B361 zoom/pan) — otherwise its
    // label would clamp onto the chart edge with no bar (no-op for the auto-fit default, where
    // every bar is in view).
    const nameInView = !blank && (isMilestone ? (bx>=LABEL_W-2 && bx<=svgWidth+2) : (bx+bw>=LABEL_W-2 && bx<=svgWidth+2));
    if(opts.barNames!==false && nameInView){
      const kind = isMilestone?"milestone":isParent?"summary":"leaf";
      const align = opts.labelAlign || resolveLabelAlign(proj);
      const band = isMilestone ? mileBand(y,depth) : isParent ? summaryBand(y,depth) : leafBand(y);
      const barTopY = band.top, bwN = isMilestone ? 0 : bw;
      // EVERY caption auto-fits the headroom above its own glyph so it clears it at this row
      // height (B629's summary rule, now uniform — NEW-1 made every name a caption above its bar).
      const fs = fitCaptionFs(ganttNameSize(PP,depth), barTopY-y);
      const nm = t.name==null?"":String(t.name);
      const lw = estLabelWidth(nm, fs);
      const place = placeGanttLabel({kind, align, bx, bw:bwN, rowTop:y, barTopY,
        labelW:lw, chartL:LABEL_W, chartR:svgWidth, capHalf:ganttCaptionHalf(fs), rowH:ROW_H});
      // Collected, not emitted: the in-chart names are de-collided AFTER the row pass so
      // co-dated labels never overprint each other (B402), then drawn on the top layer.
      nameRecords.push({x:place.x, y:place.y, anchor:place.anchor, mode:place.mode, lw, fs,
        weight:ganttNameWeight(depth, kind, t.bold || t.cellFmt?.name?.bold), italic:!!(t.italic || t.cellFmt?.name?.italic), underline:!!(t.underline || t.cellFmt?.name?.underline), str:escapeHtml(nm)});
    }
    const unsched = blank ? `<text x="${LABEL_W+6}" y="${y+ROW_H*0.68}" font-size="7.5" fill="#9aa0a6" font-style="italic" font-family="Arial,sans-serif">Unscheduled</text>` : "";
    rowBands.push(`<rect x="0" y="${y}" width="${svgWidth}" height="${ROW_H}" fill="${bg}"/>`);
    barLayer.push(barSvg);
    labelLayer.push(`${labelHtml}${blText}${unsched}`);   // task-column name + bar labels (+ Unscheduled tag) (in-chart names → nameLayer, B402)
  });
  // Dependency connectors — same curved style as the in-app Gantt (cubic bezier,
  // direction-flipped 32px handles, type colors, dashed). Opacity lifted .55 -> .7 for print.
  let arrows="";
  if(opts.showArrows!==false){
    const DEP_C={FS:"#0969da",SS:"#7c3aed",FF:"#0891b2",SF:"#be185d"};
    let base=0;
    for(const p of projects){
      const ix=new Map();
      p.tasks.forEach((t,i)=>ix.set(t.id, base+i));
      // WHERE each connector attaches is decided by the SHARED depAnchors() — the same routing as
      // the on-screen Gantt, so the two paths can't drift (B396 re-report, replacing the print-only edgeYOf
      // of B402). A down-link leaves the source's BOTTOM edge near its finish and drops into the
      // target's TOP edge near its start (never 9 o'clock, so it clears the start-date label); an
      // up-link mirrors it. A bar's outbound links FAN across the exit arc instead of bundling.
      const isParentTask=task=>p.tasks.some(x=>x.parentId===task.id);
      // Reads the SAME bottom-aligned glyph bands the bar renderer draws (NEW-1), so an arrow can
      // never attach to where a glyph used to be.
      const glyphEdges=(task,gidx)=>{
        const yTop=HEADER_H+gidx*ROW_H, sX=xOf(task.start), eX=xOf(task.end);
        if(isParentTask(task)){                                                          // summary bracket (before milestone — a duration-0 parent draws as a bracket)
          const b=summaryBand(yTop,getDepth(p.tasks,task.id)); return {startX:sX,endX:eX,topY:b.top,botY:b.bot,rowTop:yTop};
        }
        if(task.duration===0){ const b=mileBand(yTop,getDepth(p.tasks,task.id)); return {startX:sX,endX:sX,topY:b.top,botY:b.bot,rowTop:yTop}; }  // diamond vertices
        const b=leafBand(yTop); return {startX:sX,endX:Math.max(eX,sX+5),topY:b.top,botY:b.bot,rowTop:yTop};            // leaf bar
      };
      // Right edge x of a target's start-date bar-label (text-anchor:end at bx-3 / bx-8 for a
      // milestone) when start labels are shown — the arrowhead exclusion zone (B396 re-report).
      const startLabelRightX=task=>{
        if(!opts.barLabels||isParentTask(task)||!opts.barLabels.left) return null;
        if(!barLabelText(task,opts.barLabels.left,opts.barLabels.year)) return null;
        return xOf(task.start)-(task.duration===0?8:3);
      };
      // Collect this project's guard-passing links, then group by SOURCE for fanning.
      const raw=[];
      for(const t of p.tasks){
        for(const pr of normPreds(t.predecessors)){   // tolerate plain-number preds (seed/imported) so arrows draw like the table (F2)
          if(!ix.has(pr.id)) continue;
          const pt=p.tasks[ix.get(pr.id)-base];
          // B519: skip a present-but-unparseable date too — else xOf()→NaN emits a garbage arrow path.
          if(!pt||!pt.start||!pt.end||!t.start||!t.end||isNaN(pd(pt.start))||isNaN(pd(pt.end))||isNaN(pd(t.start))||isNaN(pd(t.end))) continue;
          if(ix.get(pr.id)===ix.get(t.id)) continue;
          raw.push({pt,t,type:(pr.type||"FS").toUpperCase()});
        }
      }
      const bySrc=new Map();
      raw.forEach(l=>{const a=bySrc.get(l.pt.id)||[];a.push(l);bySrc.set(l.pt.id,a);});
      bySrc.forEach(a=>a.sort((x,y)=>(ix.get(x.t.id)-ix.get(y.t.id))||(x.type<y.type?-1:x.type>y.type?1:0)));
      for(const l of raw){
        const group=bySrc.get(l.pt.id);
        const src=glyphEdges(l.pt,ix.get(l.pt.id)), tgt=glyphEdges(l.t,ix.get(l.t.id));   // GLOBAL row index — bars are laid out across ALL projects at HEADER_H+globalIdx*ROW_H (the -base local index would misplace every arrow in the 2nd+ project)
        const a=depAnchors({type:l.type,src,tgt,fanIndex:group.indexOf(l),fanCount:group.length,
                            tgtLabelRightX:(l.type==="SS"||l.type==="FS")?startLabelRightX(l.t):null});
        const sx=a.x1, sBot=a.y1, tx=a.x2, tTop=a.y2, vSign=a.down?1:-1;
        const dx=tx-sx, dy=tTop-sBot, vh=Math.max(6,Math.min(26,Math.abs(dy)*0.5));
        const c1x=sx+dx*0.30, c1y=sBot+vSign*vh;                        // exit in the travel direction
        const c2x=tx-dx*0.30, c2y=tTop-vSign*vh;                        // entry from the travel direction
        // Arrowhead oriented along the ENTRY tangent so an angled entry reads right.
        const ex=tx-c2x, ey=tTop-c2y, el=Math.hypot(ex,ey)||1, ux=ex/el, uy=ey/el;
        const a1x=tx-ux*6-uy*3, a1y=tTop-uy*6+ux*3, a2x=tx-ux*6+uy*3, a2y=tTop-uy*6-ux*3;
        const color=DEP_C[l.type]||DEP_C.FS;
        arrows+=`<path class="dep" d="M${sx.toFixed(1)},${sBot.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${tx.toFixed(1)},${tTop.toFixed(1)}" stroke="${color}" stroke-width="1.2" fill="none" stroke-dasharray="4 3" opacity="0.7"/>`
          +`<path d="M${tx.toFixed(1)},${tTop.toFixed(1)} L${a1x.toFixed(1)},${a1y.toFixed(1)} L${a2x.toFixed(1)},${a2y.toFixed(1)}Z" fill="${color}" opacity="0.7"/>`;
      }
      base+=p.tasks.length;
    }
  }
  // ── Weighted vertical grid rules (B399, owner spec) — ONE line per month boundary, RANKED
  //    year > quarter > month, each thicker + a touch darker, so hierarchy reads by line weight
  //    (no quarter LABEL, just the rule). Year rules drop from the very top; quarter + month from
  //    below the year tier — down THROUGH the body, kept light and painted BEFORE the bars (B397)
  //    so nothing ever crosses a bar / bracket / milestone.
  const gridRules=months.map(m=>{
    if(m.mo===0)   return `<line x1="${m.x}" y1="0" x2="${m.x}" y2="${svgH}" stroke="#8b95a3" stroke-width="1.3"/>`;            // YEAR — thickest
    if(m.mo%3===0) return `<line x1="${m.x}" y1="${YEAR_TIER}" x2="${m.x}" y2="${svgH}" stroke="#c2c9d2" stroke-width="0.8"/>`; // QUARTER — medium (line only)
    return                `<line x1="${m.x}" y1="${YEAR_TIER}" x2="${m.x}" y2="${svgH}" stroke="#e7ebf0" stroke-width="0.4"/>`; // MONTH — thinnest
  }).join("");
  // B398 — ONE continuous left chart-edge boundary, full height, drawn once (not per-row).
  const leftEdge=`<line x1="${LABEL_W}" y1="0" x2="${LABEL_W}" y2="${svgH}" stroke="#c4c8ce" stroke-width="0.8"/>`;
  // Today marker — red dashed line + a small tick at the bottom of the header band.
  const todayStr=fdLocal(new Date());
  const todayLine=(opts.showToday!==false && todayStr>=winStart&&todayStr<=winEnd)
    ? `<line x1="${xOf(todayStr)}" y1="${HEADER_H}" x2="${xOf(todayStr)}" y2="${svgH}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3,2"/>
<polygon points="${xOf(todayStr)-3.5},${HEADER_H-5} ${xOf(todayStr)+3.5},${HEADER_H-5} ${xOf(todayStr)},${HEADER_H}" fill="#dc2626"/>`
    : "";
  // ── Two-tier LIGHT header (owner pick "D"): a year band over a month band ──
  const headerBg=`<rect x="${LABEL_W}" y="0" width="${ganttW}" height="${HEADER_H}" fill="#f6f8fa"/>`
    +`<rect x="${LABEL_W}" y="0" width="${ganttW}" height="${YEAR_TIER}" fill="#e9edf2"/>`;
  const yearLabels=yearSpans.map(y=>`<text x="${y.cx}" y="${YEAR_TIER-3.5}" font-size="9.5" font-weight="700" fill="#3a4452" font-family="Arial,sans-serif" text-anchor="middle" letter-spacing="0.6">${y.yr}</text>`).join("");
  const monthLabels=visibleMonths.map(m=>{const strong=m.mo%3===0;return `<text x="${m.cx}" y="${HEADER_H-5}" font-size="7.5" font-weight="${strong?700:500}" fill="${strong?"#3a4452":"#69727f"}" font-family="Arial,sans-serif" text-anchor="middle">${monLabel(m)}</text>`;}).join("");
  const headerLines=`<line x1="${LABEL_W}" y1="${YEAR_TIER}" x2="${svgWidth}" y2="${YEAR_TIER}" stroke="#d4d8de" stroke-width="0.7"/>`
    +`<line x1="${LABEL_W}" y1="${HEADER_H}" x2="${svgWidth}" y2="${HEADER_H}" stroke="#b9c0c9" stroke-width="1"/>`;
  const taskHeaderText = noLabels ? "" : `<text x="4" y="${HEADER_H-6}" font-size="8" font-weight="bold" fill="#3a4452" font-family="Arial,sans-serif">TASK</text>`;
  // ── B402: de-collide in-chart name labels ──────────────────────────────────────────
  // Co-dated labels must never overprint each other. Sweep top→down; if a label's box hits
  // one already placed, nudge it down until clear (capped). A pure no-op when nothing
  // overlaps (the common per-row case), so existing layouts are untouched. Defensive: any
  // failure falls back to the un-nudged labels.
  let nameLayer="";
  const emitName=r=>{
    // No contrast plate: since NEW-1 every name is a caption in the clear air above its glyph, so
    // there is nothing to knock out behind it.
    return `<text x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" font-size="${r.fs}" font-weight="${r.weight}" fill="${GANTT_INK}" text-anchor="${r.anchor}" dominant-baseline="central" font-family="Arial,sans-serif"${r.italic?' font-style="italic"':''}${r.underline?' text-decoration="underline"':''}>${r.str}</text>`;
  };
  try{
    const boxOf=r=>{const x0=r.anchor==="middle"?r.x-r.lw/2:r.anchor==="end"?r.x-r.lw:r.x;return {x0,x1:x0+r.lw,y0:r.y-r.fs*0.72,y1:r.y+r.fs*0.72};};
    const recs=nameRecords.map(r=>({...r,_y0:r.y})).sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    const placed=[];
    for(const r of recs){
      let b=boxOf(r),tries=0;
      while(tries<8){
        const hit=placed.find(p=>b.x0<p.x1&&b.x1>p.x0&&b.y0<p.y1&&b.y1>p.y0);
        if(!hit) break;
        r.y+=(hit.y1-b.y0)+1.5;
        if(r.y-r._y0>ROW_H*2.2){ r.y=r._y0; break; }   // give up rather than fling it far
        b=boxOf(r); tries++;
      }
      placed.push(b);
    }
    nameLayer=recs.map(emitName).join("");
  }catch(_){ nameLayer=nameRecords.map(emitName).join(""); }
  // B400 — a viewBox makes the whole 0..svgWidth content scale to fill the container width EXACTLY
  // (with style:width:100%), so the full min→max timeline always fits the page Gantt column with no
  // right-edge clipping. Render is 1:1 at the export widths, so per-page slicing is unchanged (the
  // paginator's GANTT_HEAD must match HEADER_H).
  // Paint order (B397): white → header band → row bands → grid rules → left edge → today →
  // dependency (main's curved, B396) → bars → header labels/lines (axis text on top) → bar labels.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgH}" viewBox="0 0 ${svgWidth} ${svgH}" style="width:100%;display:block">
<rect width="${svgWidth}" height="${svgH}" fill="#fff"/>
${headerBg}
${rowBands.join("")}${gridRules}${leftEdge}${todayLine}${arrows}${barLayer.join("")}${yearLabels}${monthLabels}${headerLines}${taskHeaderText}${labelLayer.join("")}${nameLayer}</svg>`;
}

// ── Exhibit column sizing (B390 content-fit + B392 drag-resize) ─────────────────────
// Minimum px the Gantt timeline keeps in the split exhibit, so widening columns can never
// collapse the chart. Shared by buildPDFHtml and the live drag-resize script it embeds.
const EXHIBIT_MIN_GANTT = 240;
// Approximate the rendered width (px) of `str` at font-size `fs` for the exhibit's
// Inter/Arial face. Per-character advances run slightly generous so a fixed-format value
// (a date, a duration, a percent) is never clipped by an under-sized column. Pure +
// DOM-free so the preview, the print window, and the unit tests all agree.
function approxTextPx(str, fs){
  let w=0; const s=String(str==null?"":str);
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c===' '||/[.,:;'!|il]/.test(c)) w+=0.30*fs;
    else if(/[fjt()/\-]/.test(c)) w+=0.38*fs;
    else if(/[0-9]/.test(c)) w+=0.58*fs;
    else if(c==='M'||c==='W') w+=0.92*fs;
    else if(/[A-Z]/.test(c)) w+=0.70*fs;
    else if(c==='m'||c==='w') w+=0.86*fs;
    else w+=0.54*fs;
  }
  return w;
}
// Lay the exhibit columns out from their content-fit base widths, letting a user's
// per-column drag override (cfg.colWidths) win, each clamped to its [min,max]. The table
// block is exactly its columns' total and the Gantt takes the rest, but never less than
// EXHIBIT_MIN_GANTT — if the columns would crowd the chart, flexible columns shrink toward
// their min first, then a uniform scale as a last resort. Returns { widths:{k:px}, tableW,
// ganttW }. Pure + DOM-free, so the preview, the print window, and the tests all agree.
function layoutExhibitCols(specs, opts){
  const ov = opts.override || {};
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const widths={};
  for(const s of specs) widths[s.k]=Math.round(clamp(ov[s.k]!=null?ov[s.k]:s.base, s.min, s.max));
  const total=()=>specs.reduce((a,s)=>a+widths[s.k],0);
  const budget=Math.max(160, opts.budget-EXHIBIT_MIN_GANTT); // reserve room for the chart
  if(total()>budget){
    const flex=specs.filter(s=>s.flex);
    const slack=flex.reduce((a,s)=>a+(widths[s.k]-s.min),0);
    if(slack>0){
      const need=Math.min(total()-budget, slack);
      for(const s of flex) widths[s.k]-=Math.round((widths[s.k]-s.min)/slack*need);
    }
    if(total()>budget){ // no flex slack left → uniform scale as a last resort
      const f=budget/total();
      for(const s of specs) widths[s.k]=Math.max(s.min, Math.round(widths[s.k]*f));
    }
  }
  const tableW=total();
  return { widths, tableW, ganttW: Math.max(EXHIBIT_MIN_GANTT, opts.budget-tableW) };
}

// B1873361 (PDF-PARITY) — the per-project section header this prints when more than one schedule
// is exported together (".proj-name", below) uses crossScheduleLabel, not the bare schedule name,
// for the same reason MasterView's "Group by project" does: exporting two same-named schedules
// (the owner's own two "Master Schedule"s) together must not print two identical headers.
export function buildPDFHtml(cfg, data, forPreview) {
  const projs = Object.values(data.projects);
  const selProjs = projs.filter(p => cfg.selProjects.includes(String(p.id)));
  const COL_DEFS = [
    {k:"id",w:20},{k:"name",w:null},{k:"start",w:42},{k:"end",w:42},
    {k:"duration",w:28},{k:"health",w:72},{k:"percentComplete",w:36},
    {k:"responsibleParty",w:64},{k:"predecessors",w:36},{k:"cost",w:56},
  ];
  const COL_LABELS = {id:"ID",name:"Task Name",start:"Start",end:"End",duration:"Dur",health:"Status",percentComplete:"%",responsibleParty:"Owner",predecessors:"Pred",cost:"Cost"};
  const colDefs = COL_DEFS.filter(c => cfg.columns.includes(c.k));
  const HC = {gray:{l:"Not Started",c:"#94a3b8"},yellow:{l:"In Progress",c:"#d97706"},red:{l:"Needs Attn.",c:"#dc2626"},green:{l:"Complete",c:"#16a34a"},paused:{l:"Paused",c:"#9ca3af"}};
  const fmtD = s => { if(!s) return ""; const [y,m,d]=s.split("-"); return String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2); };
  const getDepth = (tasks,id) => {let dep=0,t=tasks.find(x=>x.id===id);while(t&&t.parentId!==null){dep++;t=tasks.find(x=>x.id===t.parentId);}return Math.min(dep,3);};
  // Collapse state for this exhibit only — keys are "projectId:taskId". Never written back to live tasks.
  const collapsedSet = new Set(cfg.collapsedIds || []);
  // A task is hidden when any ancestor is collapsed (walked against the full project list).
  const visibleTasks = proj => proj.tasks.filter(t => {
    let pid = t.parentId;
    while (pid != null) { if (collapsedSet.has(proj.id + ":" + pid)) return false; const par = proj.tasks.find(x => x.id === pid); pid = par ? par.parentId : null; }
    return true;
  });
  // Rolled cost for the exhibit: parent = sum of descendant leaf costs; leaf = own value.
  const costOfIn = (tasks, id) => { const kids = tasks.filter(x=>x.parentId===id); const own = Number(tasks.find(x=>x.id===id)?.cost)||0; return kids.length ? own + kids.reduce((s,c)=>s+costOfIn(tasks,c.id),0) : own; };
  // The exhibit's Status column must show what the SCREEN shows, not the raw stored `health`
  // field: a task with no manual override is colored live by the automation rule engine
  // (computeDisplayHealth, #1073) and that computed color is never written back to `health` —
  // so reading `t.health` directly here silently printed the pre-automation color on every
  // un-overridden task (B568128, measured live: an overdue leaf read "Not Started" in the PDF while
  // the grid showed "Needs Attn." for the same task at the same moment). Mirrors the grid Cell's
  // own rule exactly: a parent shows the worst-of-children ROLLED health, a leaf runs the engine.
  // Memoized per project (keyed by the project's task array identity) — O(n) once, not per cell.
  let _healthCtxTasks = null, _healthCtxById = null, _healthCtxRolled = null;
  const healthCtxFor = tasks => {
    if (_healthCtxTasks !== tasks) {
      _healthCtxTasks = tasks;
      _healthCtxById = {}; tasks.forEach(x => { _healthCtxById[x.id] = x; });
      _healthCtxRolled = computeRolledHealth(tasks, data.settings);
    }
    return { byId: _healthCtxById, rolled: _healthCtxRolled };
  };
  const displayHealthOf = (t, tasks) => {
    const { byId, rolled } = healthCtxFor(tasks);
    const isParent = tasks.some(x => x.parentId === t.id);
    return isParent ? (rolled[t.id] || t.health) : computeDisplayHealth(t, data.settings, byId);
  };
  // The grid blanks the Status/Health cell for an EXPANDED parent (Cell(), case "status"/"health"
  // — B222/B211: the rolled color only ever shows on the COLLAPSED row, because the children are
  // ALSO shown as their own rows right below it). The exhibit's analog of "expanded" is its OWN
  // `collapsedSet` — not the live task's `.isExpanded` — because collapsedSet is what actually
  // decides whether this task's children appear as separate rows in THIS SAME document
  // (visibleTasks() and the preview's own ▾/▸ collapse triangle both key off it too, and a user
  // can toggle it independently of the live grid via Expand/Collapse All or the triangle). Using
  // `.isExpanded` instead would self-contradict the exhibit's own triangle the moment someone
  // collapses/expands a row inside the PDF preview without touching the live grid. Defaults agree
  // with `.isExpanded` (collapsedIds is seeded from it — PDFExportModal's seedCollapsed), so this
  // is a strict improvement, not a behavior change, for every schedule that hasn't been
  // interactively re-collapsed inside the export preview (B575904, PDF-PARITY).
  const isExpandedParentOf = (t, tasks, projId) => tasks.some(x => x.parentId === t.id) && !collapsedSet.has(projId + ":" + t.id);
  const cellVal = (t,k,tasks,projId) => {    switch(k){
      case "start": case "end": return fmtD(t[k]);
      case "duration": return `${t.duration}d`;
      case "percentComplete": return `${displayHealthOf(t,tasks)==="green" ? 100 : effectivePercentComplete(t, tasks)}%`;  // match the Gantt bar's green→100 convention
      case "predecessors": return (t.predecessors||[]).map(p=>p.id||p).join(", ");
      case "health":{if(isExpandedParentOf(t,tasks,projId)) return "";const dh=displayHealthOf(t,tasks);const h=HC[dh]||{l:dh,c:"#94a3b8"};return `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:${h.c};flex-shrink:0;display:inline-block"></span>${escapeHtml(h.l)}</span>`;}
      case "name":{const dep=getDepth(tasks,t.id);const ind=dep*14;const fw=dep===0?700:dep===1?600:400;const fs=dep===0?10.5:dep===1?10:9.5;const isP=tasks.some(x=>x.parentId===t.id);const key=projId+":"+t.id;const col=collapsedSet.has(key);const tri=(forPreview&&isP)?`<span class="pl-tri${col?"":" open"}" data-collapse="${key}" title="${col?"Expand":"Collapse"}">${col?"\u25B8":"\u25BE"}</span>`:"";return `<span class="pl-name" style="padding-left:${ind}px;font-weight:${fw};font-size:${fs}px">${tri}${escapeHtml(t.name)}</span>`;}
      case "cost":{const v=costOfIn(tasks,t.id);return v?("$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2})):"";}
      case "responsibleParty": return escapeHtml(ownerJoin(ownerListOf(t)));
      default: return escapeHtml(t[k]);
    }
  };
  const isLand=cfg.orientation==="landscape";
  const ps=PAGE_SIZES[cfg.pageSize]||PAGE_SIZES.letter;
  const pgW=isLand?ps.h:ps.w, pgR=isLand?ps.w:ps.h;
  const contentW=pgW-parseFloat(cfg.margins.left||0.75)-parseFloat(cfg.margins.right||0.75);
  const contentPx=Math.max(300,Math.round(contentW*96));
  // px geometry for the WYSIWYG preview paginator — 96 CSS px per inch, the same
  // density the browser print engine uses, so preview math = print math
  const mTopPx=Math.round(parseFloat(cfg.margins.top||0.75)*96);
  const mBotPx=Math.round(parseFloat(cfg.margins.bottom||0.75)*96);
  const mLeftPx=Math.round(parseFloat(cfg.margins.left||0.75)*96);
  const mRightPx=Math.round(parseFloat(cfg.margins.right||0.75)*96);
  const pageWpx=Math.round(pgW*96), pageHpx=Math.round(pgR*96);

  let bodyHtml="", resizeScript="";
  if(cfg.includeGantt) {
    // Side-by-side: a content-fit grid on the left, the Gantt timeline on the right —
    // like MS Project / Excel split view. The exhibit stacks every selected project under
    // one shared header, so the columns are sized once against the widest value of each
    // visible column across them all (B390) — no dead gap before the dates, no clipped
    // start/end/duration. cfg.colWidths (a user's drag, B392) overrides a column's width.
    const projTaskLists = selProjs.map(proj=>{
      let tasks=visibleTasks(proj);
      // Filter by the same DISPLAY health the Status column now prints (not the raw stored
      // field) — otherwise an automatically-red/green task with no manual override could be
      // silently dropped from (or kept out of) the "Active"/"Done" filtered exhibit.
      if(cfg.healthFilter==="active") tasks=tasks.filter(t=>{const h=displayHealthOf(t,proj.tasks);return h==="yellow"||h==="red";});
      if(cfg.healthFilter==="complete") tasks=tasks.filter(t=>displayHealthOf(t,proj.tasks)==="green");
      return {proj, tasks};
    });
    // Plain-text form of each cell, for width measurement (cellVal returns marked-up HTML).
    const cellText=(t,k,tasks,projId)=>{ switch(k){
      case "start": case "end": return fmtD(t[k]);
      case "duration": return `${t.duration}d`;
      case "percentComplete": return `${displayHealthOf(t,tasks)==="green" ? 100 : effectivePercentComplete(t, tasks)}%`;  // match the Gantt bar's green→100 convention
      case "predecessors": return (t.predecessors||[]).map(p=>p.id||p).join(", ");
      case "health": { if(isExpandedParentOf(t,tasks,projId)) return ""; const dh=displayHealthOf(t,tasks); const h=HC[dh]; return h?h.l:(dh||""); }
      case "name": return t.name==null?"":String(t.name);
      case "cost": { const v=costOfIn(tasks,t.id); return v?("$"+Number(v).toLocaleString("en-US",{maximumFractionDigits:2})):""; }
      case "responsibleParty": return ownerJoin(ownerListOf(t));
      default: return t[k]==null?"":String(t[k]);
    }};
    // Per-column fit profile: font px, clamp range, whether it may shrink (flex), and any
    // non-text px (the Status dot+gap). Short fixed-format columns are NOT flex — a date or
    // a duration must never be the value that gets clipped to make room.
    const COL_FIT={
      id:{fs:8,min:22,max:64,flex:false,extra:0}, name:{fs:10.5,min:96,max:280,flex:true,extra:0},
      start:{fs:9,min:50,max:96,flex:false,extra:0}, end:{fs:9,min:50,max:96,flex:false,extra:0},
      duration:{fs:9,min:34,max:74,flex:false,extra:0}, health:{fs:9,min:62,max:132,flex:false,extra:13},
      percentComplete:{fs:9,min:34,max:74,flex:false,extra:0}, responsibleParty:{fs:9,min:52,max:144,flex:true,extra:0},
      predecessors:{fs:9,min:40,max:120,flex:true,extra:0}, cost:{fs:9,min:50,max:132,flex:true,extra:0},
    };
    const PADX=12, SLACK=3; // td horizontal padding (6+6) + a hair of safety
    const specs=colDefs.map(c=>{
      const f=COL_FIT[c.k]||{fs:9,min:30,max:130,flex:false,extra:0};
      const lbl=COL_LABELS[c.k]||c.k;
      let base=approxTextPx(lbl.toUpperCase(),8)*1.04+lbl.length*0.45; // header is bold + .05em tracked
      for(const {proj,tasks} of projTaskLists){
        for(const t of tasks){
          let w;
          if(c.k==='name'){
            const dep=getDepth(proj.tasks,t.id), fs=dep===0?10.5:dep===1?10:9.5;
            const tri=forPreview&&proj.tasks.some(x=>x.parentId===t.id)?15:0; // collapse triangle (preview only)
            w=approxTextPx(cellText(t,'name',proj.tasks),fs)+dep*14+tri;
          } else {
            w=approxTextPx(cellText(t,c.k,proj.tasks,proj.id),f.fs)+f.extra;
          }
          if(w>base) base=w;
        }
      }
      return {k:c.k, base:base+PADX+SLACK, min:f.min, max:f.max, flex:f.flex};
    });
    const fit=layoutExhibitCols(specs,{override:cfg.colWidths||{}, budget:contentPx-2});
    const colW=fit.widths, canResize=!!forPreview;
    // One shared header for every project. In the preview each column carries a drag
    // handle (B392); the print output never does.
    const thCols=colDefs.map(c=>`<th data-k="${c.k}" style="width:${colW[c.k]}px">${COL_LABELS[c.k]}${canResize?`<span class="col-rs" data-rs="${c.k}" title="Drag to resize"></span>`:""}</th>`).join("");
    projTaskLists.forEach(({proj,tasks})=>{
      const rows=tasks.map((t,i)=>{
        const cells=colDefs.map(c=>`<td class="c-${c.k}">${cellVal(t,c.k,proj.tasks,proj.id)}</td>`).join("");
        return `<tr class="${i%2?"alt":""}">${cells}</tr>`;
      }).join("");
      const ganttProj={...proj, tasks}; // Gantt task list matches the table
      const ganttSvg=buildGanttSVG([ganttProj], fit.ganttW, cfg.orientation, {noLabels:true, showToday:cfg.showToday!==false, showArrows:cfg.showArrows!==false, barLabels:data.settings?.barLabels, barNames:cfg.barNames!==false, labelAlign:cfg.labelAlign, timeUnit:cfg.timeUnit, zoomMul:cfg.zoomMul, panFrac:cfg.panFrac});
      bodyHtml+=`<div class="proj-block">${selProjs.length>1?`<div class="proj-name">${escapeHtml(crossScheduleLabel(proj))}</div>`:""}
        <div class="split-view">
          <div class="split-table" style="width:${fit.tableW}px;flex-shrink:0">
            <table class="aligned"><thead><tr>${thCols}</tr></thead><tbody>${rows}</tbody></table>
          </div>
          <div class="split-gantt" style="width:${fit.ganttW}px;flex-shrink:0;overflow:hidden">${ganttSvg}</div>
        </div></div>`;
    });
    // B392 — live drag-to-resize. Handles live in the preview header; this script (preview
    // only) resizes the dragged column across every page in real time, trading the width
    // against the Gantt (which keeps EXHIBIT_MIN_GANTT), then posts the final width to the
    // parent on release so it persists and the Gantt re-fits cleanly.
    if(forPreview){
      resizeScript=`<script>(function(){
  var W=${JSON.stringify(colW)}, MINc=${JSON.stringify(Object.fromEntries(specs.map(s=>[s.k,s.min])))}, MAXc=${JSON.stringify(Object.fromEntries(specs.map(s=>[s.k,s.max])))};
  var ORDER=${JSON.stringify(colDefs.map(c=>c.k))}, SPLIT=${fit.tableW+fit.ganttW}, MING=${EXHIBIT_MIN_GANTT};
  function sum(){var t=0;for(var i=0;i<ORDER.length;i++)t+=W[ORDER[i]];return t;}
  function apply(){
    var tw=sum(), gw=Math.max(MING,SPLIT-tw);
    document.querySelectorAll('.split-table').forEach(function(e){e.style.width=tw+'px';});
    document.querySelectorAll('.split-gantt').forEach(function(e){e.style.width=gw+'px';});
    ORDER.forEach(function(k){document.querySelectorAll('th[data-k="'+k+'"]').forEach(function(e){e.style.width=W[k]+'px';});});
  }
  var drag=null;
  document.addEventListener('mousedown',function(ev){
    var h=ev.target&&ev.target.closest?ev.target.closest('[data-rs]'):null; if(!h) return;
    ev.preventDefault(); ev.stopPropagation();
    var k=h.getAttribute('data-rs'); drag={k:k,x:ev.clientX,w0:W[k]};
    document.body.style.cursor='col-resize'; document.body.style.userSelect='none';
  },true);
  document.addEventListener('mousemove',function(ev){
    if(!drag) return;
    var mn=MINc[drag.k]||30, others=sum()-W[drag.k], cap=Math.min(MAXc[drag.k]||9999,Math.max(mn,(SPLIT-MING)-others));
    W[drag.k]=Math.round(Math.max(mn,Math.min(drag.w0+(ev.clientX-drag.x),cap))); apply();
  });
  document.addEventListener('mouseup',function(){
    if(!drag) return; var k=drag.k, w=W[k]; drag=null;
    document.body.style.cursor=''; document.body.style.userSelect='';
    try{window.parent.postMessage({type:'planarColResize',key:k,w:w},'*');}catch(_){}
  });
})();<\/script>`;
    }
  } else {
    // Tables only (no Gantt) — full width
    selProjs.forEach(proj=>{
      let tasks=visibleTasks(proj);
      if(cfg.healthFilter==="active") tasks=tasks.filter(t=>{const h=displayHealthOf(t,proj.tasks);return h==="yellow"||h==="red";});
      if(cfg.healthFilter==="complete") tasks=tasks.filter(t=>displayHealthOf(t,proj.tasks)==="green");
      const thCols=colDefs.map(c=>`<th${c.w?` style="width:${c.w}px"`:""}>${COL_LABELS[c.k]}</th>`).join("");
      const rows=tasks.map((t,i)=>{
        const cells=colDefs.map(c=>`<td class="c-${c.k}">${cellVal(t,c.k,proj.tasks,proj.id)}</td>`).join("");
        return `<tr class="${i%2?"alt":""}">${cells}</tr>`;
      }).join("");
      bodyHtml+=`<div class="proj-block">${selProjs.length>1?`<div class="proj-name">${escapeHtml(crossScheduleLabel(proj))}</div>`:""}<table><thead><tr>${thCols}</tr></thead><tbody>${rows}</tbody></table></div>`;
    });
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${escapeHtml(scheduleExportName(selProjs))}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@page{size:${pgW}in ${pgR}in;margin:${cfg.margins.top}in ${cfg.margins.right}in ${cfg.margins.bottom}in ${cfg.margins.left}in}
body{padding:${cfg.margins.top}in ${cfg.margins.right}in ${cfg.margins.bottom}in ${cfg.margins.left}in;font-family:'Inter',Arial,sans-serif;font-size:10px;color:#1a1a1a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{html,body{margin:0!important;padding:0!important}}
*{box-sizing:border-box;margin:0;padding:0}

/* ── Pagination ── */
.doc-header{page-break-inside:avoid;break-inside:avoid}
.doc-footer{page-break-inside:avoid;break-inside:avoid}
.proj-block+.proj-block{page-break-before:always;break-before:page}
/* Split view: do NOT repeat table headers on continuation pages — the Gantt SVG
   beside the table can't repeat anything, so a repeated thead shifts every row
   ~22px out of alignment with its bar on each page after the first. */
@media print{.split-view thead{display:table-row-group}}
/* Tables-only mode: frame the table; keep rows whole across page breaks.
   (Split view intentionally keeps pixel slicing — pushing table rows while the
   Gantt SVG slices freely would desync rows from bars.) */
.proj-block>table{border:1px solid #d4d4d4}
.proj-block>table tbody tr{page-break-inside:avoid;break-inside:avoid}

.doc-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:18px;border-bottom:2.5px solid #1a1a1a}
.dh-left .exhibit{font-size:8.5px;font-weight:700;color:#4f46e5;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}
.dh-left .title{font-size:17px;font-weight:700;color:#1a1a1a;line-height:1.15}
.dh-left .subline{font-size:9.5px;color:#555;margin-top:4px}
.dh-right{text-align:right;font-size:9px;color:#555;line-height:2}
.dh-right strong{color:#1a1a1a;font-weight:600}
.dh-right .conf{color:#b91c1c;font-weight:700;font-size:9px;margin-top:2px}
.proj-block{margin-bottom:20px}
.proj-name{font-size:14px;font-weight:700;color:#4f46e5;letter-spacing:0;padding-bottom:5px;margin-bottom:9px;border-bottom:2px solid #4f46e5}
.split-view{display:flex;align-items:flex-start;width:100%;border:1px solid #d4d4d4}
.split-table{border-right:1px solid #d4d4d4}
.split-table table.aligned{width:100%;border-collapse:collapse;font-size:9px;table-layout:fixed}
.split-table table.aligned thead th{position:relative;height:30px;padding:0 6px;vertical-align:middle;background:#1a1a1a;color:#fff;font-weight:700;font-size:8px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;text-align:left}
/* B392 — drag-to-resize handle on each header cell's right edge (preview only). */
.col-rs{position:absolute;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;z-index:6}
.col-rs:hover{background:rgba(99,102,241,.5)}
@media print{.col-rs{display:none}}
.split-table table.aligned tbody tr{height:18px}
.split-table table.aligned tbody tr.alt{background:#f6f6f6}
.split-table table.aligned tbody td{padding:0 6px;vertical-align:middle;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #ebebeb}
.pl-tri{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;font-size:8px;line-height:1;border-radius:3px;color:#64748b;background:#f1f3f5;border:1px solid #d4d8de;cursor:pointer;margin-right:3px;vertical-align:middle;user-select:none}
.c-cost{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pl-tri.open{background:#e8f0fe;color:#4f46e5;border-color:#b6cef7}
.pl-tri:hover{background:#eef0fe;color:#4f46e5;border-color:#c2c7f5}
@media print{.pl-tri{display:none}}
table{width:100%;border-collapse:collapse;font-size:9px}
thead tr{background:#1a1a1a}
thead th{padding:5px 6px;text-align:left;font-weight:700;font-size:8px;letter-spacing:.05em;text-transform:uppercase;color:#fff;white-space:nowrap}
tbody tr{border-bottom:1px solid #ebebeb}
tbody tr.alt{background:#f8f8f8}
td{padding:4px 6px;vertical-align:middle;line-height:1.3}
.c-id{color:#999;font-size:8px;white-space:nowrap}
.c-duration,.c-percentComplete,.c-predecessors{color:#666;white-space:nowrap}
.c-responsibleParty{color:#444}
.c-start,.c-end{white-space:nowrap;color:#555}
.gantt-wrap{margin-top:22px}
.section-label{font-size:9px;font-weight:700;color:#4f46e5;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #ddd}
.doc-footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;display:flex;justify-content:space-between;font-size:8px;color:#aaa}
.print-bar{position:fixed;bottom:20px;right:20px;display:flex;gap:8px;z-index:999}
.btn-pdf{background:#4f46e5;color:#fff;border:none;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.btn-cl{background:#fff;color:#555;border:1px solid #ddd;padding:10px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit}
@media print{.print-bar{display:none}}
</style></head><body>
<div class="print-bar"${forPreview?' style="display:none"':''}><button class="btn-cl" onclick="window.close()">&#x2715; Close</button><button class="btn-pdf" onclick="window.print()">&#8595; Save as PDF</button></div>
<script>
/*__PAGINATE_SRC__*/
(function(){
  var MODE='${forPreview?"preview":"print"}';
  var MT=${mTopPx}, MB=${mBotPx}, ML=${mLeftPx}, MR=${mRightPx};
  var PW=${pageWpx}, PH=${pageHpx};
  var CW=PW-ML-MR, CH=Math.max(160,PH-MT-MB)-2;  /* printable height, 2px sub-pixel slack */
  var GANTT_HEAD=30, GANTT_ROW=18;               /* must match buildGanttSVG HEADER_H (YEAR_TIER+MON_TIER) + ROW_H */
  var FRAME='#d4d4d4';

  function outerH(el){
    if(!el) return 0;
    var cs=getComputedStyle(el);
    return el.getBoundingClientRect().height+(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
  }

/*__PACK_SRC__*/
  /* Pure pagination: every page is a self-contained unit. Each chunk carries its
     own column header (headOv = frame + thead); continuation chunks add a
     "(continued)" label (contH). Whole rows only - a row never splits. */
  function packPages(model, BUDGET){
    var pages=[], cur=null, used=0;
    function open(){ cur={doc:false,proj:-1,name:false,cont:false,r0:0,r1:0,foot:false}; used=0; }
    function close(){ if(cur) pages.push(cur); cur=null; }
    open();
    if(model.docH){ cur.doc=true; used+=model.docH; }
    for(var p=0;p<model.projs.length;p++){
      var pr=model.projs[p];
      if(p>0){ close(); open(); }                 /* each project starts a fresh page */
      var i=0, first=true;
      while(i<pr.rows.length || first){
        var ov=(first?pr.nameH:pr.contH)+pr.headOv;
        var avail=BUDGET-used-ov;
        var cnt=0,h=0;
        while(i+cnt<pr.rows.length && h+pr.rows[i+cnt]<=avail){ h+=pr.rows[i+cnt]; cnt++; }
        if(cnt===0 && i<pr.rows.length){
          if(used>0){ close(); open(); continue; }/* retry on a clean page */
          cnt=1; h=pr.rows[i];                    /* single row taller than a page: force */
        }
        cur.proj=p;
        if(first) cur.name=true; else cur.cont=true;
        cur.r0=i; cur.r1=i+cnt;
        used+=ov+h; i+=cnt; first=false;
        if(i<pr.rows.length){ close(); open(); }
        else break;
      }
    }
    if(model.footH){
      if(used+model.footH>BUDGET && used>0){ close(); open(); }
      cur.foot=true; used+=model.footH;
    }
    close();
    return pages;
  }
/*__PACK_END__*/

  function paginate(){
    var body=document.body;
    /* 1. Stage the document offscreen at exact printable width and measure. */
    var master=document.createElement('div');
    master.style.cssText='width:'+CW+'px;position:absolute;left:-100000px;top:0;background:#fff';
    var kids=[].slice.call(body.children);
    for(var i=0;i<kids.length;i++){
      var el=kids[i];
      if(el.tagName==='SCRIPT'||el.tagName==='STYLE') continue;
      if(el.classList&&el.classList.contains('print-bar')) continue;
      master.appendChild(el);
    }
    body.style.padding='0'; body.style.margin='0';
    body.appendChild(master);

    var docEl=master.querySelector('.doc-header');
    var footEl=master.querySelector('.doc-footer');
    var blocks=[].slice.call(master.querySelectorAll('.proj-block'));
    /* continuation label sample - measured once, reused */
    var contSample=document.createElement('div');
    contSample.style.cssText='font:600 9px Arial,sans-serif;color:#4f46e5;letter-spacing:.04em;padding:0 0 4px';
    contSample.textContent='X - continued';
    master.appendChild(contSample);
    var contH=outerH(contSample);
    master.removeChild(contSample);

    var projs=[];
    for(var b=0;b<blocks.length;b++){
      var blk=blocks[b];
      var nameEl=blk.querySelector('.proj-name');
      var sv=blk.querySelector('.split-view');
      var tableEl=sv?sv.querySelector('table'):blk.querySelector('table');
      var theadEl=tableEl?tableEl.querySelector('thead'):null;
      var rowEls=tableEl?[].slice.call(tableEl.querySelectorAll('tbody tr')):[];
      var svgEl=sv?sv.querySelector('svg'):null;
      var tHalf=sv?sv.querySelector('.split-table'):null;
      projs.push({
        nameEl:nameEl, nameH:outerH(nameEl),
        nameTxt:nameEl?nameEl.textContent:'',
        split:!!sv,
        tableW:tHalf?tHalf.getBoundingClientRect().width:0,
        ganttW:svgEl?svgEl.getBoundingClientRect().width:0,
        theadEl:theadEl, rowEls:rowEls, svgEl:svgEl,
        contH:contH,
        headOv:2+(theadEl?theadEl.getBoundingClientRect().height:0),
        rows:rowEls.map(function(r){return r.getBoundingClientRect().height;})
      });
    }
    var model={docH:outerH(docEl), footH:outerH(footEl), projs:projs};
    var pages=packPages(model, CH);

    /* 2. Assemble each page as a real, self-contained DOM unit. */
    function svgWindow(svgEl,y0,h,w){
      var win=document.createElement('div');
      win.style.cssText='width:'+w+'px;height:'+h+'px;overflow:hidden;position:relative;flex-shrink:0';
      var c=svgEl.cloneNode(true);
      c.style.position='absolute'; c.style.left='0'; c.style.top=(-y0)+'px'; c.style.width=w+'px';
      win.appendChild(c);
      return win;
    }
    function buildPage(pg){
      var page=document.createElement('div');
      page.style.cssText='width:'+CW+'px;background:#fff';
      if(pg.doc&&docEl) page.appendChild(docEl);
      if(pg.proj>=0){
        var pr=projs[pg.proj];
        if(pg.name&&pr.nameEl) page.appendChild(pr.nameEl);
        if(pg.cont){
          var cl=document.createElement('div');
          cl.style.cssText='font:600 9px Arial,sans-serif;color:#4f46e5;letter-spacing:.04em;padding:0 0 4px';
          cl.textContent=pr.nameTxt+' - continued';
          page.appendChild(cl);
        }
        var framed=document.createElement('div');
        framed.style.cssText='border:1px solid '+FRAME+';background:#fff'+(pr.split?';display:flex;align-items:flex-start':'');
        var tbl=document.createElement('table');
        tbl.className='aligned';
        if(pr.theadEl) tbl.appendChild(pr.theadEl.cloneNode(true));
        var tb=document.createElement('tbody');
        for(var r=pg.r0;r<pg.r1;r++) tb.appendChild(pr.rowEls[r]);   /* move real rows */
        tbl.appendChild(tb);
        if(pr.split){
          var left=document.createElement('div');
          left.className='split-table';
          left.style.cssText='width:'+pr.tableW+'px;flex-shrink:0';
          left.appendChild(tbl);
          framed.appendChild(left);
          var right=document.createElement('div');
          right.className='split-gantt';                                                              /* keep the class so column drag-resize can trade width against it (B392) */
          right.style.cssText='width:'+pr.ganttW+'px;flex-shrink:0';
          if(pr.svgEl){                                                                                   /* a project filtered to zero rows yields an empty Gantt (no <svg>) → svgEl null; guard so svgWindow's cloneNode can't throw and blank the whole PDF */
            right.appendChild(svgWindow(pr.svgEl,0,GANTT_HEAD,pr.ganttW));                                /* date band: repeats every page */
            if(pg.r1>pg.r0) right.appendChild(svgWindow(pr.svgEl,GANTT_HEAD+pg.r0*GANTT_ROW,(pg.r1-pg.r0)*GANTT_ROW,pr.ganttW));
          }
          framed.appendChild(right);
        } else {
          framed.appendChild(tbl);
        }
        page.appendChild(framed);
      }
      if(pg.foot&&footEl) page.appendChild(footEl);
      return page;
    }

    var pageEls=pages.map(buildPage);
    master.parentNode.removeChild(master);

    /* 3. Render: preview = sheets on gray; print = one block per page. */
    if(MODE==='preview'){
      var wrap=document.createElement('div');
      wrap.style.cssText='width:'+PW+'px;padding:14px 0 6px;box-sizing:border-box';
      for(var p=0;p<pageEls.length;p++){
        var sheet=document.createElement('div');
        sheet.style.cssText='width:'+PW+'px;height:'+PH+'px;background:#fff;box-sizing:border-box;padding:'+MT+'px '+MR+'px '+MB+'px '+ML+'px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.35)';
        sheet.appendChild(pageEls[p]);
        wrap.appendChild(sheet);
        var lbl=document.createElement('div');
        lbl.textContent='Page '+(p+1)+' of '+pageEls.length;
        lbl.style.cssText='text-align:center;font:600 8px Arial,sans-serif;color:#56616b;letter-spacing:.9px;text-transform:uppercase;padding:7px 0 11px';
        wrap.appendChild(lbl);
      }
      body.style.background='#a9b2bb';
      body.appendChild(wrap);
      window.parent.postMessage({type:'planarPreviewHeight', h: body.scrollHeight}, '*');
    } else {
      var st=document.createElement('style');
      st.textContent='.pg{page-break-after:always;break-after:page;page-break-inside:avoid;break-inside:avoid}'
        +'.pg:last-child{page-break-after:auto;break-after:auto}'
        +'@media screen{body{background:#eef0f2;padding:18px 0}.pg{margin:0 auto 16px;outline:1px solid #d8d8d8;background:#fff;padding:'+MT+'px '+MR+'px '+MB+'px '+ML+'px;width:'+PW+'px;box-sizing:border-box}}'
        +'@media print{.pg{width:'+CW+'px}}';
      document.head.appendChild(st);
      for(var q=0;q<pageEls.length;q++){ pageEls[q].className='pg'; body.appendChild(pageEls[q]); }
    }
  }
  function go(){
    if(document.fonts && document.fonts.ready){ document.fonts.ready.then(function(){ setTimeout(paginate,30); }); }
    else setTimeout(paginate,80);
  }
  window.addEventListener('load',go);
})();
/*__PAGINATE_END__*/
<\/script>
<div class="doc-header">
  <div class="dh-left">
    ${cfg.exhibitLabel?`<div class="exhibit">${escapeHtml(cfg.exhibitLabel)}</div>`:""}
    <div class="title">${escapeHtml(cfg.projectTitle)}</div>
    ${cfg.preparedFor?`<div class="subline">Prepared for: <strong>${escapeHtml(cfg.preparedFor)}</strong></div>`:""}
  </div>
  <div class="dh-right">
    <div>Date:&nbsp;<strong>${escapeHtml(cfg.docDate)}</strong></div>
    ${cfg.preparedBy?`<div>Prepared by:&nbsp;<strong>${escapeHtml(cfg.preparedBy)}</strong></div>`:""}
    ${cfg.confidential?`<div class="conf">${escapeHtml(cfg.confidential)}</div>`:""}
  </div>
</div>
${bodyHtml}
<div class="doc-footer">
  <span>Generated ${new Date().toLocaleString()}</span>
  <span>${escapeHtml(cfg.confidential||"")}</span>
  <span>planar</span>
</div>
${forPreview?`<script>(function(){document.addEventListener("click",function(e){var el=e.target.closest&&e.target.closest("[data-collapse]");if(!el)return;e.preventDefault();e.stopPropagation();try{window.parent.postMessage({type:"planarToggleCollapse",key:el.getAttribute("data-collapse")},"*");}catch(_){}}, true);})();<\/script>`:""}
${resizeScript}
</body></html>`;
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  PAGE_SIZES: [() => PAGE_SIZES],
  buildGanttSVG: [() => buildGanttSVG],
  EXHIBIT_MIN_GANTT: [() => EXHIBIT_MIN_GANTT],
  approxTextPx: [() => approxTextPx],
  layoutExhibitCols: [() => layoutExhibitCols],
  buildPDFHtml: [() => buildPDFHtml],
});
