/* B447472 — RUN THE SQL DIGEST, DON'T PATTERN-MATCH IT.
 *
 * ⛔ WHY THIS EXISTS, because a regex looked like it was doing this job and was not.
 * `test/assemblyGroupCas.test.js` used to assert the migration matched
 *     /string_agg\(t\.id \|\| ':' \|\| t\.rev, ',' order by t\.id\)/
 * which pins the SHAPE OF THE PROJECTION and is structurally blind to the WHERE clause beside it.
 * The two sides can therefore agree character-for-character on how to build a token and still
 * digest DIFFERENT MEMBER SETS — which is exactly what shipped: the SQL had no `kind` predicate,
 * so it folded in every live row sharing an `assembly_id` while the client twin skips
 * `kind !== "el"`. A digest is a comparison between two sets; a test that never builds either set
 * cannot see a disagreement about membership.
 *
 * So this reads the REAL migration and EVALUATES it over rows: the projection AND the filter,
 * both taken from the file. It is deliberately a small, strict interpreter rather than a general
 * SQL engine — every construct it cannot model is a THROW, never a skip, so a future edit that
 * moves the function outside what this understands fails loudly instead of quietly passing.
 *
 * It models exactly what these two queries use: `t.<col> = p_<param>` · `t.<col> = '<literal>'` ·
 * `t.<col> is [not] null`, conjoined by `and`, over a `string_agg(t.a || '<sep>' || t.b, '<join>'
 * order by t.<col>)` projection, optionally wrapped in `coalesce(…, '<default>')`.
 */

const SQL_COLUMNS = new Set(["site_id", "id", "kind", "rev", "assembly_id", "deleted_at", "z_index"]);

const strip = (sql) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** The body of a `create [or replace] function public.<name>(…) … as $$ … $$;` block. */
export function functionBody(sql, name) {
  const src = strip(sql);
  const at = src.indexOf(`function public.${name}(`);
  if (at < 0) throw new Error(`sqlDigestParity: no function public.${name} in the migration`);
  const open = src.indexOf("$$", at);
  const close = src.indexOf("$$", open + 2);
  if (open < 0 || close < 0) throw new Error(`sqlDigestParity: could not delimit ${name}'s body`);
  return src.slice(open + 2, close);
}

/** One `where` condition → a row predicate. Anything unrecognised throws. */
function conditionToPredicate(raw) {
  const cond = raw.trim().replace(/\s+/g, " ");

  let m = /^t\.(\w+) is (not )?null$/i.exec(cond);
  if (m) {
    if (!SQL_COLUMNS.has(m[1])) throw new Error(`sqlDigestParity: unknown column t.${m[1]}`);
    const wantNull = !m[2];
    return { text: cond, fn: (row) => (row[m[1]] == null) === wantNull };
  }

  // `t.<col> = <bound variable>` — the parameter (`p_site`) or a local (`v_asm`). Looked up by its
  // exact name, so a renamed variable is a loud miss rather than a silently-true condition.
  m = /^t\.(\w+) = ([a-z_][a-z0-9_]*)$/i.exec(cond);
  if (m) {
    if (!SQL_COLUMNS.has(m[1])) throw new Error(`sqlDigestParity: unknown column t.${m[1]}`);
    return { text: cond, fn: (row, params) => {
      if (!(m[2] in params)) throw new Error(`sqlDigestParity: the query reads \`${m[2]}\`, which the caller did not supply`);
      return row[m[1]] === params[m[2]];
    } };
  }

  m = /^t\.(\w+) = '([^']*)'$/i.exec(cond);
  if (m) {
    if (!SQL_COLUMNS.has(m[1])) throw new Error(`sqlDigestParity: unknown column t.${m[1]}`);
    return { text: cond, fn: (row) => row[m[1]] === m[2] };
  }

  throw new Error(
    `sqlDigestParity: cannot evaluate the condition \`${cond}\`. This interpreter refuses what it ` +
    `cannot model rather than skipping it — extend it in the same commit that adds the construct.`,
  );
}

/** Every `where` predicate of the last `where … ;` clause in a statement. */
export function wherePredicates(statement) {
  const m = /\bwhere\b([\s\S]*?)(?:\)\s*,\s*'\[\]'::jsonb|;|\)\s*$)/i.exec(statement);
  if (!m) throw new Error("sqlDigestParity: no where clause found");
  const conds = m[1].split(/\band\b/i).map((c) => c.trim()).filter(Boolean);
  if (!conds.length) throw new Error("sqlDigestParity: a where clause with no conditions");
  return conds.map(conditionToPredicate);
}

