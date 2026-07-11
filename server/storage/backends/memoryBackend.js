/* In-memory storage backend (B206 / NEW-1) — the stub the adapter is proven against.
 *
 * Implements the backend contract the adapter expects (put / get / list / move / rename /
 * remove / shareLink), keyed by its OWN backend ids. It exists so the adapter can be
 * pointed at a null/stub backend with zero changes anywhere outside the adapter — the
 * NEW-1 acceptance test. Also handy for unit tests and offline dev.
 *
 * Backend contract (every real backend — Drive included — implements this shape):
 *   put({bytes, contentType, name, folder, planyrKey}) -> { ok, backendId }
 *   get(backendId)        -> { ok, bytes, contentType, name }
 *   list({folder?})       -> { ok, items: [{ backendId, name, size, contentType, folder }] }
 *   move(backendId, toFolder) -> { ok }
 *   rename(backendId, newName) -> { ok }
 *   remove(backendId)     -> { ok }
 *   shareLink(backendId, opts) -> { ok, url }
 */
import { ok, fail } from "../result.js";

export function memoryBackend() {
  const files = new Map(); // backendId -> { bytes, contentType, name, folder }
  let seq = 0;
  const newId = () => `mem_${Date.now().toString(36)}_${seq++}`;
  const sizeOf = (b) => (b && b.byteLength != null ? b.byteLength : (b && b.length) || 0);

  return {
    name: "memory",
    async put({ bytes, contentType, name, folder }) {
      const backendId = newId();
      files.set(backendId, { bytes, contentType: contentType || "application/octet-stream", name: name || backendId, folder: folder || null });
      return ok({ backendId });
    },
    async get(backendId) {
      const f = files.get(backendId);
      if (!f) return fail("File not found.");
      return ok({ bytes: f.bytes, contentType: f.contentType, name: f.name });
    },
    // Streamed read with HTTP-Range emulation — mirrors driveBackend.getStream so the
    // adapter's streaming path is testable without Drive. `body` is plain bytes here
    // (a Response accepts either bytes or a stream).
    async getStream(backendId, { range } = {}) {
      const f = files.get(backendId);
      if (!f) return fail("File not found.");
      const all = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || []);
      const m = /^bytes=(\d+)-(\d*)$/.exec(String(range || ""));
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] !== "" ? Math.min(Number(m[2]), all.length - 1) : all.length - 1;
      if (m && start >= all.length) return fail("Range not satisfiable.");
      const part = m ? all.slice(start, end + 1) : all;
      return ok({
        status: m ? 206 : 200, body: part,
        contentType: f.contentType, name: f.name, size: all.length,
        contentLength: String(part.length),
        contentRange: m ? `bytes ${start}-${end}/${all.length}` : null,
      });
    },
    async list({ folder } = {}) {
      const items = [...files.entries()]
        .filter(([, f]) => folder == null || f.folder === folder)
        .map(([backendId, f]) => ({ backendId, name: f.name, size: sizeOf(f.bytes), contentType: f.contentType, folder: f.folder }));
      return ok({ items });
    },
    async move(backendId, toFolder) {
      const f = files.get(backendId);
      if (!f) return fail("File not found.");
      f.folder = toFolder || null;
      return ok();
    },
    async rename(backendId, newName) {
      const f = files.get(backendId);
      if (!f) return fail("File not found.");
      f.name = newName;
      return ok();
    },
    async remove(backendId) {
      if (!files.delete(backendId)) return fail("File not found.");
      return ok();
    },
    async shareLink(backendId) {
      if (!files.has(backendId)) return fail("File not found.");
      return ok({ url: `memory://share/${backendId}` });
    },
  };
}
