/*
 * workflowContract.mjs — the PURE half of the required-check contract guard (NEW-2).
 *
 * WHY THIS EXISTS. On 2026-08-06 every open pull request in this repository became unmergeable and
 * nothing anywhere said so. The required status check `build` sat at "Expected — Waiting for status
 * to be reported" on seven PRs at once; Actions was healthy, Cloudflare was green, the ruleset named
 * the right context, and there was no error to find. A required check that can never report is a
 * repo-wide outage that looks exactly like nothing being wrong — and, as the owner verified, GitHub
 * offers NO merge control in that state, not even to an administrator. There is no way out from the
 * GitHub side; the repo has to not get into it.
 *
 * So this asserts, in the ordinary required build, the two properties that would have caught it:
 *
 *   1. NAME AGREEMENT — every context the ruleset requires is actually PRODUCED by a job in a
 *      workflow that runs on `pull_request` into main. A required context nobody produces can never
 *      report, and renaming a job is a one-word edit that silently arms exactly that trap.
 *
 *   2. DOCS-ONLY REACHABILITY — every required context must still report when a pull request
 *      changes ONLY documentation. This is the trap the owner's leading hypothesis named: a
 *      `paths`/`paths-ignore` filter on the trigger means a docs-only push produces NO run, and
 *      GitHub reports the required context as "Expected" forever. It was not the cause this time
 *      (build.yml has no paths filter), but it is one edit away from being the cause next time, and
 *      the renumber pushes that triggered the outage were docs-only by construction.
 *
 * The sanctioned way to have BOTH a paths filter and a reportable required context is well
 * established and is what `reachabilityVerdict` tells you to do: keep the filter on the expensive
 * job, and add a companion job with the SAME check name that runs when the filter excludes
 * everything and reports success immediately. Then the context is always reported, whether the real
 * work was needed or not.
 *
 * PARSING, AND WHY IT REFUSES RATHER THAN GUESSES. There is no YAML parser in this repo's
 * dependency tree and adding one to the client bundle's lockfile for a CI guard is a poor trade, so
 * this reads the small, highly-regular subset of workflow syntax it actually needs. Every construct
 * it does not understand is reported as `unparsed` and makes the guard REFUSE (LOUD-FAILURE) — a
 * contract checker that silently skips the file it cannot read is worse than no checker, because it
 * reads as a pass.
 */

/** Indentation of a line, or null for a blank/comment line. */
function indentOf(line) {
  if (!line.trim() || line.trim().startsWith("#")) return null;
  return line.length - line.trimStart().length;
}

/** `key: value` at a known indent → [key, value] (value may be ""), else null. */
function keyAt(line, indent) {
  if (indentOf(line) !== indent) return null;
  const m = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
  if (!m) return null;
  return [m[2], m[3].trim()];
}

