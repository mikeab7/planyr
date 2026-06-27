/* Pure builders for planar_suggestions rows (the suggest-and-approve contract).
 *
 * These produce the EXACT row shape the Scheduler's Review panel already knows how to render
 * and apply (SuggestionsView, public/sequence/index.html:2244+). Every suggestion lands as
 * status:'pending' — Claude never edits the live schedule; it only proposes, and you Approve
 * or Dismiss with one click. The field allow-list mirrors SGQ_ALLOWED_PATCH
 * (index.html:2025) so a proposal can NEVER carry a field the Review panel would reject.
 *
 * Pure + synchronous; returns { ok, row } / { ok:false, error }; never throws.
 */
import { ok, fail } from "../storage/result.js";

// The only fields a modify_task patch may carry (mirrors SGQ_ALLOWED_PATCH in the Scheduler).
export const MODIFY_PATCH_FIELDS = ["health", "duration", "end", "percentComplete", "responsibleParty", "predecessors"];
// A new task may set these (name is required; the rest optional). end is derived by the Scheduler.
export const CREATE_PATCH_FIELDS = ["name", "start", "duration", "health", "responsibleParty"];
export const HEALTH_VALUES = ["green", "yellow", "red", "gray"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numLike = (v) => (isNum(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : null));
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
const str = (v) => (typeof v === "string" ? v.trim() : "");

// Validate one allowed field; returns { ok, value } or { ok:false, error }. Unknown fields
// are the caller's responsibility to exclude — here we only police the values of known ones.
function coerceField(key, val) {
  switch (key) {
    case "health": {
      const h = str(val).toLowerCase();
      return HEALTH_VALUES.includes(h) ? ok({ value: h }) : fail(`health must be one of ${HEALTH_VALUES.join("/")}.`);
    }
    case "duration": {
      const n = numLike(val);
      return n != null && n >= 0 ? ok({ value: n }) : fail("duration must be a number of working days (>= 0).");
    }
    case "percentComplete": {
      const n = numLike(val);
      return n != null && n >= 0 && n <= 100 ? ok({ value: n }) : fail("percentComplete must be 0–100.");
    }
    case "end":
    case "start":
      return isDate(val) ? ok({ value: str(val) }) : fail(`${key} must be a date in YYYY-MM-DD form.`);
    case "responsibleParty": {
      const s = str(val);
      return s ? ok({ value: s }) : fail("responsibleParty must be a non-empty name.");
    }
    case "name": {
      const s = str(val);
      return s ? ok({ value: s }) : fail("name must be a non-empty task name.");
    }
    default:
      return fail(`Unsupported field "${key}".`);
  }
}

function meta({ note, emailSubject, emailDate }) {
  const m = {};
  const n = str(note); if (n) m.note_text = n;
  const s = str(emailSubject); if (s) m.email_subject = s;
  if (isDate(emailDate)) m.email_date = str(emailDate);
  return m;
}

/* Build a modify_task suggestion. `changes` is a flat object of allowed fields (health,
 * duration, end, percentComplete, responsibleParty) plus optional add_predecessors (task ids
 * to add as Finish-Start dependencies — the Review panel resolves them by id or name). */
export function buildModifyTaskRow({ projectId, taskId, changes = {}, addPredecessors = [], note, emailSubject, emailDate } = {}) {
  const pid = numLike(projectId);
  if (pid == null) return fail("project_id is required (a number from get_schedule).");
  if (taskId == null || (typeof taskId === "string" && !taskId.trim())) return fail("task_id is required (from get_schedule).");

  const patch = {};
  for (const key of Object.keys(changes || {})) {
    if (!MODIFY_PATCH_FIELDS.includes(key)) return fail(`"${key}" can't be changed. Allowed: ${MODIFY_PATCH_FIELDS.join(", ")}.`);
    if (key === "predecessors") { patch.predecessors = changes.predecessors; continue; } // raw passthrough; Scheduler validates
    const c = coerceField(key, changes[key]);
    if (!c.ok) return c;
    patch[key] = c.value;
  }

  const preds = Array.isArray(addPredecessors) ? addPredecessors.filter((v) => v != null && String(v).trim() !== "") : [];
  if (preds.length) patch.add_predecessors = preds;

  if (!Object.keys(patch).length) return fail("No changes to propose — supply at least one field (e.g. duration, end, health) or add_predecessors.");

  const taskKey = numLike(taskId) != null ? numLike(taskId) : str(taskId);
  return ok({ row: { status: "pending", kind: "modify_task", project_id: pid, task_path: [taskKey], patch, ...meta({ note, emailSubject, emailDate }) } });
}

/* Build a create_task suggestion. `parentTaskId` (optional) points task_path at the parent
 * the new task should nest under; name is required, the rest optional. */
export function buildNewTaskRow({ projectId, parentTaskId, fields = {}, note, emailSubject, emailDate } = {}) {
  const pid = numLike(projectId);
  if (pid == null) return fail("project_id is required (a number from get_schedule).");

  const patch = {};
  for (const key of Object.keys(fields || {})) {
    if (!CREATE_PATCH_FIELDS.includes(key)) return fail(`"${key}" isn't a settable field on a new task. Allowed: ${CREATE_PATCH_FIELDS.join(", ")}.`);
    const c = coerceField(key, fields[key]);
    if (!c.ok) return c;
    patch[key] = c.value;
  }
  if (!patch.name) return fail("A new task needs a name.");

  const task_path = (parentTaskId != null && String(parentTaskId).trim() !== "")
    ? [numLike(parentTaskId) != null ? numLike(parentTaskId) : str(parentTaskId)]
    : [];
  return ok({ row: { status: "pending", kind: "create_task", project_id: pid, task_path, patch, ...meta({ note, emailSubject, emailDate }) } });
}
