/* Mock up alternative Gantt TIMELINE-HEADER designs, drawn from real scheduling software
 * (MS Project / Primavera P6 / Smartsheet / TeamGantt), rendered over a realistic multi-year
 * range with sample bars + a dependency elbow so each header reads in context. Output: one
 * comparison PNG (ui-audit/screens/gantt-header-mockups.png). Pure render — nothing wired in. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

// ── Timeline range: a realistic ~21-month industrial schedule (Jun 2026 → Mar 2028) ──
const D0 = new Date(2026, 5, 1), DEND = new Date(2028, 2, 31);
const W = 940, PADX = 0;
const totalDays = (DEND - D0) / 86400000;
const ppd = (W - PADX) / totalDays;
const xOf = (d) => PADX + ((d - D0) / 86400000) * ppd;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON1 = "JFMAMJJASOND";
const QMON = [0, 3, 6, 9];

const months = (() => { const o = []; let c = new Date(D0.getFullYear(), D0.getMonth(), 1); while (c <= DEND) { const nx = new Date(c.getFullYear(), c.getMonth() + 1, 1); o.push({ x: xOf(c), x1: xOf(nx > DEND ? DEND : nx), mo: c.getMonth(), yr: c.getFullYear() }); c = nx; } return o; })();
const quarters = (() => { const o = []; let c = new Date(D0.getFullYear(), Math.floor(D0.getMonth() / 3) * 3, 1); while (c <= DEND) { const nx = new Date(c.getFullYear(), c.getMonth() + 3, 1); o.push({ x: xOf(c < D0 ? D0 : c), x1: xOf(nx > DEND ? DEND : nx), q: Math.floor(c.getMonth() / 3) + 1, yr: c.getFullYear() }); c = nx; } return o; })();
const years = (() => { const o = []; let c = new Date(D0.getFullYear(), 0, 1); while (c <= DEND) { const nx = new Date(c.getFullYear() + 1, 0, 1); o.push({ x: xOf(c < D0 ? D0 : c), x1: xOf(nx > DEND ? DEND : nx), yr: c.getFullYear() }); c = nx; } return o; })();
const cx = (a) => (a.x + a.x1) / 2;
const monW = ppd * 30.4;

// ── Shared chart BODY (identical under every header so only the header differs) ──
const tasks = [
  { kind: "summary", s: new Date(2026, 6, 1), e: new Date(2027, 11, 20) },
  { kind: "done", s: new Date(2026, 6, 1), e: new Date(2026, 9, 15) },
  { kind: "partial", s: new Date(2026, 10, 1), e: new Date(2027, 3, 10), pct: 60 },
  { kind: "todo", s: new Date(2027, 4, 1), e: new Date(2027, 10, 30) },
  { kind: "ms", s: new Date(2028, 0, 15) },
];
const ROW_H = 18, GRAY = "#94a3b8", NAVY = "#2B3340";
function elbow(x1, y1, x2, y2) { const STUB = 9, xa = x1 + STUB, xb = x2 - STUB, gY = y2 - ROW_H * 0.5; return `M${x1},${y1} L${xa},${y1} L${xa},${gY} L${xb},${gY} L${xb},${y2} L${x2},${y2}`; }
function body(yTop) {
  let s = "";
  tasks.forEach((t, i) => { const y = yTop + i * ROW_H; s += `<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="${i % 2 ? "#f6f7f9" : "#fff"}"/>`; });
  // dependency elbow: done → partial (FS)
  const yDone = yTop + 1 * ROW_H + ROW_H / 2, yPart = yTop + 2 * ROW_H + ROW_H / 2;
  s += `<path d="${elbow(xOf(tasks[1].e), yDone, xOf(tasks[2].s), yPart)}" stroke="#0969da" stroke-width="1" fill="none" opacity="0.8"/>`;
  s += `<polygon points="${xOf(tasks[2].s)},${yPart} ${xOf(tasks[2].s) - 6},${yPart - 3} ${xOf(tasks[2].s) - 6},${yPart + 3}" fill="#0969da" opacity="0.9"/>`;
  tasks.forEach((t, i) => {
    const y = yTop + i * ROW_H, mid = y + ROW_H * 0.5;
    if (t.kind === "summary") { const bx = xOf(t.s), bw = xOf(t.e) - bx, sTop = y + ROW_H - 2 - 0.42 * ROW_H - 4.5; s += `<rect x="${bx}" y="${sTop}" width="${bw}" height="4.5" rx="1" fill="${NAVY}"/><rect x="${bx}" y="${sTop}" width="1.1" height="${4.5 + 0.42 * ROW_H}" fill="${NAVY}"/><rect x="${bx + bw - 1.1}" y="${sTop}" width="1.1" height="${4.5 + 0.42 * ROW_H}" fill="${NAVY}"/>`; }
    else if (t.kind === "ms") { const bx = xOf(t.s); s += `<polygon points="${bx},${mid - 5} ${bx + 5},${mid} ${bx},${mid + 5} ${bx - 5},${mid}" fill="${GRAY}" stroke="${GRAY}" stroke-width="1.1"/>`; }
    else { const LH = ROW_H * 0.3, by = mid - LH / 2, bx = xOf(t.s), bw = Math.max(5, xOf(t.e) - bx), r = LH / 2; if (t.kind === "done") s += `<rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="${GRAY}"/>`; else if (t.kind === "todo") s += `<rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="#fff" stroke="${GRAY}" stroke-width="1.1"/>`; else { s += `<rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="${GRAY}" opacity="0.18"/><rect x="${bx}" y="${by}" width="${bw * t.pct / 100}" height="${LH}" rx="${r}" fill="${GRAY}"/><rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="none" stroke="${GRAY}" stroke-width="0.8"/>`; } }
  });
  return s;
}
const bodyH = tasks.length * ROW_H;
function gridAndToday(yTop, opt) {
  let s = "";
  // faint month ticks
  s += months.map((m) => `<line x1="${m.x}" y1="${yTop}" x2="${m.x}" y2="${yTop + bodyH}" stroke="#edf0f3" stroke-width="0.5"/>`).join("");
  // quarter or year emphasis depending on the option
  if (opt.quarterGrid) s += quarters.map((q) => `<line x1="${q.x}" y1="${yTop}" x2="${q.x}" y2="${yTop + bodyH}" stroke="#cdd3db" stroke-width="0.8"/>`).join("");
  s += years.map((y) => `<line x1="${y.x}" y1="${yTop}" x2="${y.x}" y2="${yTop + bodyH}" stroke="#9aa2ae" stroke-width="1.1"/>`).join("");
  const tx = xOf(new Date(2026, 5, 22));
  s += `<line x1="${tx}" y1="${yTop}" x2="${tx}" y2="${yTop + bodyH}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3,2"/>`;
  return s;
}

// ════ HEADER VARIANTS ════
// A — Year ▸ Month, dark (MS Project / P6 classic, matches the app's dark exhibit theme)
function headerA() {
  const yT = 16, mT = 18, H = yT + mT;
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#1a1a1a"/><rect x="0" y="${yT}" width="${W}" height="${mT}" fill="#2b3138"/>`;
  s += years.map((y) => `<line x1="${y.x}" y1="0" x2="${y.x}" y2="${H}" stroke="#5b6470" stroke-width="1"/><text x="${y.x + 6}" y="11.5" font-size="10" font-weight="700" fill="#fff" font-family="Arial">${y.yr}</text>`).join("");
  s += months.map((m) => { const lbl = monW < 24 ? MON1[m.mo] : MON[m.mo]; const strong = m.mo === 0; return `<line x1="${m.x}" y1="${yT}" x2="${m.x}" y2="${H}" stroke="${QMON.includes(m.mo) ? "#586270" : "#3a4047"}" stroke-width="0.6"/><text x="${cx(m)}" y="${yT + 12.5}" font-size="${strong ? 8 : 7.5}" font-weight="${strong ? 700 : 500}" fill="${strong ? "#fff" : "#c7ccd3"}" font-family="Arial" text-anchor="middle">${lbl}</text>`; }).join("");
  return { svg: s, H };
}
// B — Year ▸ Quarter, dark (best for long multi-year exhibits; months collapse to quarters)
function headerB() {
  const yT = 16, qT = 18, H = yT + qT;
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#1a1a1a"/><rect x="0" y="${yT}" width="${W}" height="${qT}" fill="#2b3138"/>`;
  s += years.map((y) => `<line x1="${y.x}" y1="0" x2="${y.x}" y2="${H}" stroke="#5b6470" stroke-width="1"/><text x="${y.x + 6}" y="11.5" font-size="10" font-weight="700" fill="#fff" font-family="Arial">${y.yr}</text>`).join("");
  s += quarters.map((q) => `<line x1="${q.x}" y1="${yT}" x2="${q.x}" y2="${H}" stroke="${q.q === 1 ? "#586270" : "#3a4047"}" stroke-width="0.7"/><text x="${cx(q)}" y="${yT + 12.5}" font-size="8" font-weight="600" fill="#d3d8df" font-family="Arial" text-anchor="middle">Q${q.q}</text>`).join("");
  return { svg: s, H };
}
// C — Year ▸ Quarter ▸ Month, dark (full P6 / MS Project hierarchy)
function headerC() {
  const yT = 14, qT = 13, mT = 16, H = yT + qT + mT;
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#1a1a1a"/><rect x="0" y="${yT}" width="${W}" height="${qT}" fill="#262c33"/><rect x="0" y="${yT + qT}" width="${W}" height="${mT}" fill="#323840"/>`;
  s += years.map((y) => `<line x1="${y.x}" y1="0" x2="${y.x}" y2="${H}" stroke="#5b6470" stroke-width="1"/><text x="${y.x + 6}" y="10.5" font-size="9.5" font-weight="700" fill="#fff" font-family="Arial">${y.yr}</text>`).join("");
  s += quarters.map((q) => `<line x1="${q.x}" y1="${yT}" x2="${q.x}" y2="${H}" stroke="#4a525d" stroke-width="0.7"/><text x="${cx(q)}" y="${yT + 9.5}" font-size="7.5" font-weight="600" fill="#aeb5bf" font-family="Arial" text-anchor="middle">Q${q.q}</text>`).join("");
  s += months.map((m) => `<line x1="${m.x}" y1="${yT + qT}" x2="${m.x}" y2="${H}" stroke="#3a4047" stroke-width="0.5"/><text x="${cx(m)}" y="${yT + qT + 11.5}" font-size="7" font-weight="500" fill="#c7ccd3" font-family="Arial" text-anchor="middle">${monW < 22 ? MON1[m.mo] : MON[m.mo]}</text>`).join("");
  return { svg: s, H };
}
// D — Year ▸ Month, LIGHT & airy (Smartsheet / TeamGantt modern look)
function headerD() {
  const yT = 16, mT = 19, H = yT + mT;
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#f1f3f6"/><rect x="0" y="${yT}" width="${W}" height="${mT}" fill="#fafbfc"/><line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="#d4d8de" stroke-width="1"/>`;
  s += years.map((y) => `<line x1="${y.x}" y1="0" x2="${y.x}" y2="${H}" stroke="#c2c8d0" stroke-width="1"/><text x="${cx(y)}" y="11.5" font-size="9.5" font-weight="700" fill="#475569" font-family="Arial" text-anchor="middle" letter-spacing="1">${y.yr}</text>`).join("");
  s += months.map((m) => { const strong = QMON.includes(m.mo); return `<line x1="${m.x}" y1="${yT}" x2="${m.x}" y2="${H}" stroke="${strong ? "#d4d8de" : "#e9edf1"}" stroke-width="${strong ? 0.8 : 0.5}"/><text x="${cx(m)}" y="${yT + 13}" font-size="${monW < 24 ? 7 : 7.5}" font-weight="${strong ? 700 : 500}" fill="${strong ? "#334155" : "#64748b"}" font-family="Arial" text-anchor="middle">${monW < 24 ? MON1[m.mo] : MON[m.mo]}</text>`; }).join("");
  return { svg: s, H };
}

const VARIANTS = [
  ["A", "Year ▸ Month — two-tier, dark (MS Project / Primavera P6 classic; matches your exhibit's dark band)", headerA, { quarterGrid: false }],
  ["B", "Year ▸ Quarter — two-tier, dark (best for long multi-year exhibits; months are too dense to read)", headerB, { quarterGrid: true }],
  ["C", "Year ▸ Quarter ▸ Month — three-tier, dark (full P6 / MS Project hierarchy, most detail)", headerC, { quarterGrid: false }],
  ["D", "Year ▸ Month — two-tier, LIGHT (Smartsheet / TeamGantt modern, airy look)", headerD, { quarterGrid: false }],
];

const CARD_W = W + 40, GAP = 26;
let blocks = "", yCursor = 14;
const cards = VARIANTS.map(([id, desc, fn, opt]) => {
  const { svg, H } = fn();
  const totalH = H + bodyH;
  const card = `<div style="margin:0 0 ${GAP}px 0">
    <div style="font:700 13px Arial;color:#111;margin:0 0 2px 2px">Option ${id} — ${desc.split(" — ")[1] || desc}</div>
    <div style="font:600 10.5px Arial;color:#6b7280;margin:0 0 7px 2px">${desc.split(" (")[1] ? "(" + desc.split(" (")[1] : ""}</div>
    <div style="box-shadow:0 1px 4px rgba(0,0,0,.18);border:1px solid #d4d4d4;width:${W}px">
      <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" style="display:block">
        <rect width="${W}" height="${totalH}" fill="#fff"/>
        ${gridAndToday(H, opt)}
        ${svg}
        ${body(H)}
      </svg>
    </div>
  </div>`;
  return card;
});

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:22px 22px 8px;background:#fff;font-family:Arial}</style></head>
<body>
  <div style="font:800 17px Arial;color:#111;margin:0 0 3px">Gantt timeline-header — design options</div>
  <div style="font:500 12px Arial;color:#555;margin:0 0 18px">Same sample chart under each header (summary bracket · complete / in-progress / not-started bars · milestone · FS dependency elbow · red dashed = today). Pick one to ship into the export (and, if you want, the on-screen Gantt).</div>
  ${cards.join("")}
</body></html>`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: CARD_W + 44, height: 1400 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: "ui-audit/screens/gantt-header-mockups.png", fullPage: true });
await browser.close();
console.log("wrote ui-audit/screens/gantt-header-mockups.png");
