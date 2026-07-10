/* Client for the B238 DWG→DXF conversion service (B748). Round-trips a dropped .dwg through
 * the server-side `server/convert/` service (LibreDWG primary, APS dormant — built + container-
 * verified in B238, not yet deployed) and hands the DXF bytes to the B747 DXF pipeline.
 *
 * The service URL is a PUBLIC endpoint (`VITE_CONVERT_URL`), NOT a secret — the service-role /
 * APS credentials stay server-side per the two-backend rule. Every failure path returns a
 * VISIBLE, actionable message (LOUD-FAILURE): an unset URL, an unreadable drawing (422), an
 * oversize file (413), and an unreachable service are each distinct states — never a spinner
 * into nothing, never a silent no-op. */

export const CONVERT_URL = ((import.meta.env && import.meta.env.VITE_CONVERT_URL) || "").trim();

// DWG sniff — extension is the reliable signal (MIME is unset/inconsistent for CAD drops).
export const isDwgFile = (file) =>
  !!file && (/\.dwg$/i.test(file.name || "") || file.type === "image/vnd.dwg" || file.type === "application/acad" || file.type === "image/x-dwg");

// True when a convert endpoint is configured — the caller shows the "not set up yet" note otherwise.
export const convertConfigured = (url = CONVERT_URL) => !!url;

const DXF_SUGGEST = "export a DXF from AutoCAD/Civil 3D instead.";

/* POST the DWG bytes to `${url}/convert`; on success resolve { ok:true, bytes:ArrayBuffer }.
 * On any failure resolve { ok:false, code, error } with a human message — never throws, never
 * a silent success. `fetchImpl` is injectable so the states are unit-tested without a network. */
export async function convertDwgToDxf(file, { fetchImpl, url = CONVERT_URL } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!url) return { ok: false, code: "unset", error: `DWG conversion isn't set up yet — ${DXF_SUGGEST}` };
  if (!doFetch) return { ok: false, code: "unsupported", error: `DWG conversion isn't available in this browser — ${DXF_SUGGEST}` };

  const endpoint = url.replace(/\/+$/, "") + "/convert";
  let res;
  try {
    res = await doFetch(endpoint, { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } });
  } catch (_) {
    return { ok: false, code: "network", error: `The DWG conversion service is unreachable — try again, or ${DXF_SUGGEST}` };
  }

  if (res.status === 413)
    return { ok: false, code: "toobig", error: `That DWG is too large for the conversion service — ${DXF_SUGGEST}` };
  if (!res.ok) {
    let msg = "";
    try { const j = await res.json(); msg = (j && j.error) || ""; } catch (_) { /* non-JSON error body */ }
    const lead = msg ? `${msg} ` : (res.status === 422 ? "That drawing couldn't be read. " : "That drawing couldn't be converted. ");
    return { ok: false, code: res.status === 422 ? "unreadable" : "error", error: `${lead}— ${DXF_SUGGEST}` };
  }

  let bytes;
  try { bytes = await res.arrayBuffer(); } catch (_) {
    return { ok: false, code: "error", error: `The converted DXF couldn't be read — try again, or ${DXF_SUGGEST}` };
  }
  if (!bytes || !bytes.byteLength)
    return { ok: false, code: "empty", error: `The conversion returned an empty DXF — ${DXF_SUGGEST}` };
  return { ok: true, bytes };
}
