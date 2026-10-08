/* frameStats — pure reduction of per-frame rect recordings (verify-panel-resize-steady).
 * frames: [{ ex, ey, ew, tx, ty, tw }] (element + tile left/top/width per rAF). `releaseAt` = index of the first
 * frame after pointerup. Everything is in CSS px; the caller applies the tolerance. */
export function frameStats(frames, releaseAt = frames.length) {
  const hasTile = frames.length > 0 && frames.every((f) => f.tx != null);
  const jump = (k1, k2) => { let m = 0; for (let i = 1; i < frames.length; i++) m = Math.max(m, Math.abs(frames[i][k1] - frames[i - 1][k1]), Math.abs(frames[i][k2] - frames[i - 1][k2])); return m; };
  const exc = (k1, k2) => { let m = 0; for (const f of frames) m = Math.max(m, Math.abs(f[k1] - frames[0][k1]), Math.abs(f[k2] - frames[0][k2])); return m; };
  let relDrift = 0, sizeMax = 0, releaseHop = 0;
  if (frames.length) {
    const r0 = hasTile ? frames[0].ex - frames[0].tx : 0, q0 = hasTile ? frames[0].ey - frames[0].ty : 0;
    for (const f of frames) {
      if (hasTile) relDrift = Math.max(relDrift, Math.abs(f.ex - f.tx - r0), Math.abs(f.ey - f.ty - q0));
      sizeMax = Math.max(sizeMax, Math.abs(f.ew - frames[0].ew), hasTile ? Math.abs(f.tw - frames[0].tw) : 0);
    }
    const a = frames[Math.max(0, Math.min(releaseAt, frames.length - 1) - 1)], b = frames[frames.length - 1];
    releaseHop = Math.max(Math.abs(b.ex - a.ex), Math.abs(b.ey - a.ey), hasTile ? Math.abs(b.tx - a.tx) : 0);
  }
  return { hasTile, elMaxJump: jump("ex", "ey"), elExcursion: exc("ex", "ey"),
    tileMaxJump: hasTile ? jump("tx", "ty") : 0, tileExcursion: hasTile ? exc("tx", "ty") : 0, relDrift, sizeMax, releaseHop };
}
