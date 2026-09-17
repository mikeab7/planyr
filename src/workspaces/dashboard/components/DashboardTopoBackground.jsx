/* DashboardTopoBackground — the animated topographic contour field behind the dashboard's
 * card grid (B1302129/V940769, "dashboard-topo-background" owner chat block). Ported, not
 * reinvented, from the plain-canvas-2D renderer the owner supplied verbatim (the same
 * marching-squares contour trace + 3D value-noise field that drives the marketing landing
 * page's hero treatment) — the marching-squares table, the noise functions and the per-cell
 * min/max level skip in draw() are copied over unchanged. That skip is what keeps this at
 * 60fps (only cells whose four corner values actually straddle a contour level do any work);
 * do not remove it chasing a "simpler" rewrite.
 *
 * This is a WORKING SURFACE, not a hero — every difference from the pasted source is
 * deliberate and stated here so a future edit doesn't quietly undo one:
 *  - Lines render at a fraction of the source's opacity (DIM_ALPHA below) so they read as
 *    quiet texture in the gutters between cards, never competing with a card's own text —
 *    tuned by looking at a real screenshot of the dashboard, not guessed.
 *  - Colors come from this app's own theme tokens (usePalette(), light/dark-aware — the
 *    landing page is permanently dark, the dashboard is not) for the contour lines, and the
 *    real brand coral (BRAND.coral, src/shared/brand/tokens.js) for the cursor highlight —
 *    never the pasted source's literal hex approximations.
 *  - The loop stops dead whenever `paused` is true (Dashboard.jsx passes this while a card is
 *    being dragged or resized in react-grid-layout) — repainting a full-viewport canvas every
 *    frame during a drag is exactly how a drag gesture gets janky.
 *  - Fixed behind the grid and the app header, `pointer-events: none` — it must never be able
 *    to intercept a click, a drag, or a resize handle. (Dashboard.jsx stacks its scrollable
 *    content at a higher z-index for this — see that file's own note.)
 *
 * Every guard from the source is kept, unchanged in spirit: `prefers-reduced-motion` and a
 * coarse (touch) pointer each render exactly one static frame — no rAF loop, no pointer
 * tracking, so this never runs on a phone; the tab-hidden check cancels the animation frame
 * outright rather than continuing to compute an off-screen picture. Both guards mean the SETTLE
 * easing below (NEW-2) never runs in either case either — there is no rAF loop for it to run in.
 *
 * NEW-2 (2026-09-17, owner ask: "the background topo should have some lag to it") — the cursor
 * highlight's position/intensity now ease toward the raw cursor position (`lib/topoMotion.js`'s
 * `easeToward`, the SETTLE dial) instead of the plain inline lerp this used to hand-roll three
 * times. See that file's own header for the full follow/settle/depth reasoning — this component
 * has no scroll-driven motion at all; the cursor is the only input-driven mover, and the field's
 * large-scale drift (DEPTH) is pure ambient time, untouched by this item.
 */
import { useEffect, useRef } from "react";
import { useTheme, usePalette } from "../../../shared/theme/ThemeProvider.jsx";
import { BRAND } from "../../../shared/brand/tokens.js";
import { FOLLOW_RADIUS2, FOLLOW_STRENGTH, DEPTH_RATE, SETTLE_POS, SETTLE_STRENGTH, easeToward } from "../lib/topoMotion.js";

const L0 = -0.86, LSTEP = 0.098, LN = 32;
const SC = 0.0042;
const NARROW_PX = 720;

