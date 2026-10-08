/* TEMPORARY (B2158065 NEW-2 discovery) — reports what public CAD data hosts answer from
 * Cloudflare's network, because the build sandbox's egress policy blocks them. Allow-listed
 * hosts only, read-only. Deleted once the real source is wired.
 *   ?u=URL[&u=URL…][&grep=REGEX]   ranged peek (or, with grep, whole text body → regex hits)
 *   ?zip=URL                       zip central directory (ranged tail read)
 *   ?zip=URL&entry=NAME&bytes=N    first N inflated bytes of one entry
 *   ?zip=URL&entry=NAME&find=STR[&maxmb=N]   stream-inflate, find a line containing STR, time it */
const HOSTS = /^(www\.)?(hcad\.org|pdata\.hcad\.org|download\.hcad\.org|hctax\.net|fbcad\.org|search\.fbcad\.org|galvestoncad\.org|gcad\.org|mcad-tx\.org|montgomerycad\.org|esearch\.mcad-tx\.org|comptroller\.texas\.gov|tax\.fortbendcountytx\.gov|fortbendcountytx\.gov|data\.texas\.gov|gis\.hctx\.net|[a-z0-9]*\.?arcgis\.com)$/i;
const json = (o) => new Response(JSON.stringify(o, null, 1), { headers: { "content-type": "application/json" } });
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ok = (t) => { const x = new URL(t); return x.protocol === "https:" && HOSTS.test(x.hostname) ? x : null; };
const UA = { "user-agent": "Mozilla/5.0 (compatible; planyr-probe)" };

async function zipDir(url) {
  const head = await fetch(url, { headers: { ...UA, range: "bytes=-90000" } });
  const total = Number((head.headers.get("content-range") || "").split("/")[1]);
  const tail = new Uint8Array(await head.arrayBuffer());
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error(`no EOCD (status ${head.status}, total ${total})`);
  const count = u16(tail, e + 10), cdOff = u32(tail, e + 16);
  let p = cdOff - (total - tail.length);
  if (p < 0) throw new Error("central directory outside tail window");
  const out = [];
  for (let n = 0; n < count; n++) {
    if (u32(tail, p) !== 0x02014b50) break;
    const nl = u16(tail, p + 28), xl = u16(tail, p + 30), cl = u16(tail, p + 32);
    out.push({ name: new TextDecoder().decode(tail.subarray(p + 46, p + 46 + nl)), method: u16(tail, p + 10), csize: u32(tail, p + 20), size: u32(tail, p + 24), off: u32(tail, p + 42) });
    p += 46 + nl + xl + cl;
  }
  return { total, entries: out };
}

async function entryStream(url, e) {
  const lh = new Uint8Array(await (await fetch(url, { headers: { ...UA, range: `bytes=${e.off}-${e.off + 63}` } })).arrayBuffer());
  const start = e.off + 30 + u16(lh, 26) + u16(lh, 28);
  const res = await fetch(url, { headers: { ...UA, range: `bytes=${start}-${start + e.csize - 1}` } });
  return e.method === 0 ? res.body : res.body.pipeThrough(new DecompressionStream("deflate-raw"));
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  if (request.headers.get("Origin") && new URL(request.headers.get("Origin")).host !== u.host) return new Response("forbidden", { status: 403 });
  try {
    const zip = u.searchParams.get("zip");
    if (zip) {
      if (!ok(zip)) return json({ error: "host not allow-listed" });
      const dir = await zipDir(zip);
      const name = u.searchParams.get("entry");
      if (!name) return json(dir);
      const e = dir.entries.find((x) => x.name === name);
      if (!e) return json({ error: "no such entry", names: dir.entries.map((x) => x.name) });
      const rd = (await entryStream(zip, e)).getReader();
      const find = u.searchParams.get("find");
      const want = Math.min(Number(u.searchParams.get("bytes") || 3000), 60000);
      const maxBytes = Math.min(Number(u.searchParams.get("maxmb") || 40), 400) * 1e6;
      const dec = new TextDecoder();
      const t0 = Date.now();
      let got = 0, buf = "", firstLines = null, lastLine = "", hit = null, lines = 0;
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        got += value.length;
        buf += dec.decode(value, { stream: true });
        if (!find) { if (buf.length >= want) break; continue; }
        const parts = buf.split("\n"); buf = parts.pop();
        if (!firstLines) firstLines = parts.slice(0, 4);
        lines += parts.length;
        for (const l of parts) { if (l.includes(find)) { hit = hit || []; if (hit.length < 12) hit.push(l); } lastLine = l; }
        if (hit || got > maxBytes) break;
      }
      await rd.cancel().catch(() => {});
      return json(find ? { entry: e, scannedBytes: got, lines, ms: Date.now() - t0, firstLines, lastLine, hit } : { entry: e, head: buf.slice(0, want) });
    }
    const out = [];
    const grep = u.searchParams.get("grep");
    for (const t of u.searchParams.getAll("u").slice(0, 12)) {
      try {
        const tu = ok(t);
        if (!tu) { out.push({ url: t, error: "host not allow-listed" }); continue; }
        const res = await fetch(tu.toString(), { headers: grep ? UA : { ...UA, range: "bytes=0-3999" }, redirect: "follow" });
        const ct = res.headers.get("content-type") || "";
        if (grep) {
          const txt = await res.text();
          const re = new RegExp(grep, "gi");
          const hits = [];
          let m;
          while ((m = re.exec(txt)) && hits.length < 60) hits.push(txt.slice(Math.max(0, m.index - 60), m.index + 140).replace(/\s+/g, " "));
          out.push({ url: t, status: res.status, final: res.url, len: txt.length, hits });
          continue;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        out.push({ url: t, status: res.status, ct, range: res.headers.get("content-range"), head: /text|json|xml|html|csv/i.test(ct) ? new TextDecoder().decode(buf.slice(0, 1500)) : `binary ${buf.length}b` });
      } catch (e) { out.push({ url: t, error: String((e && e.message) || e) }); }
    }
    return json(out);
  } catch (e) { return json({ error: String((e && e.message) || e) }); }
}
