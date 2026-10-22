/* clipBridge — the canvas clipboard's presence on the SYSTEM clipboard (NEW-1, B2382272).
 *
 * WHY. The drawn-object clipboard (planClipboardStore) was in-memory only. A `paste` event that
 * carried an OS clipboard image (an old screenshot) therefore won over it (pasteImage.js's rule),
 * so Ctrl+C on a cloud followed by Ctrl+V pasted the stale screenshot. Copying now ALSO writes a
 * Planyr-marked JSON payload to the system clipboard, replacing whatever image was there: the most
 * recent copy always wins, and a copy made elsewhere afterwards naturally replaces the elements.
 * The same payload is what lets a paste cross tabs / projects.
 *
 * Pure: no React. `nav` / text are injected so the rules are unit-testable on plain objects.
 */

export const CLIP_MARK = "planyr-canvas-clip";
export const CLIP_VERSION = 1;

/** The text written to the system clipboard for a payload from `collectClipboard` + provenance. */
export function serializeClip(payload) {
  if (!payload || !payload.items || !payload.items.length) return null;
  return JSON.stringify({ mark: CLIP_MARK, v: CLIP_VERSION, payload });
}

/** The payload inside clipboard text, or null when the text is not ours (or is malformed). */
export function parseClip(text) {
  if (typeof text !== "string" || text.indexOf(CLIP_MARK) < 0) return null;
  try {
    const o = JSON.parse(text);
    if (!o || o.mark !== CLIP_MARK || o.v !== CLIP_VERSION) return null;
    const p = o.payload;
    if (!p || !Array.isArray(p.items) || !p.items.length) return null;
    if (!p.items.every((it) => it && typeof it.kind === "string" && it.obj && typeof it.obj === "object")) return null;
    return p;
  } catch { return null; }
}

/* Did the LAST system-clipboard write fail? If so the in-app payload is the only copy of what the
 * user just copied, so on a paste it must beat a stale OS image (the failure is announced loudly
 * at copy time). Module scope, like the store it accompanies. */
let writeFailed = false;
export const systemWriteFailed = () => writeFailed;
export const resetBridge = () => { writeFailed = false; };

/**
 * Write the payload to the system clipboard. Resolves true on success. A refusal (permission,
 * unfocused document, no API) sets the failed flag, calls `onFail(reason)` — the caller shows it —
 * and resolves false. Never throws.
 */
export async function writeSystemClip(payload, nav = (typeof navigator !== "undefined" ? navigator : null), onFail) {
  const text = serializeClip(payload);
  if (!text) return false;
  try {
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== "function") throw new Error("clipboard unavailable");
    await nav.clipboard.writeText(text);
    writeFailed = false;
    return true;
  } catch (err) {
    writeFailed = true;
    if (onFail) onFail(String((err && err.message) || err || "refused"));
    return false;
  }
}
