/* Which render crashes are RECOVERABLE — pure, so it can be unit-tested without a browser (B1189).
 *
 * React throws "Maximum update depth exceeded" as a CIRCUIT BREAKER, not as a diagnosis of
 * corrupt state: it has counted ~50 nested updates, decided the tree is in a feedback cycle, and
 * aborted the render to stop it. Nothing is damaged — the loop is already broken by the time the
 * error reaches a boundary, and the plan itself lives in storage, not in the aborted render.
 *
 * That matters because the failure this class produces is wildly disproportionate: B1189's
 * runaway layout-measurement loop replaced the ENTIRE planner — canvas, rails, the user's drawing
 * — with a terminal error card, over a transient measurement cycle. Remounting the subtree clears
 * it outright. So the boundary treats this class as "retry once or twice", and only falls through
 * to the visible card if it keeps recurring.
 *
 * Deliberately NARROW. Only errors that are self-limiting AND fixed by a remount belong here; a
 * TypeError from a dangling reference recurs identically on remount, so auto-retrying it would
 * spin. When in doubt an error is NOT recoverable — the card is the safe answer.
 *
 * Minified builds are the ones users actually run, and there the message is only an error CODE
 * (React strips invariant text in production), so both spellings have to match or this is dead
 * code in production — which is precisely where B1189 fired.
 */

/** React's "Maximum update depth exceeded" invariant, dev spelling and minified code #185. */
export const UPDATE_DEPTH_CODE = 185;

/** Is this the nested-update circuit breaker? */
export function isUpdateDepthError(error) {
  const msg = (error && (error.message || error.toString())) || "";
  if (typeof msg !== "string" || !msg) return false;
  if (/Maximum update depth exceeded/i.test(msg)) return true;
  // Production: "Minified React error #185; visit https://reactjs.org/docs/error-decoder…".
  return new RegExp(`Minified React error #${UPDATE_DEPTH_CODE}(?!\\d)`, "i").test(msg);
}

/** Errors the boundary may clear by remounting the subtree instead of showing a dead end. */
export function isRecoverableRenderError(error) {
  return isUpdateDepthError(error);
}

/** How many automatic remounts a boundary may spend before it gives up and shows the card. */
export const MAX_AUTO_RECOVERIES = 2;

/** A recovery this long after the previous one is a fresh incident, not the same loop retrying. */
export const RECOVERY_WINDOW_MS = 30_000;

/* Decide what a boundary should do with a caught error.
 *
 * Pure so the policy is testable on its own: given the error, how many automatic recoveries this
 * boundary has already spent, when the last one was, and the current time, either "recover" (with
 * the attempt counter to carry forward) or "show" the fallback card.
 */
export function planRecovery({ error, attempts = 0, lastRecoveryAt = 0, now = 0 }) {
  if (!isRecoverableRenderError(error)) return { action: "show", attempts };
  // A crash long after the last one is a new incident — spend a fresh budget on it rather than
  // holding an hours-old count against it.
  const spent = lastRecoveryAt && now - lastRecoveryAt <= RECOVERY_WINDOW_MS ? attempts : 0;
  if (spent >= MAX_AUTO_RECOVERIES) return { action: "show", attempts: spent };
  return { action: "recover", attempts: spent + 1 };
}

/* ── WHICH SUBTREE ACTUALLY THREW (NEW-2) ─────────────────────────────────────────────────────
 *
 * ⛔ THE DEFECT THIS CLOSES, because it is easy to read as cosmetic and is not. The boundary
 * reports `module` from its OWN props — the ACTIVE ROUTE. On 2026-09-19 at 13:31:08 the owner's
 * crash threw inside `AppHeader`, and the row in `public.client_errors` says `site-planner`,
 * because the header is mounted inside the planner's subtree. The card he saw said "Site Planyr hit
 * an error and couldn't load". Both are wrong about WHERE, and a query scoped to the module would
 * have gone looking in the planner forever. (Same family as the 2026-09-05 sweep that found 182
 * React rows carrying a display name no module-scoped query could match — see
 * `client_errors_module_slug.sql`. The route is still worth recording; it is just not the answer to
 * "what threw".)
 *
 * The component stack is the one artefact that knows, and in production it is minified — but the
 * CHUNK FILENAME beside each frame is not. Vite emits `<Name>-<hash>.js` from the real module name,
 * so `$n@https://planyr.io/assets/AppHeader-BYdR8Qaf.js:2:9008` names the subtree outright. That is
 * a far more robust signal than the minified component name, which changes with every build.
 */

/** A chunk filename Vite emits: `<name>-<8-or-more-char hash>.js`, optionally URL-qualified. */
const CHUNK_RE = /(?:^|[/\\])([A-Za-z][A-Za-z0-9_]*)-[A-Za-z0-9_-]{6,24}\.js\b/;
/** A dev-mode React frame: "    in ProjectBreadcrumb (at AppHeader.jsx:1143)". */
const DEV_FRAME_RE = /^\s*(?:in|at)\s+([A-Za-z][A-Za-z0-9_$]*)/;

/* Name the subtree a caught error threw from, plus a short head of the stack to put on the record.
 *
 * Returns `{ crashedIn, component, head }`:
 *   • `crashedIn` — the chunk the innermost NAMED frame lives in ("AppHeader", "SitePlannerApp"),
 *     or null when the stack carries no chunk (dev builds, or a stack React did not supply);
 *   • `component` — the innermost frame's own display name, minified in production and therefore
 *     only useful ALONGSIDE the chunk, never instead of it;
 *   • `head`      — the first few frames, trimmed, so a row carries enough to place the crash
 *     without carrying a whole stack into a message column.
 *
 * Deliberately total: every branch returns the same shape, because a boundary that throws while
 * describing a crash is strictly worse than one that reports a little less.
 */
export function crashSubtree(componentStack, { frames = 4, maxHead = 220 } = {}) {
  const out = { crashedIn: null, component: null, head: null };
  if (typeof componentStack !== "string" || !componentStack.trim()) return out;
  const lines = componentStack.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return out;
  for (const line of lines) {
    const chunk = CHUNK_RE.exec(line);
    if (chunk && !out.crashedIn) {
      out.crashedIn = chunk[1];
      // "name@url:line:col" in production; a bare tag ("div") carries no name at all.
      const at = line.indexOf("@");
      if (at > 0) out.component = line.slice(0, at);
      break;
    }
    if (!out.component) {
      const dev = DEV_FRAME_RE.exec(line);
      // Skip the plain host tags React interleaves ("div", "main", "header") — they place nothing.
      if (dev && !/^(div|span|main|header|footer|section|nav|ul|li|p|a|svg|g)$/.test(dev[1])) out.component = dev[1];
    }
  }
  out.head = lines.slice(0, frames).join(" / ").slice(0, maxHead);
  return out;
}
