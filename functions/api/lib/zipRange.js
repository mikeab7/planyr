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

/** Stream an entry as blocks of COMPLETE lines: `onBlock(text) → true to stop` (text = whole lines, each ending
 * "\n"). Handing the caller a block rather than a line at a time is the point — a 570 MB roll is ~1.8M lines and
 * any per-line JavaScript blows the Worker's CPU budget (Cloudflare error 1102, measured); native indexOf over a
 * block does not. Returns { bytes, stopped }. */
export async function scanZipEntryBlocks(url, entry, onBlock, fetchImpl = fetch) {
  const lh = new Uint8Array(await (await fetchImpl(url, { headers: { ...UA, range: `bytes=${entry.off}-${entry.off + 63}` } })).arrayBuffer());
  const start = entry.off + 30 + u16(lh, 26) + u16(lh, 28);
  const res = await fetchImpl(url, { headers: { ...UA, range: `bytes=${start}-${start + entry.csize - 1}` } });
  if (!res.ok || !res.body) throw new Error(`zip entry read failed: HTTP ${res.status}`);
  const body = entry.method === 0 ? res.body : res.body.pipeThrough(new DecompressionStream("deflate-raw"));
  const rd = body.getReader();
  const dec = new TextDecoder();
  let pending = "", bytes = 0, stopped = false;
  for (;;) {
    const { value, done } = await rd.read();
    if (value) { bytes += value.length; pending += dec.decode(value, { stream: !done }); }
    let block;
    if (done) { block = pending && !pending.endsWith("\n") ? pending + "\n" : pending; pending = ""; }
    else {
      const L = pending.lastIndexOf("\n");
      if (L < 0) continue;
      block = pending.slice(0, L + 1);
      pending = pending.slice(L + 1);
    }
    if (block && onBlock(block)) { stopped = true; break; }
    if (done) break;
  }
  await rd.cancel().catch(() => {});
  return { bytes, stopped };
}
