/* zipRange.js — read ONE entry out of a huge remote .zip with HTTP Range requests (B2158065).
 * The central directory sits at the end of the file, so a ~90 KB tail read lists every entry; an entry
 * is then streamed (ranged GET from its local header) through DecompressionStream, and the caller can
 * STOP early — an account-sorted 573 MB file is never fully downloaded when the account is near the top.
 * Pure of any CAD knowledge. */
const UA = { "user-agent": "planyr-taxunits/1" };
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const dirCache = new Map();

/** Entry listing of a remote zip, or null when the URL does not serve one (404 etc.). */
export async function remoteZipEntries(url, fetchImpl = fetch) {
  if (dirCache.has(url)) return dirCache.get(url);
  const res = await fetchImpl(url, { headers: { ...UA, range: "bytes=-90000" } });
  if (res.status === 404) return null;
  if (!(res.status === 206 || res.status === 200)) throw new Error(`zip tail read failed: HTTP ${res.status}`);
  const total = Number((res.headers.get("content-range") || "").split("/")[1]) || null;
  const tail = new Uint8Array(await res.arrayBuffer());
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0 || total == null) throw new Error("zip end-of-central-directory not found");
  const count = u16(tail, e + 10);
  let p = u32(tail, e + 16) - (total - tail.length);
  if (p < 0) throw new Error("zip central directory outside the tail window");
  const td = new TextDecoder();
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (u32(tail, p) !== 0x02014b50) break;
    const nl = u16(tail, p + 28), xl = u16(tail, p + 30), cl = u16(tail, p + 32);
    entries[td.decode(tail.subarray(p + 46, p + 46 + nl))] = { method: u16(tail, p + 10), csize: u32(tail, p + 20), size: u32(tail, p + 24), off: u32(tail, p + 42) };
    p += 46 + nl + xl + cl;
  }
  dirCache.set(url, entries);
  return entries;
}

/** Stream an entry's INFLATED BYTES in the chunks the runtime hands back: `onChunk(Uint8Array) → true to stop`.
 * Pulled in bounded Range segments on demand: a single ranged GET of a 60 MB entry is read ahead by the runtime
 * far faster than it is inflated, and buffering the compressed bytes ran deep scans out of memory (Cloudflare
 * 1102). A ReadableStream with highWaterMark 0 only fetches the next segment when asked. */
export async function scanZipEntryChunks(url, entry, onChunk, fetchImpl = fetch, seg = 16 * 1024 * 1024) {
  const lh = new Uint8Array(await (await fetchImpl(url, { headers: { ...UA, range: `bytes=${entry.off}-${entry.off + 63}` } })).arrayBuffer());
  const start = entry.off + 30 + u16(lh, 26) + u16(lh, 28);
  let pos = start;
  const end = start + entry.csize;
  const src = new ReadableStream({
    async pull(c) {
      if (pos >= end) { c.close(); return; }
      const hi = Math.min(end, pos + seg) - 1;
      const r = await fetchImpl(url, { headers: { ...UA, range: `bytes=${pos}-${hi}` } });
      if (!r.ok) throw new Error(`zip entry read failed: HTTP ${r.status}`);
      c.enqueue(new Uint8Array(await r.arrayBuffer()));
      pos = hi + 1;
    },
  }, { highWaterMark: 0 });
  const rd = (entry.method === 0 ? src : src.pipeThrough(new DecompressionStream("deflate-raw"))).getReader();
  let bytes = 0, stopped = false;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    bytes += value.length;
    if (onChunk(value)) { stopped = true; break; }
  }
  await rd.cancel().catch(() => {});
  return { bytes, stopped };
}

/** Whole text of a SMALL entry (the rate table, ~2 MB). Never use on the 570 MB roll. */
export async function readZipEntryText(url, entry, fetchImpl = fetch) {
  const dec = new TextDecoder();
  let text = "";
  await scanZipEntryChunks(url, entry, (c) => { text += dec.decode(c, { stream: true }); return false; }, fetchImpl);
  return text + dec.decode();
}

/** The 13-digit account starting the FIRST COMPLETE line of a chunk, or null. Bytes only — no decoding. */
export function firstAcct(c) {
  const i = c.indexOf(10);
  if (i < 0 || i + 14 > c.length) return null;
  let s = "";
  for (let k = i + 1; k < i + 14; k++) { const b = c[k]; if (b < 48 || b > 57) return null; s += String.fromCharCode(b); }
  return s;
}
export const concatBytes = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** Absolute byte offset where an entry's compressed data begins (after its local header). */
export async function zipEntryDataStart(url, entry, fetchImpl = fetch) {
  const lh = new Uint8Array(await (await fetchImpl(url, { headers: { ...UA, range: `bytes=${entry.off}-${entry.off + 63}` } })).arrayBuffer());
  return entry.off + 30 + u16(lh, 26) + u16(lh, 28);
}

/** Inclusive byte range [a, b] of a remote file. */
export async function readRange(url, a, b, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { ...UA, range: `bytes=${a}-${b}` } });
  if (!r.ok) throw new Error(`range read failed: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