// A working surface reads the lines as quiet texture behind the cards, never the main event
// the way they are on the landing page (which strokes at full alpha) — the one deliberate
// intensity departure from the pasted source.
const DIM_ALPHA = 0.32;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function hash3(i, j, k) {
  let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function sm(v) { return v * v * (3 - 2 * v); }
function vn(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * 2 - 1;
}
function fbm(x, y, z) {
  return vn(x, y, z) * 0.64 + vn(x * 2.17 + 11.3, y * 2.17 - 7.7, z * 1.55 + 3.1) * 0.30;
}
function ex(v0, v1, L) {
  if (v1 === v0) return 0.5;
  const r = (L - v0) / (v1 - v0);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}
function seg(p, x1, y1, x2, y2) { p.moveTo(x1, y1); p.lineTo(x2, y2); }

export default function DashboardTopoBackground({ paused = false }) {
  const canvasRef = useRef(null);
  const pausedRef = useRef(paused);
  const controllerRef = useRef(null);
  const { resolved } = useTheme();
  const palette = usePalette();

  // A lightweight effect just to forward the latest `paused` value into the loop — this must
  // NOT rebuild the whole canvas/listener setup below on every drag start/stop.
  useEffect(() => {
    pausedRef.current = paused;
    controllerRef.current?.syncPaused();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let reduce = false, coarse = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* ignore */ }
    try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch { /* ignore */ }

    const lineColor = palette.borderStrong;
    const lineIdxColor = palette.textTertiary;
    const coralTopRgb = hexToRgb(BRAND.coral.top.face);
    const coralMidRgb = hexToRgb(BRAND.coral.mid.face);

    let W = 0, H = 0, dpr = 1, cs = 10, cols = 0, rows = 0, field = null;
    let t = 0, raf = 0, resizeTimer = 0;
    const ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, s: 0, ts: 0 };

    function build() {
      let k = 0;
      const S = ptr.s, R2 = 1 / (255 * 255);
      for (let j = 0; j <= rows; j++) {
        const py = j * cs;
        for (let i = 0; i <= cols; i++) {
          const px = i * cs;
          let v = fbm(px * SC, py * SC, t);
          if (S > 0.004) {
            const dx = px - ptr.x, dy = py - ptr.y;
            const d2 = (dx * dx + dy * dy) * R2;
            if (d2 < FOLLOW_RADIUS2) v += S * FOLLOW_STRENGTH * Math.exp(-d2);
          }
          field[k++] = v;
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const paths = new Array(LN);
      for (let l = 0; l < LN; l++) paths[l] = new Path2D();

      const stride = cols + 1;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const o = j * stride + i;
          const a = field[o], b = field[o + 1], c = field[o + stride + 1], d = field[o + stride];

          let mn = a, mx = a;
          if (b < mn) mn = b; if (b > mx) mx = b;
          if (c < mn) mn = c; if (c > mx) mx = c;
          if (d < mn) mn = d; if (d > mx) mx = d;

          let lo = Math.ceil((mn - L0) / LSTEP), hi = Math.floor((mx - L0) / LSTEP);
          if (lo < 0) lo = 0;
          if (hi > LN - 1) hi = LN - 1;
          if (lo > hi) continue;

          const x = i * cs, y = j * cs;
          for (let l = lo; l <= hi; l++) {
            const L = L0 + l * LSTEP;
            const code = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0);
            if (code === 0 || code === 15) continue;

            const TX = x + cs * ex(a, b, L), TY = y;
            const RX = x + cs, RY = y + cs * ex(b, c, L);
            const BX = x + cs * ex(d, c, L), BY = y + cs;
            const LX = x, LY = y + cs * ex(a, d, L);
            const p = paths[l];
            let ctr;

            switch (code) {
              case 1: case 14: seg(p, LX, LY, TX, TY); break;
              case 2: case 13: seg(p, TX, TY, RX, RY); break;
              case 3: case 12: seg(p, LX, LY, RX, RY); break;
              case 4: case 11: seg(p, RX, RY, BX, BY); break;
              case 6: case 9: seg(p, TX, TY, BX, BY); break;
              case 7: case 8: seg(p, LX, LY, BX, BY); break;
              case 5:
                ctr = (a + b + c + d) * 0.25;
                if (ctr > L) { seg(p, TX, TY, RX, RY); seg(p, LX, LY, BX, BY); }
                else { seg(p, LX, LY, TX, TY); seg(p, RX, RY, BX, BY); }
                break;
              case 10:
                ctr = (a + b + c + d) * 0.25;
                if (ctr > L) { seg(p, LX, LY, TX, TY); seg(p, RX, RY, BX, BY); }
                else { seg(p, TX, TY, RX, RY); seg(p, LX, LY, BX, BY); }
                break;
              default: break;
            }
          }
        }
      }

      ctx.lineCap = "round";
      ctx.globalAlpha = DIM_ALPHA;
      for (let l = 0; l < LN; l++) {
        const isIndex = l % 5 === 0;
        ctx.strokeStyle = isIndex ? lineIdxColor : lineColor;
        ctx.lineWidth = isIndex ? 1.3 : 0.75;
        ctx.stroke(paths[l]);
      }
      ctx.globalAlpha = 1;

      if (ptr.s > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = "source-atop";
        const g = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, 340);
        g.addColorStop(0, `rgba(${coralTopRgb},${(0.92 * ptr.s).toFixed(3)})`); // design-exempt: canvas gradient stop built from BRAND.coral (a token), not a literal
        g.addColorStop(0.5, `rgba(${coralMidRgb},${(0.40 * ptr.s).toFixed(3)})`); // design-exempt: canvas gradient stop built from BRAND.coral (a token), not a literal
        g.addColorStop(1, `rgba(${coralMidRgb},0)`); // design-exempt: canvas gradient stop built from BRAND.coral (a token), not a literal
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    function resize() {
      W = window.innerWidth;
      H = Math.max(window.innerHeight, document.documentElement.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cs = W < NARROW_PX ? 13 : 10;
      cols = Math.ceil(W / cs);
      rows = Math.ceil(H / cs);
      field = new Float32Array((cols + 1) * (rows + 1));
      build();
      draw();
    }

    function stopLoop() {
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    }
    function startLoop() {
      if (!raf && !reduce && !coarse && !pausedRef.current && !document.hidden) {
        raf = window.requestAnimationFrame(frame);
      }
    }
    function frame() {
      raf = window.requestAnimationFrame(frame);
      t += DEPTH_RATE;
      ptr.x = easeToward(ptr.x, ptr.tx, SETTLE_POS);
      ptr.y = easeToward(ptr.y, ptr.ty, SETTLE_POS);
      ptr.s = easeToward(ptr.s, ptr.ts, SETTLE_STRENGTH);
      build();
      draw();
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 140);
    }
    function onPointerMove(e) {
      if (ptr.ts === 0 && ptr.s < 0.02) { ptr.x = e.clientX; ptr.y = e.clientY; }
      ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.ts = 1;
    }
    function onPointerLeave() { ptr.ts = 0; }
    function onBlur() { ptr.ts = 0; }
    function onVisibilityChange() {
      if (document.hidden) stopLoop();
      else startLoop();
    }

    window.addEventListener("resize", onResize);
    if (!coarse && !reduce) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("mouseleave", onPointerLeave);
      window.addEventListener("blur", onBlur);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    resize();
    startLoop();

    controllerRef.current = {
      syncPaused() { if (pausedRef.current) stopLoop(); else startLoop(); },
    };

    return () => {
      stopLoop();
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseleave", onPointerLeave);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controllerRef.current = null;
    };
    // `resolved` (light/dark) intentionally re-runs this whole setup so the contour lines pick
    // up the new theme's tokens — a rare event, and simplest done as one clean remount rather
    // than threading a second color-only update path through the closures above.
  }, [resolved, palette]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="dashboard-topo-background"
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", display: "block" }}
    />
  );
}