/** A `- item` list entry at a known indent → the item, else null. */
function itemAt(line, indent) {
  if (indentOf(line) !== indent) return null;
  const m = /^\s*-\s+(.*)$/.exec(line);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** `[a, b, c]` → ["a","b","c"]; anything else → null. */
function inlineList(v) {
  if (!/^\[.*\]$/.test(v)) return null;
  return v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

const unquote = (v) => (v == null ? v : v.replace(/^["']|["']$/g, ""));

/**
 * Read the block of lines belonging to `startIdx`'s key — every subsequent line indented deeper
 * than `indent`, stopping at the first line that is not.
 */
function blockAfter(lines, startIdx, indent) {
  const out = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const ind = indentOf(lines[i]);
    if (ind === null) { out.push(lines[i]); continue; }
    if (ind <= indent) break;
    out.push(lines[i]);
  }
  return out;
}

/** Collect a list under `key:` — either inline (`[a, b]`) or as `- a` entries beneath it. */
function listUnder(lines, key, indent) {
  for (let i = 0; i < lines.length; i++) {
    const kv = keyAt(lines[i], indent);
    if (!kv || kv[0] !== key) continue;
    const inline = inlineList(kv[1]);
    if (inline) return inline;
    if (kv[1]) return [kv[1].replace(/^["']|["']$/g, "")];
    const body = blockAfter(lines, i, indent);
    const items = [];
    for (const l of body) {
      const it = itemAt(l, indent + 2);
      if (it != null) items.push(it);
    }
    return items;
  }
  return null;
}

/**
 * Parse the subset of a workflow file this guard needs.
 * Returns `{ ok, name, on, jobs, unparsed }`. `ok:false` means REFUSE — never assume.
 */
export function parseWorkflow(text, file = "(workflow)") {
  const lines = String(text ?? "").split("\n");
  const unparsed = [];
  const out = { name: null, on: {}, jobs: {}, file };

  for (let i = 0; i < lines.length; i++) {
    const kv = keyAt(lines[i], 0);
    if (!kv) continue;
    const [key, val] = kv;

    if (key === "name" && !out.name) { out.name = val.replace(/^["']|["']$/g, ""); continue; }

    if (key === "on" || key === '"on"') {
      // Three legal shapes: `on: push`, `on: [push, pull_request]`, or a nested mapping.
      const inline = inlineList(val);
      if (inline) { for (const e of inline) out.on[e] = {}; continue; }
      if (val) { out.on[val.replace(/^["']|["']$/g, "")] = {}; continue; }
      const body = blockAfter(lines, i, 0);
      for (let j = 0; j < body.length; j++) {
        const ev = keyAt(body[j], 2);
        if (!ev) continue;
        const evBody = blockAfter(body, j, 2);
        out.on[ev[0]] = {
          branches: listUnder(evBody, "branches", 4),
          paths: listUnder(evBody, "paths", 4),
          pathsIgnore: listUnder(evBody, "paths-ignore", 4),
          branchesIgnore: listUnder(evBody, "branches-ignore", 4),
        };
      }
      continue;
    }

    if (key === "jobs") {
      const body = blockAfter(lines, i, 0);
      for (let j = 0; j < body.length; j++) {
        const job = keyAt(body[j], 2);
        if (!job) continue;
        const jobBody = blockAfter(body, j, 2);
        let displayName = null;
        for (const l of jobBody) {
          const n = keyAt(l, 4);
          if (n && n[0] === "name") { displayName = n[1].replace(/^["']|["']$/g, ""); break; }
        }
        // GitHub names the check after the job's `name:` when present, otherwise the job id.
        out.jobs[job[0]] = { id: job[0], name: displayName, checkName: displayName || job[0] };
      }
      continue;
    }
  }

  if (!Object.keys(out.on).length) unparsed.push(`${file}: no \`on:\` trigger block could be read`);
  if (!Object.keys(out.jobs).length) unparsed.push(`${file}: no \`jobs:\` could be read`);

  return { ok: unparsed.length === 0, ...out, unparsed };
}

/** `key: value` pairs directly under `key:` at `indent`, as a plain object (quotes stripped). */
function mappingUnder(lines, key, indent) {
  for (let i = 0; i < lines.length; i++) {
    const kv = keyAt(lines[i], indent);
    if (!kv || kv[0] !== key) continue;
    const body = blockAfter(lines, i, indent);
    const out = {};
    for (const l of body) {
      const e = keyAt(l, indent + 2);
      if (e) out[e[0]] = unquote(e[1]);
    }
    return out;
  }
  return null;
}

/** Strip a YAML block scalar's own indentation (the first non-blank line's), keeping every line's
 *  indentation RELATIVE to that — this is what makes a multi-line shell script (`run: |`) come back
 *  runnable rather than re-indented. */
function dedentBlock(lines) {
  let base = null;
  for (const l of lines) {
    if (!l.trim()) continue;
    base = l.length - l.trimStart().length;
    break;
  }
  if (base == null) return "";
  // Trailing lines indented LESS than the script are the NEXT step's leading comments (blockAfter keeps comment lines), not part of
  // this script — slicing them at `base` used to leave fragments like "gnature-budget gate (NEW-1…" on the end of the run text, which
  // only escaped being executed because the one script it happened to (the preview-server wait) always `exit`s first.
  let end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || lines[end - 1].length - lines[end - 1].trimStart().length < base)) end--;
  lines = lines.slice(0, end);
  return lines.map((l) => (l.length >= base ? l.slice(base) : l.trimStart())).join("\n").replace(/\s+$/, "");
}

/**
 * Parse the ORDERED `steps:` list of one job (`name` / `uses` / `run` / `env` / `if` / `id`) — the
 * half `parseWorkflow` deliberately does not do (it only needs job existence + the `on:` triggers
 * for the required-check contract). Built for scripts/ci-parity.mjs, which has to run the SAME
 * commands `build.yml` runs rather than a hand-copied list that can drift from it.
 *
 * Same contract as `parseWorkflow`: REFUSES (`ok:false`) rather than guessing at a step shape it
 * does not recognize (LOUD-FAILURE) — a runner that silently skips a step it could not parse would
 * report a clean run for a shorter one.
 */
export function jobSteps(text, jobId) {
  const lines = String(text ?? "").split("\n");
  const unparsed = [];

  let jobsIdx = -1;
  for (let i = 0; i < lines.length; i++) { const kv = keyAt(lines[i], 0); if (kv && kv[0] === "jobs") { jobsIdx = i; break; } }
  if (jobsIdx < 0) return { ok: false, steps: [], unparsed: ["no `jobs:` block found"] };
  const jobsBlock = blockAfter(lines, jobsIdx, 0);

  let jobIdx = -1;
  for (let i = 0; i < jobsBlock.length; i++) { const kv = keyAt(jobsBlock[i], 2); if (kv && kv[0] === jobId) { jobIdx = i; break; } }
  if (jobIdx < 0) return { ok: false, steps: [], unparsed: [`no job "${jobId}" found under jobs:`] };
  const jobBlock = blockAfter(jobsBlock, jobIdx, 2);

  let stepsIdx = -1;
  for (let i = 0; i < jobBlock.length; i++) { const kv = keyAt(jobBlock[i], 4); if (kv && kv[0] === "steps") { stepsIdx = i; break; } }
  if (stepsIdx < 0) return { ok: false, steps: [], unparsed: [`job "${jobId}" has no steps:`] };
  const stepsBlock = blockAfter(jobBlock, stepsIdx, 4);

  // The indent every `- name: …` list item sits at. Found rather than assumed (2 vs 4 spaces are
  // both legal YAML), then every field beneath a step reads at itemIndent + 2.
  let itemIndent = null;
  for (const l of stepsBlock) {
    if (indentOf(l) !== null && /^\s*-\s+/.test(l)) { itemIndent = indentOf(l); break; }
  }
  if (itemIndent == null) return { ok: false, steps: [], unparsed: [`job "${jobId}": steps: has no "- " list items`] };
  const fieldIndent = itemIndent + 2;

  // Split into one chunk per step, each starting at an itemIndent-deep "- " line.
  const chunks = [];
  for (const l of stepsBlock) {
    if (indentOf(l) === itemIndent && /^\s*-\s+/.test(l)) {
      // Normalize "- key: v" -> two spaces + "key: v" so the rest of the step reads as one flat
      // mapping at fieldIndent, same as every other field beneath it.
      chunks.push([l.slice(0, itemIndent) + "  " + l.slice(itemIndent + 2)]);
    } else if (chunks.length) {
      chunks[chunks.length - 1].push(l);
    }
  }

  const steps = [];
  for (const chunk of chunks) {
    const step = { name: null, uses: null, run: null, if: null, id: null, env: null, with: null };
    for (let i = 0; i < chunk.length; i++) {
      const kv = keyAt(chunk[i], fieldIndent);
      if (!kv) continue;
      const [k, v] = kv;
      if (k === "name") step.name = unquote(v);
      else if (k === "uses") step.uses = unquote(v);
      else if (k === "if") step.if = unquote(v);
      else if (k === "id") step.id = unquote(v);
      else if (k === "env") step.env = mappingUnder(chunk, "env", fieldIndent) || {};
      else if (k === "with") step.with = mappingUnder(chunk, "with", fieldIndent) || {};
      else if (k === "run") {
        step.run = (v && !/^[|>][-+]?$/.test(v)) ? v : dedentBlock(blockAfter(chunk, i, fieldIndent));
      }
      // Anything else is deliberately unread — this exists to RUN the gates, not to model every
      // field GitHub Actions understands.
    }
    if (!step.name) { unparsed.push(`a step near "${chunk[0].trim().slice(0, 60)}" has no name:`); continue; }
    if (!step.uses && !step.run) { unparsed.push(`step "${step.name}" has neither uses: nor run: — an unrecognized step shape`); continue; }
    steps.push(step);
  }

  return { ok: unparsed.length === 0, steps, unparsed };
}

/** Every check name a workflow produces for a pull request into `branch`. */
export function pullRequestCheckNames(wf, branch = "main") {
  const pr = wf.on?.pull_request;
  if (!pr) return [];
  const branches = pr.branches;
  if (branches && branches.length && !branches.includes(branch) && !branches.includes("**")) return [];
  return Object.values(wf.jobs).map((j) => j.checkName);
}

/** Does a `paths` / `paths-ignore` pattern match a path? Supports the `**`, `*` and `?` GitHub uses. */
export function pathMatches(pattern, path) {
  const rx = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, " ")     // ** (optionally with a trailing slash) → any depth
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/ /g, ".*");
  return new RegExp(`^${rx}$`).test(path);
}

/**
 * Would a pull request touching exactly `files` produce a run for this trigger?
 * Mirrors GitHub's rule: with `paths`, at least one file must match; with `paths-ignore`, at least
 * one file must NOT match; with neither, always.
 */
export function triggerFires(trigger, files) {
  if (!trigger) return false;
  if (trigger.paths && trigger.paths.length) return files.some((f) => trigger.paths.some((p) => pathMatches(p, f)));
  if (trigger.pathsIgnore && trigger.pathsIgnore.length) return files.some((f) => !trigger.pathsIgnore.some((p) => pathMatches(p, f)));
  return true;
}

/**
 * The files a renumber touches — the exact change that wedged seven PRs. If a required context is
 * unreachable on THIS file list, the repo is one renumber away from the same outage.
 */
export const DOCS_ONLY_CHANGE = [
  "BACKLOG.md", "BACKLOG_OPEN.md", "docs/archive/BACKLOG-DONE.md", "VERIFICATION.md", "docs/archive/VERIFICATION-DONE.md", "MAP.md",
];

/**
 * PURE verdict. `required` = the contexts the ruleset requires; `workflows` = parsed workflows.
 * Returns `{ ok, missing, unreachable, produced }`.
 *
 *  - `missing`     — a required context no workflow produces on `pull_request` → main. It can never
 *                    report, so every PR is permanently blocked. This is the name-drift trap.
 *  - `unreachable` — a required context whose producing trigger would NOT fire on a docs-only
 *                    change. It reports on code PRs and hangs on docs PRs, which is worse than
 *                    always broken because it looks fine most of the time.
 */
export function contractVerdict({ required = [], workflows = [], branch = "main", docsOnly = DOCS_ONLY_CHANGE } = {}) {
  const produced = new Map(); // checkName → [{ workflow, trigger }]
  for (const wf of workflows) {
    for (const name of pullRequestCheckNames(wf, branch)) {
      if (!produced.has(name)) produced.set(name, []);
      produced.get(name).push({ workflow: wf.file || wf.name, trigger: wf.on.pull_request });
    }
  }

  const missing = [];
  const unreachable = [];
  for (const ctx of required) {
    const producers = produced.get(ctx);
    if (!producers || !producers.length) { missing.push(ctx); continue; }
    // Reachable if ANY producing job's trigger fires on a docs-only change — that is exactly the
    // "companion job with the same check name" pattern doing its job.
    if (!producers.some((p) => triggerFires(p.trigger, docsOnly))) {
      unreachable.push({ context: ctx, workflows: producers.map((p) => p.workflow) });
    }
  }

  return { ok: missing.length === 0 && unreachable.length === 0, missing, unreachable, produced: [...produced.keys()].sort() };
}