/* ⛔ NEW-1 — THE ORDER IS PART OF THE DIGEST, SO THE INTERPRETER HAS TO MODEL IT, NOT GUESS IT.
 *
 * This used to sort with `localeCompare(…, "en")` — a stand-in for "whatever the database's default
 * collation does", which is a guess wearing a plausible face. Two orderings can hold the same
 * members and produce different STRINGS, and a different string is a permanent groupConflict; that
 * is precisely the defect NEW-1 found. So: the migration must SAY which collation it orders under,
 * and this refuses to run one that does not. `collate "C"` is byte order, which for UTF-8 is
 * code-point order — modelled below by comparing code points, not UTF-16 code units.
 */
const byCodePoint = (a, b) => {
  const A = Array.from(String(a));
  const B = Array.from(String(b));
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i += 1) {
    const x = A[i].codePointAt(0);
    const y = B[i].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return A.length === B.length ? 0 : A.length < B.length ? -1 : 1;
};

/** The `string_agg(...)` projection, as a function over an already-filtered row set. */
export function aggProjection(statement) {
  const m =
    /string_agg\(\s*t\.(\w+)\s*\|\|\s*'([^']*)'\s*\|\|\s*t\.(\w+)\s*,\s*'([^']*)'\s+order by\s+t\.(\w+)(\s+collate\s+"(\w+)")?\s*\)/i.exec(statement);
  if (!m) throw new Error("sqlDigestParity: could not read the string_agg projection");
  const [, left, glue, right, join, orderBy, , collation] = m;
  for (const c of [left, right, orderBy]) if (!SQL_COLUMNS.has(c)) throw new Error(`sqlDigestParity: unknown column t.${c}`);
  if (collation !== "C") {
    throw new Error(
      `sqlDigestParity: the digest orders by t.${orderBy} under ${collation ? `collate "${collation}"` : "the DATABASE DEFAULT collation"}, ` +
      `which this interpreter will not guess at and the JS twin cannot follow. The ordering is part of ` +
      `the digest STRING: pin it with \`collate "C"\` (byte order) so both sides sort identically.`,
    );
  }
  const empty = /coalesce\(\s*string_agg/i.test(statement) ? (/,\s*''\s*\)/.test(statement) ? "" : null) : null;
  return {
    orderBy,
    collation,
    empty,
    run(rows) {
      const sorted = [...rows].sort((a, b) => byCodePoint(a[orderBy], b[orderBy]));
      if (!sorted.length) {
        if (empty == null) throw new Error("sqlDigestParity: the projection has no coalesce — an empty group is NULL, not ''");
        return empty;
      }
      return sorted.map((r) => `${r[left]}${glue}${r[right]}`).join(join);
    },
  };
}

/**
 * The migration's `assembly_digest`, executed.
 * Returns { digest(rows, params), members(rows, params), conditions }.
 */
export function sqlAssemblyDigest(sql) {
  const body = functionBody(sql, "assembly_digest");
  const preds = wherePredicates(body);
  const proj = aggProjection(body);
  const filter = (rows, params) => rows.filter((row) => preds.every((p) => p.fn(row, params)));
  return {
    conditions: preds.map((p) => p.text),
    orderBy: proj.orderBy,
    collation: proj.collation,     // NEW-1 — the ordering is part of the digest, so it is inspectable
    members: (rows, params) => filter(rows, params),
    digest: (rows, params) => proj.run(filter(rows, params)),
  };
}

/**
 * The `members` payload the RPC returns on a mismatch — a SECOND query over the same table, with
 * its own where clause. It is read separately on purpose: the client ADOPTS what it names, so a
 * membership disagreement here deadlocks the retry just as surely as one in the digest.
 */
export function sqlConflictMembers(sql) {
  const body = functionBody(sql, "commit_elements");
  const at = body.indexOf("jsonb_agg(jsonb_build_object");
  if (at < 0) throw new Error("sqlDigestParity: no members subquery in commit_elements");
  const end = body.indexOf("), '[]'::jsonb", at);
  const statement = body.slice(at, end < 0 ? undefined : end);
  const preds = wherePredicates(statement + ";");
  return {
    conditions: preds.map((p) => p.text),
    rows: (rows, params) => rows.filter((row) => preds.every((p) => p.fn(row, params))),
  };
}
