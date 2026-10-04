/* sqlColumns — pure DDL scanner: which TABLE.COLUMN pairs do the repo's .sql migrations define?
 * Used by the denormalised-copy guard (test/denormalisedCopies.test.js). Deliberately a scanner, not a
 * SQL parser: it only needs `create table <t> ( col type ... , ... )` bodies and
 * `alter table <t> add column [if not exists] <col> <type>` — anything it cannot read is skipped,
 * and the guard's dead-entry check proves a declared column was actually seen. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function walkSql(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const f of names) {
    if (f === "node_modules" || f === "test" || f === ".claude") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkSql(p, out);
    else if (f.endsWith(".sql")) out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const CONSTRAINT = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;
const unq = (s) => s.replace(/"/g, "").replace(/^public\./i, "");

/* split a create-table body on top-level commas */
function topLevelSplit(body) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** @returns {{table:string,column:string,type:string,file:string}[]} */
export function scanColumns(files) {
  const out = [];
  for (const file of files) {
    const sql = stripComments(readFileSync(file, "utf8"));
    const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi;
    let m;
    while ((m = ct.exec(sql))) {
      let i = ct.lastIndex, depth = 1;
      while (i < sql.length && depth > 0) { if (sql[i] === "(") depth++; else if (sql[i] === ")") depth--; i++; }
      const table = unq(m[1]);
      for (const part of topLevelSplit(sql.slice(ct.lastIndex, i - 1))) {
        const t = part.trim();
        if (!t || CONSTRAINT.test(t)) continue;
        const cm = /^("?\w+"?)\s+(\w+)/.exec(t);
        if (cm) out.push({ table, column: unq(cm[1]), type: cm[2].toLowerCase(), file });
      }
    }
    const ac = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([^;]*);/gi;
    while ((m = ac.exec(sql))) {
      const table = unq(m[1]);
      const re = /add\s+column\s+(?:if\s+not\s+exists\s+)?("?\w+"?)\s+(\w+)/gi;
      let a;
      while ((a = re.exec(m[2]))) out.push({ table, column: unq(a[1]), type: a[2].toLowerCase(), file });
    }
  }
  return out;
}
