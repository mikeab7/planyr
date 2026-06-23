/* Faithful preview of the SHIPPED export header (B396, owner pick "D"): light two-tier
 * Year ▸ Month band + weighted vertical rules (year > quarter > month, quarter line only),
 * all behind the bars. Rendered at a realistic ~21-month range so month names show in full.
 * Mirrors the exact colors/weights now in buildGanttSVG. Output: gantt-header-final.png */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const D0 = new Date(2026, 5, 1), DEND = new Date(2028, 2, 31), W = 900;
const totalDays = (DEND - D0) / 86400000, ppd = W / totalDays;
const xOf = (d) => ((d - D0) / 86400000) * ppd;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const months = (() => { const o = []; let c = new Date(D0.getFullYear(), D0.getMonth(), 1); while (c <= DEND) { const nx = new Date(c.getFullYear(), c.getMonth() + 1, 1); o.push({ x: xOf(c < D0 ? D0 : c), x1: xOf(nx > DEND ? DEND : nx), mo: c.getMonth(), yr: c.getFullYear() }); c = nx; } return o; })();
months.forEach((m) => (m.cx = (m.x + m.x1) / 2));
const yearSpans = []; months.forEach((m) => { const l = yearSpans[yearSpans.length - 1]; if (l && l.yr === m.yr) l.x1 = m.x1; else yearSpans.push({ yr: m.yr, x0: m.x, x1: m.x1 }); }); yearSpans.forEach((y) => (y.cx = (y.x0 + y.x1) / 2));
const monthPx = ppd * 30.4, monLabel = (m) => (monthPx >= 30 ? MON[m.mo] : MON[m.mo][0]);

