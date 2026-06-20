/* Google Drive v3 REST client (B207 / NEW-2) — the concrete `client` the driveBackend
 * scaffold expects. All network goes through an injectable `fetchImpl` + an async
 * `getAccessToken()` (from oauth/googleAuth.makeTokenProvider), so the request shapes are
 * unit-tested without hitting Google.
 *
 * Least-privilege note (drive.file): the app can only see/touch files IT created. So the
 * folder tree is APP-CREATED — we never depend on a hand-made folder id. `folderId(path)`
 * ensures `Planyr/<segments…>` under My Drive, creating each level once and finding it
 * thereafter (a drive.file `list` only returns app-created items, which is exactly the set
 * we want). This is why the owner doesn't need to supply a Drive folder id.
 */
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export function createDriveClient({ getAccessToken, fetchImpl = fetch, appRootName = "Planyr" } = {}) {
  if (typeof getAccessToken !== "function") throw new Error("createDriveClient requires getAccessToken().");

  // Authorized request → parsed JSON. Throws on a non-2xx (the adapter's attempt() turns
  // that into a visible { ok:false }). `raw` returns the Response for media downloads.
  const api = async (method, url, { json, body, headers = {}, raw = false } = {}) => {
    const token = await getAccessToken();
    const h = { authorization: `Bearer ${token}`, ...headers };
    let payload = body;
    if (json !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(json); }
    const res = await fetchImpl(url, { method, headers: h, body: payload });
    if (!res.ok) {
      let msg = `Drive ${method} ${res.status}`;
      try { const e = await res.json(); msg = (e.error && (e.error.message || e.error)) || msg; } catch (_) { /* keep */ }
      throw new Error(msg);
    }
    return raw ? res : res.json();
  };

  const q = (s) => encodeURIComponent(s);

  // Find a folder by name under a parent (app-created only, under drive.file), or null.
  const findFolder = async (name, parentId) => {
    const query = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`;
    const r = await api("GET", `${DRIVE}/files?q=${q(query)}&fields=files(id,name)&pageSize=1`);
    return (r.files && r.files[0] && r.files[0].id) || null;
  };
  const createFolder = async (name, parentId) => {
    const r = await api("POST", `${DRIVE}/files?fields=id`, { json: { name, mimeType: FOLDER_MIME, parents: [parentId] } });
    return r.id;
  };
  const ensureFolder = async (name, parentId) => (await findFolder(name, parentId)) || createFolder(name, parentId);

  return {
    // Ensure Planyr/<path…> exists (app-created), returns the deepest folder id.
    async folderId(folderPath) {
      let parent = await ensureFolder(appRootName, "root");
      for (const seg of String(folderPath || "").split("/").map((s) => s.trim()).filter(Boolean))
        parent = await ensureFolder(seg, parent);
      return parent;
    },

    // Multipart create (metadata + bytes in one call). `bytes` may be a Uint8Array,
    // ArrayBuffer, or Blob — Blob assembles all of them.
    async create({ bytes, contentType = "application/octet-stream", name, parentFolderId }) {
      const boundary = "planyr_" + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: name || "document", ...(parentFolderId ? { parents: [parentFolderId] } : {}) });
      const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
      const post = `\r\n--${boundary}--`;
      const blob = new Blob([pre, bytes, post], { type: `multipart/related; boundary=${boundary}` });
      const r = await api("POST", `${UPLOAD}/files?uploadType=multipart&fields=id`, {
        body: blob, headers: { "content-type": `multipart/related; boundary=${boundary}` },
      });
      return { id: r.id };
    },

    async media(fileId) {
      const meta = await api("GET", `${DRIVE}/files/${fileId}?fields=name,mimeType`);
      const res = await api("GET", `${DRIVE}/files/${fileId}?alt=media`, { raw: true });
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { bytes, contentType: meta.mimeType, name: meta.name };
    },

    async list({ parentFolderId }) {
      const query = `'${parentFolderId}' in parents and trashed=false`;
      const r = await api("GET", `${DRIVE}/files?q=${q(query)}&fields=files(id,name,size,mimeType,parents)&pageSize=1000`);
      return r.files || [];
    },

    async update(fileId, { addParents, removeParents, name } = {}) {
      const params = new URLSearchParams({ fields: "id" });
      if (addParents) params.set("addParents", addParents);
      if (removeParents) params.set("removeParents", removeParents);
      const r = await api("PATCH", `${DRIVE}/files/${fileId}?${params}`, { json: name ? { name } : {} });
      return { id: r.id };
    },

    async del(fileId) {
      await api("DELETE", `${DRIVE}/files/${fileId}`, { raw: true });
    },

    async permitAnyoneReader(fileId) {
      await api("POST", `${DRIVE}/files/${fileId}/permissions`, { json: { role: "reader", type: "anyone" } });
      const r = await api("GET", `${DRIVE}/files/${fileId}?fields=webViewLink`);
      return { webViewLink: r.webViewLink };
    },
  };
}
