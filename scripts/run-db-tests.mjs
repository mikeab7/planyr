#!/usr/bin/env node
// scripts/run-db-tests.mjs — B<PENDING> (NEW-2, 2026-09-20/22)
//
// Runs every self-rolling-back SQL guard test under a given db/test/ folder against a REAL
// Postgres database via `psql`, and reports PASS/FAIL/ERROR per file using the explicit verdict
// registry in scripts/db-test-verdict.mjs (never a guessed regex — see that file's header).
//
// Every one of these test files is written to raise a PL/pgSQL exception unconditionally at the
// end — on pass AND fail alike — specifically so nothing it does during the run ever survives
// the transaction (SELF-ROLLING-BACK, per each file's own header). That means psql's own exit
// code is ALWAYS non-zero here and carries no pass/fail signal by itself; the verdict lives in
// the exception's MESSAGE TEXT, which this script captures from combined stdout+stderr and hands
// to classifyTestOutput().
//
// USAGE:
//   node scripts/run-db-tests.mjs --dsn "$DATABASE_URL" [--dir <path-to-a-db/test-folder>]
//   DATABASE_URL env var works in place of --dsn.
//   --dir defaults to src/workspaces/site-planner/db/test (the NEW-2 scope). Pass a different
//   folder to run another workspace's db/test suite once one exists.
//
// EXIT CODE: 0 only if every .test.sql file in --dir produced a definitive PASS. Any FAIL or
// ERROR (including an unregistered file, a connection failure, or unparseable output) exits 1 —
// fail-closed, never a silent green on an ambiguous result.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTestOutput } from "./db-test-verdict.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dir: null, dsn: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--dsn") args.dsn = argv[++i];
  }
  return args;
}

function runOneFile(dsn, filePath) {
  // psql sends a raised exception's ERROR text to STDERR, not stdout — and, measured directly
  // (2026-09-22, against a real local Postgres 16), it EXITS 0 by default when it hits one,
  // because ON_ERROR_STOP defaults to off. So there is no reliable signal in psql's own exit
  // code at all here, on EITHER stream: the verdict lives purely in the combined text. Use
  // spawnSync (not execFileSync) so both streams are captured identically whether psql exits 0
  // or not — an execFileSync try/catch split was tried first and silently dropped stderr on the
  // (default) exit-0 path, which is exactly the case every one of these test files hits.
  const res = spawnSync("psql", [dsn, "-v", "ON_ERROR_STOP=0", "-X", "-q", "-f", filePath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    // psql itself could not be launched (not installed, bad path, etc.) — distinct from a SQL
    // failure, and worth saying so plainly rather than feeding a blank string to the classifier.
    return `RUNNER_ERROR: failed to launch psql: ${res.error.message}`;
  }
  return `${res.stdout || ""}\n${res.stderr || ""}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dsn = args.dsn || process.env.DATABASE_URL;
  if (!dsn) {
    console.error("run-db-tests: no database connection string — pass --dsn or set DATABASE_URL.");
    process.exit(1);
  }
  const dir = args.dir
    ? path.resolve(args.dir)
    : path.resolve(__dirname, "..", "src", "workspaces", "site-planner", "db", "test");

  let files;
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".test.sql"))
      .sort();
  } catch (err) {
    console.error(`run-db-tests: could not read test directory ${dir}: ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`run-db-tests: no *.test.sql files found in ${dir} — refusing to report a vacuous pass.`);
    process.exit(1);
  }

  console.log(`run-db-tests: running ${files.length} SQL guard test(s) from ${dir}\n`);

  const results = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const output = runOneFile(dsn, filePath);
    const verdict = classifyTestOutput(file, output);
    results.push({ file, verdict, output });
    const label = verdict.status === "pass" ? "PASS" : verdict.status === "fail" ? "FAIL" : "ERROR";
    console.log(`[${label}] ${file}`);
    if (verdict.status !== "pass") {
      // Print the captured output for a failing/erroring file so the CI log carries the real
      // report (which test case failed, or why the output was unparseable) without a second pass.
      console.log(output.trim().split("\n").map((l) => `    ${l}`).join("\n"));
    }
  }

  const failed = results.filter((r) => r.verdict.status !== "pass");
  console.log(
    `\nrun-db-tests: ${results.length - failed.length}/${results.length} files passed` +
      (failed.length ? `, ${failed.length} FAILED: ${failed.map((r) => r.file).join(", ")}` : "")
  );

  process.exit(failed.length === 0 ? 0 : 1);
}

main();