const YEAR_TIER = 14, MON_TIER = 16, HEADER_H = 30, ROW_H = 18, GRAY = "#94a3b8", NAVY = "#2B3340";
const tasks = [
  { kind: "summary", s: new Date(2026, 6, 1), e: new Date(2027, 11, 20), name: "Utilities & Permitting" },
  { kind: "done", s: new Date(2026, 6, 1), e: new Date(2026, 9, 15), name: "TCEQ WWTP discharge permit" },
  { kind: "partial", s: new Date(2026, 10, 1), e: new Date(2027, 3, 10), pct: 60, name: "Water well & treatment design" },
  { kind: "todo", s: new Date(2027, 4, 1), e: new Date(2027, 10, 30), name: "COH water-facility permit" },
  { kind: "ms", s: new Date(2028, 0, 15), name: "Permit approval" },
];
const svgH = HEADER_H + tasks.length * ROW_H;
function elbow(x1, y1, x2, y2) { const xa = x1 + 9, xb = x2 - 9, gY = y2 - ROW_H * 0.5; return `M${x1},${y1} L${xa},${y1} L${xa},${gY} L${xb},${gY} L${xb},${y2} L${x2},${y2}`; }
let bands = "", bars = "";
tasks.forEach((t, i) => { const y = HEADER_H + i * ROW_H, mid = y + ROW_H * 0.5; bands += `<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="${i % 2 ? "#f6f6f6" : "#fff"}"/>`;
  if (t.kind === "summary") { const bx = xOf(t.s), bw = xOf(t.e) - bx, sTop = y + ROW_H - 2 - 0.42 * ROW_H - 4.5; bars += `<rect x="${bx}" y="${sTop}" width="${bw}" height="4.5" rx="1" fill="${NAVY}"/><rect x="${bx}" y="${sTop}" width="1.1" height="${4.5 + 0.42 * ROW_H}" fill="${NAVY}"/><rect x="${bx + bw - 1.1}" y="${sTop}" width="1.1" height="${4.5 + 0.42 * ROW_H}" fill="${NAVY}"/>`; }
  else if (t.kind === "ms") { const bx = xOf(t.s); bars += `<polygon points="${bx},${mid - 5} ${bx + 5},${mid} ${bx},${mid + 5} ${bx - 5},${mid}" fill="${GRAY}" stroke="${GRAY}" stroke-width="1.1"/>`; }
  else { const LH = ROW_H * 0.3, by = mid - LH / 2, bx = xOf(t.s), bw = Math.max(5, xOf(t.e) - bx), r = LH / 2; if (t.kind === "done") bars += `<rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="${GRAY}"/>`; else if (t.kind === "todo") bars += `<rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="#fff" stroke="${GRAY}" stroke-width="1.1"/>`; else bars += `<rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="${GRAY}" opacity="0.18"/><rect x="${bx}" y="${by}" width="${bw * t.pct / 100}" height="${LH}" rx="${r}" fill="${GRAY}"/><rect x="${bx}" y="${by}" width="${bw}" height="${LH}" rx="${r}" fill="none" stroke="${GRAY}" stroke-width="0.8"/>`; }
});
const yDone = HEADER_H + 1 * ROW_H + ROW_H / 2, yPart = HEADER_H + 2 * ROW_H + ROW_H / 2;
const dep = `<path d="${elbow(xOf(tasks[1].e), yDone, xOf(tasks[2].s), yPart)}" stroke="#0969da" stroke-width="1" fill="none" opacity="0.75"/><polygon points="${xOf(tasks[2].s)},${yPart} ${xOf(tasks[2].s) - 6},${yPart - 3} ${xOf(tasks[2].s) - 6},${yPart + 3}" fill="#0969da" opacity="0.85"/>`;
const grid = months.map((m) => { if (m.mo === 0) return `<line x1="${m.x}" y1="0" x2="${m.x}" y2="${svgH}" stroke="#8b95a3" stroke-width="1.3"/>`; if (m.mo % 3 === 0) return `<line x1="${m.x}" y1="${YEAR_TIER}" x2="${m.x}" y2="${svgH}" stroke="#c2c9d2" stroke-width="0.8"/>`; return `<line x1="${m.x}" y1="${YEAR_TIER}" x2="${m.x}" y2="${svgH}" stroke="#e7ebf0" stroke-width="0.4"/>`; }).join("");
const tx = xOf(new Date(2026, 5, 22));
const today = `<line x1="${tx}" y1="${HEADER_H}" x2="${tx}" y2="${svgH}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3,2"/><polygon points="${tx - 3.5},${HEADER_H - 5} ${tx + 3.5},${HEADER_H - 5} ${tx},${HEADER_H}" fill="#dc2626"/>`;
const headerBg = `<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="#f6f8fa"/><rect x="0" y="0" width="${W}" height="${YEAR_TIER}" fill="#e9edf2"/>`;
const yearLabels = yearSpans.map((y) => `<text x="${y.cx}" y="${YEAR_TIER - 3.5}" font-size="9.5" font-weight="700" fill="#3a4452" font-family="Arial" text-anchor="middle" letter-spacing="0.6">${y.yr}</text>`).join("");
const monthLabels = months.map((m) => { const strong = m.mo % 3 === 0; return `<text x="${m.cx}" y="${HEADER_H - 5}" font-size="7.5" font-weight="${strong ? 700 : 500}" fill="${strong ? "#3a4452" : "#69727f"}" font-family="Arial" text-anchor="middle">${monLabel(m)}</text>`; }).join("");
const headerLines = `<line x1="0" y1="${YEAR_TIER}" x2="${W}" y2="${YEAR_TIER}" stroke="#d4d8de" stroke-width="0.7"/><line x1="0" y1="${HEADER_H}" x2="${W}" y2="${HEADER_H}" stroke="#b9c0c9" stroke-width="1"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${svgH}"><rect width="${W}" height="${svgH}" fill="#fff"/>${headerBg}${bands}${grid}${today}${dep}${bars}${yearLabels}${monthLabels}${headerLines}</svg>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:22px;background:#fff;font-family:Arial}</style></head><body>
<div style="font:800 16px Arial;color:#111;margin:0 0 4px">New export Gantt header — shipped design (your Option D, refined)</div>
<div style="font:500 12px Arial;color:#555;margin:0 0 14px;max-width:900px">Light two-tier <b>Year ▸ Month</b> band. Vertical rules drop through the chart, weighted <b>year (thickest) ▸ quarter (medium, line only — no label) ▸ month (thinnest)</b>, all light and <b>behind</b> the bars. Sample: summary bracket · complete / in-progress / not-started bars · milestone · dependency elbow · red dashed = today.</div>
<div style="box-shadow:0 1px 5px rgba(0,0,0,.2);border:1px solid #d4d4d4;width:${W}px">${svg}</div>
</body></html>`;
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: W + 90, height: svgH + 130 }, deviceScaleFactor: 2.5 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: "ui-audit/screens/gantt-header-final.png", fullPage: true });
await browser.close();
console.log("wrote ui-audit/screens/gantt-header-final.png");
