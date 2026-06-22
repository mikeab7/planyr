// FAITHFUL COPY of the exhibit column-sizing helpers from public/sequence/index.html
// (compiled in-browser by Babel — not importable), so they can be unit-tested in node.
// The anti-drift block in test/exhibitCols.test.js asserts the real source still matches.
// Keep these byte-for-byte in sync with the originals above buildPDFHtml. (B385/B387)

export const EXHIBIT_MIN_GANTT = 240;

export function approxTextPx(str, fs){
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

export function layoutExhibitCols(specs, opts){
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
