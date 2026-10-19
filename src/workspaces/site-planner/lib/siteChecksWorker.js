/* The Site Analysis polygon-query WORKER (problem report 6cea9895). FEMA answers the owner's Georgia parcel with a
 * 16 MB /query body (one 702,524-vertex polygon); parsing it and cutting it to the site's window on the main thread
 * still held the page for ~1.2 s + ~0.5 s after the measurement itself was fixed. Here the network round trip, the JSON
 * parse and the cut (featureWindow.windowArcgisAnswer) happen off the main thread, and only the small windowed answer
 * is posted back. Protocol — in: { id, url, init: { method, headers, body }, siteRings, padM } | { type:"abort", id };
 * out: { id, ok, status, json } | { id, error: { name, message } }. The main-thread half is siteChecksTransport.js. */
import { windowArcgisAnswer } from "./featureWindow.js";

const ctrls = new Map();
self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === "abort") { const c = ctrls.get(d.id); if (c) c.abort(); return; }
  const ctrl = new AbortController();
  ctrls.set(d.id, ctrl);
  try {
    const res = await fetch(d.url, { ...(d.init || {}), signal: ctrl.signal });
    if (!res.ok) { self.postMessage({ id: d.id, ok: false, status: res.status }); return; }
    const j = await res.json();
    self.postMessage({ id: d.id, ok: true, status: res.status, json: windowArcgisAnswer(j, d.siteRings, d.padM) });
  } catch (err) {
    self.postMessage({ id: d.id, error: { name: (err && err.name) || "Error", message: String((err && err.message) || err) } });
  } finally {
    ctrls.delete(d.id);
  }
};
