/* MERGED IS NOT DEPLOYED. NAME THE BYTES YOU ARE TESTING, OR THE PASS IS ABOUT THE WRONG ARTIFACT.
 *
 * A harness that boots `public/` off a local static server proves something about the WORKING TREE.
 * The thing the owner opens is whatever Cloudflare is serving at planyr.io, which can be a commit
 * behind, or a failed deploy, or a cached edge copy. Those are different claims and this repo has
 * already been bitten by conflating them (the MERGED ≠ LIVE rule in CLAUDE.md).
 *
 * So: set `PLANYR_URL` and a harness drives the DEPLOYED artifact instead of the local tree — and
 * `servedProvenance` says WHICH commit's bytes came back, by hashing the served file as a git blob
 * and looking that blob up in the recent history. It reports one of:
 *   · matches origin/main            → the deploy is current
 *   · matches an older commit        → NAMED, with how far behind it is
 *   · matches nothing in history     → an edge cache or a partial deploy; say so, do not guess
 * A run that cannot identify its own bytes must report that rather than claim a pass.
 */
import { execFileSync } from "node:child_process";

const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", cwd: opts.cwd || process.cwd(), input: opts.input, maxBuffer: 64 * 1024 * 1024 }).trim();

/**
 * Hash the served bytes as git would, then find which commit carries that exact blob.
 * Returns the BODY too, so a harness can drive the deployed bytes themselves.
 *
 * ⛔ WHAT THIS DOES AND DOES NOT COVER, stated because the difference is the whole point of the
 * file. Chromium cannot reach the public internet from this sandbox (the egress proxy resets the
 * connection; Node's fetch is allowed, the browser is not), so a harness in PLANYR_URL mode serves
 * the FETCHED bytes locally and drives those. The artifact under test is therefore the deployed
 * one, proven byte-for-byte by its git blob hash — that is a real answer to "is the fix in what he
 * receives". It is NOT a test of the edge itself: response headers, CSP, caching and the CDN
 * delivery of the page's libraries are not exercised. Say so rather than implying a full live pass.
 */
export async function servedProvenance(url, repoPath = "public/sequence/index.html", { depth = 80 } = {}) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return { ok: false, reason: `${url} returned HTTP ${res.status}` };
  const body = Buffer.from(await res.arrayBuffer());
  const blob = git(["hash-object", "--stdin"], { input: body });

  let head = null, main = null, commits = [];
  try { head = git(["rev-parse", `HEAD:${repoPath}`]); } catch { /* path may not exist there */ }
  try { main = git(["rev-parse", `origin/main:${repoPath}`]); } catch { /* no origin/main locally */ }
  try { commits = git(["rev-list", `-n${depth}`, "origin/main"]).split("\n").filter(Boolean); } catch { /* shallow clone */ }

  let servingCommit = null, behind = null;
  for (let i = 0; i < commits.length; i++) {
    let b = null;
    try { b = git(["rev-parse", `${commits[i]}:${repoPath}`]); } catch { continue; }
    if (b === blob) { servingCommit = commits[i]; behind = i; break; }
  }
  return {
    ok: true, bytes: body.length, blob, body,
    matchesMain: main != null && blob === main,
    matchesHead: head != null && blob === head,
    servingCommit, commitsBehindMain: behind,
    subject: servingCommit ? git(["log", "-1", "--format=%s", servingCommit]).slice(0, 100) : null,
    identified: !!servingCommit,
  };
}

/** One printable block, so every deployed run states what it measured before it measures it. */
export function provenanceReport(p, url) {
  if (!p.ok) return `  ⛔ could not read the deployed artifact — ${p.reason}`;
  const L = [`  deployed artifact: ${url}  (${p.bytes.toLocaleString()} bytes, blob ${p.blob.slice(0, 12)})`];
  if (p.matchesMain) L.push(`  ✓ byte-identical to origin/main — the deploy is CURRENT, so this run measures what he opens`);
  else if (p.servingCommit) L.push(`  ⚠ NOT current: the deploy is serving ${p.servingCommit.slice(0, 8)} — "${p.subject}" — ${p.commitsBehindMain} commit(s) behind origin/main`);
  else L.push(`  ⚠ the served bytes match NO commit in the recent history — an edge cache or a partial deploy. Do not read a pass here as a pass on main.`);
  if (!p.matchesHead && p.matchesMain) L.push(`  (this working tree differs from what is deployed, which is expected while a branch is open)`);
  L.push(`  scope: these are the deployed bytes, driven in a real browser. The edge itself — headers, CSP, caching — is NOT under test.`);
  return L.join("\n");
}
