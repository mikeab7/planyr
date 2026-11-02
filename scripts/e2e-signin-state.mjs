#!/usr/bin/env node
/* Prints (and writes to the Actions step summary) the real state of the scheduled e2e run's SIGN-IN step — see
 * scripts/lib/e2eSigninState.mjs. Exit 1 ONLY when "authenticate once" FAILED, so that case is a named, separate failure
 * instead of one of hundreds. Usage: node scripts/e2e-signin-state.mjs --report e2e-results.json */
import { readFileSync, appendFileSync } from "node:fs";
import { signinState } from "./lib/e2eSigninState.mjs";

const i = process.argv.indexOf("--report");
const path = i > -1 ? process.argv[i + 1] : "e2e-results.json";
let report;
try { report = JSON.parse(readFileSync(path, "utf8")); } catch (e) { console.log(`e2e sign-in state: cannot read ${path} (${e.message}) — the run produced no machine-readable report.`); process.exit(1); }
const s = signinState(report, process.env);
console.log(`e2e sign-in state: ${s.line}\n  cases: ${s.counts.total} · passed ${s.counts.passed} · failed ${s.counts.failed} · skipped ${s.counts.skipped}`);
if (s.setupStatus === "skipped" || s.setupStatus === "failed") console.log(`::${s.setupStatus === "failed" ? "error" : "warning"} title=e2e sign-in ${s.setupStatus}::${s.line}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### e2e sign-in state\n${s.line}\n\n| passed | failed | skipped | total |\n|---|---|---|---|\n| ${s.counts.passed} | ${s.counts.failed} | ${s.counts.skipped} | ${s.counts.total} |\n`);
process.exit(s.verdict === "fail" ? 1 : 0);
