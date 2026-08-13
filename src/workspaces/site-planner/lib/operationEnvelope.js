/* ⛔ NEW-7 (B472048) — AN OPERATION ENVELOPE: WHO DID IT, AND WHAT IT WAS PART OF.
 *
 * THE CASE THIS COMES FROM, confirmed against production rather than retold. On 2026-08-13 two
 * sessions were live in site `smsqi16s9ej4`. The database recorded, at ONE identical microsecond
 * (18:58:34.590193+00), with ONE account id and nothing linking them:
 *
 *     e56              parcel  rev 4  deleted_at 14:57:34.590193
 *     e1454594huuiov   parcel  rev 4  deleted_at 14:57:34.590193
 *     e1454919qhgshe   parcel  rev 1  created
 *
 * That is a parcel MERGE. It is unreadable as one: the only reading the rows support is
 * "77 − 2 + 1". A session came one query away from hand-writing an UPDATE to un-delete two parcels
 * the owner had deliberately consumed, which would have resurrected them overlapping his new
 * merged parcel. The owner's instruction, verbatim: *"make sure you put something in there so that
 * you don't get confused about whether it was me that did it or something else. I feel like the
 * code should be written better so that you don't get confused."*
 *
 * ⛔ WHY `actor_session_id` IS THE LOAD-BEARING FIELD AND `actor_user_id` IS NOT.
 * `site_elements` has carried `updated_by` / `deleted_by` since the beginning, stamped SERVER-side
 * from `auth.uid()` on all five write statements. They are NOT decorative — `elementSync`'s
 * `foreignAuthor()` reads them for own-echo suppression (B1116) and for the conflict-toast name
 * resolver. But BOTH live sessions authenticate as the SAME account, so a user id can never answer
 * *"was that my other tab, or me?"*. A per-TAB id is the only thing that can, and it is the reason
 * this module exists at all. The user id is carried too, because a future teammate is a different
 * account and the pair together answers both questions.
 *
 * ⛔ THE SESSION ID IS PROMOTED, NOT MINTED. `elementJournal.journalSessionId()` already exists and
 * already has exactly the right lifetime — `sessionStorage`-backed, so it survives a reload IN
 * PLACE (which is what makes "my own earlier write" still mine after a refresh) and differs across
 * tabs. Two weaker candidates were considered and rejected: `randomIdSalt()` in `SitePlanner.jsx`
 * is per-page-LOAD (a reload would make you a stranger to yourself) and is already baked into
 * element ids; `multiTab.js`'s `tabId` is per-realm and shared by every workspace header in one
 * tab. Minting a third id would put three answers to one question in the codebase.
 *
 * ⛔ AND THE OPERATION ID IS MINTED ONCE PER USER-VISIBLE ACTION, NOT PER ROW OR PER BATCH.
 * A batch is a transport detail — the autosave debounce decides it. An OPERATION is what the user
 * did. A merge is one operation that writes three rows; a drag is one operation that writes an
 * assembly. `beginOperation()` is called where the gesture is (the same seam `pushHistory()` uses,
 * which is already exactly one call per undoable action) and every row the diff produces until the
 * next `beginOperation()` carries that id.
 *
 * SCOPE FENCE, from the owner verbatim: no CRDT, no per-keystroke history, no audit-log UI. "The
 * bar is: any human or agent looking at this plan five minutes later can answer 'who did this, and
 * what were they doing' without reading the database."
 *
 * Pure — no DOM, no clock read of its own (timestamps are injected), no storage except through the
 * injected session-id getter. Unit-tested in `test/operationEnvelope.test.js`.
 */

/* ⛔ THE VOCABULARY IS CLOSED, AND THAT IS THE POINT.
 *
 * An open string field degrades to whatever each call site felt like typing, and then the activity
 * view cannot render a sentence and the merge/split cases cannot be told from row arithmetic. Every
 * kind here answers "what was the user DOING", never "what happened to this row" — the row already
 * says created/updated/deleted, and re-encoding that would make the envelope a second copy of a
 * fact the rows carry (the `group_rev` mistake this codebase has already learned once).
 *
 * ⛔ `merge` / `split` / `replace` ARE THE REASON THE VOCABULARY EXISTS. Each writes a DELETE and a
 * CREATE in the same operation, and each is meaningless as net row arithmetic:
 *   merge   — N consumed, 1 created. "77 − 2 + 1" is the reading that nearly cost real data.
 *   split   — 1 superseded, N created. The 2026-08-13 notch split wrote its piece and then deleted
 *             it 3.66 s later in a SEPARATE write; one op id makes that visibly one half-landed
 *             operation instead of two unrelated ones.
 *   replace — a paste over existing geometry.
 */
export const OP_KINDS = Object.freeze({
  create: { label: "created", phrase: (n) => `created ${n}` },
  delete: { label: "deleted", phrase: (n) => `deleted ${n}` },
  move: { label: "moved", phrase: (n) => `moved ${n}` },
  resize: { label: "resized", phrase: (n) => `resized ${n}` },
  rotate: { label: "rotated", phrase: (n) => `rotated ${n}` },
  edit: { label: "edited", phrase: (n) => `edited ${n}` },
  paste: { label: "pasted", phrase: (n) => `pasted ${n}` },
  import: { label: "imported", phrase: (n) => `imported ${n}` },
  // The three that a row-level reading cannot represent:
  merge: { label: "merged", phrase: (n) => `merged ${n}`, composite: true },
  split: { label: "split", phrase: (n) => `split ${n}`, composite: true },
  replace: { label: "replaced", phrase: (n) => `replaced ${n}`, composite: true },
  // The honest fallback. A write with no operation open is NOT given a plausible kind.
  unknown: { label: "changed", phrase: (n) => `changed ${n}` },
});

export const OP_KIND_LIST = Object.freeze(Object.keys(OP_KINDS));
export const isOpKind = (k) => Object.prototype.hasOwnProperty.call(OP_KINDS, k);
/* A composite operation writes a delete AND a create that mean one thing together. The activity
 * view and any operator reading rows must present these as one act, never as net arithmetic. */
export const isCompositeOpKind = (k) => !!(OP_KINDS[k] && OP_KINDS[k].composite);

/* An op id is short and opaque. It is NOT a uuid v4 by ceremony — it rides on every row of every
 * write, so its cost is real; 16 base-36 chars is ~82 bits, far past collision risk for a per-plan
 * operation log, and it stays readable in a psql result. */
export function mintOpId(rand = Math.random) {
  const chunk = () => Math.floor(rand() * 0x100000000).toString(36).padStart(7, "0").slice(0, 7);
  return `op_${chunk()}${chunk()}`;
}

/* ⛔ THE ENVELOPE IS AN OBJECT, NOT FOUR LOOSE ARGUMENTS, so a call site cannot carry three of the
 * four fields. `client_ts` is the CLIENT's clock and is named that deliberately: the server stamps
 * its own `updated_at` and that stays authoritative for ordering. A client clock can be wrong by
 * hours; it is recorded because "the tab thought it was 18:59" is evidence when the two disagree,
 * and it is never used to order anything. */
export function makeEnvelope({ opId, opKind, sessionId, userId = null, clientTs = null } = {}) {
  const kind = isOpKind(opKind) ? opKind : "unknown";
  return {
    op_id: opId || null,
    op_kind: kind,
    actor_session_id: sessionId || null,
    actor_user_id: userId || null,
    client_ts: Number.isFinite(clientTs) ? new Date(clientTs).toISOString() : null,
  };
}

/* Is this envelope complete enough to answer the question the feature exists for? The SESSION is
 * the load-bearing half; a row with an op id but no session cannot answer "was that me". */
export const envelopeAnswersWhoAndWhat = (env) =>
  !!(env && env.op_id && env.actor_session_id && isOpKind(env.op_kind) && env.op_kind !== "unknown");

/* ── The operation tracker ────────────────────────────────────────────────────────────────────
 *
 * ONE open operation at a time, per tab. That is not a simplification — a user does one thing at a
 * time, and a second concurrently-open operation would mean two gestures interleaving, which is
 * exactly the ambiguity this module removes.
 *
 * `beginOperation(kind)` opens one and returns its id. Every `current()` until the next begin
 * carries it. `endOperation()` closes it, and a write with NOTHING open reports `op_kind:"unknown"`
 * with a FRESH op id — deliberately: an unattributed write is still one write, and giving it a
 * plausible kind (or folding it into whatever ran last) is how a wrong story gets told confidently.
 * That is the failure this whole item is about. */
export function createOperationTracker({ sessionId, userId = () => null, now = () => Date.now(), rand = Math.random } = {}) {
  if (typeof sessionId !== "function" && typeof sessionId !== "string") {
    throw new Error("createOperationTracker: sessionId must be a string or a getter");
  }
  const sid = () => (typeof sessionId === "function" ? sessionId() : sessionId);
  const uid = () => (typeof userId === "function" ? userId() : userId);
  let open = null;   // { opId, opKind, startedAt }
  let last = null;   // the most recently closed operation, for reporting

  return {
    beginOperation(opKind, { at = null } = {}) {
      const startedAt = Number.isFinite(at) ? at : now();
      open = { opId: mintOpId(rand), opKind: isOpKind(opKind) ? opKind : "unknown", startedAt };
      return open.opId;
    },
    /* The envelope to stamp on a row RIGHT NOW. With an operation open this is that operation;
     * with none open it is a fresh single-write envelope marked `unknown`. Never null — a row
     * that cannot say who wrote it is the state this item removes. */
    current({ at = null } = {}) {
      const ts = Number.isFinite(at) ? at : now();
      if (open) return makeEnvelope({ opId: open.opId, opKind: open.opKind, sessionId: sid(), userId: uid(), clientTs: ts });
      return makeEnvelope({ opId: mintOpId(rand), opKind: "unknown", sessionId: sid(), userId: uid(), clientTs: ts });
    },
    endOperation() {
      last = open;
      open = null;
      return last ? last.opId : null;
    },
    isOpen: () => !!open,
    openKind: () => (open ? open.opKind : null),
    openId: () => (open ? open.opId : null),
    lastId: () => (last ? last.opId : null),
    /* Read-only introspection for tests and for the undo-ownership check. */
    sessionId: sid,
  };
}

/* ── Reading rows back as OPERATIONS ──────────────────────────────────────────────────────────
 *
 * The activity view's model. Rows in, grouped operations out, newest first. Pure: it takes rows
 * exactly as `site_elements` returns them and reads nothing else.
 *
 * ⛔ A COMPOSITE OPERATION IS DESCRIBED BY WHAT IT DID, NOT BY ITS NET ROW COUNT. `merged 2 parcels
 * into 1` — never `-2 +1`. That sentence is the whole deliverable; if it ever reads as arithmetic
 * again, this function is where it regressed. */
export function groupRowsIntoOperations(rows = [], { selfSessionId = null } = {}) {
  const byOp = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const opId = r.op_id || `row:${r.kind}:${r.id}:${r.rev}`;   // an un-enveloped legacy row is its own operation
    let g = byOp.get(opId);
    if (!g) {
      g = {
        opId,
        opKind: isOpKind(r.op_kind) ? r.op_kind : "unknown",
        sessionId: r.actor_session_id || null,
        userId: r.actor_user_id || null,
        at: r.updated_at || null,
        clientTs: r.client_ts || null,
        enveloped: !!r.op_id,
        created: [], deleted: [], updated: [],
      };
      byOp.set(opId, g);
    }
    // The newest row timestamp in the group represents the operation.
    if (r.updated_at && (!g.at || r.updated_at > g.at)) g.at = r.updated_at;
    const bucket = r.deleted_at ? g.deleted : (r.rev === 1 ? g.created : g.updated);
    bucket.push({ id: r.id, kind: r.kind });
  }
  const out = [...byOp.values()].map((g) => ({
    ...g,
    isMine: !!(selfSessionId && g.sessionId && g.sessionId === selfSessionId),
    rowCount: g.created.length + g.deleted.length + g.updated.length,
  }));
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return out;
}

/* One plain-English sentence for one operation. `nameOf(sessionId, userId)` supplies the actor's
 * display name; `plural(kind, n)` supplies the noun ("2 parcels" / "Building 3").
 *
 * The composite kinds get their real shape, which is the reason the vocabulary is closed:
 *   merge → "merged 2 parcels into 1"      (consumed → produced)
 *   split → "split 1 parcel into 2"
 * Everything else gets "<verb> <N nouns>". */
export function describeOperation(op, { nameOf = () => "Someone", nounOf = (k, n) => `${n} ${k}${n === 1 ? "" : "s"}` } = {}) {
  if (!op) return "";
  const who = op.isMine ? "You" : nameOf(op.sessionId, op.userId);
  const kind = isOpKind(op.opKind) ? op.opKind : "unknown";
  const kindsIn = (list) => {
    const k = [...new Set(list.map((x) => x.kind))];
    return k.length === 1 ? k[0] : "object";
  };
  if (kind === "merge" && op.deleted.length && op.created.length) {
    return `${who} merged ${nounOf(kindsIn(op.deleted), op.deleted.length)} into ${op.created.length}`;
  }
  if (kind === "split" && op.created.length) {
    const src = op.updated.length || op.deleted.length || 1;
    return `${who} split ${nounOf(kindsIn(op.created), src)} into ${op.created.length}`;
  }
  if (kind === "replace" && op.created.length) {
    return `${who} replaced ${nounOf(kindsIn(op.deleted.length ? op.deleted : op.created), Math.max(op.deleted.length, 1))}`;
  }
  const all = [...op.created, ...op.deleted, ...op.updated];
  const spec = OP_KINDS[kind] || OP_KINDS.unknown;
  return `${who} ${spec.phrase(nounOf(kindsIn(all), all.length))}`;
}

/* ⛔ A HALF-LANDED COMPOSITE IS THE 2026-08-13 SPLIT, and naming it is the point.
 *
 * The notch split wrote its 0.647 ac piece and then deleted it 3.66 s later in a separate write.
 * With one op id per operation that is visible as what it is: a composite operation whose halves
 * did not land together. Reported, never repaired automatically — the correct remedy depends on
 * which half was intended, which only the user knows. */
export function halfLandedComposites(ops = []) {
  return (ops || []).filter((o) => o && isCompositeOpKind(o.opKind) && (
    (o.opKind === "merge" && (!o.deleted.length || !o.created.length)) ||
    (o.opKind === "split" && !o.created.length)
  ));
}

/* ── Undo ownership ───────────────────────────────────────────────────────────────────────────
 *
 * ⛔ IN A MULTI-PRESENCE PLAN, UNDO SILENTLY REVERTING SOMEONE ELSE'S OPERATION IS A DATA-LOSS PATH
 * WITH A FRIENDLY BUTTON ON IT. The owner pressed Undo six times on Bain while a second presence
 * was in the plan; the geometry survived, but it cannot be PROVEN that none of the other session's
 * property edits were reverted, and that uncertainty is itself the bug.
 *
 * Three verdicts, and the middle one is the one that did not exist before:
 *   `own`      — the top frame is this session's own operation. Proceed silently, as always.
 *   `foreign`  — it belongs to another session. Name them and REQUIRE confirmation.
 *   `unknown`  — no envelope (a legacy frame, or a write made before this shipped). Warn, do not
 *                block: refusing every un-enveloped frame would make Undo useless on every plan
 *                saved before today, which is a worse failure than the one being fixed.
 */
export function undoOwnership(frameEnvelope, selfSessionId, { nameOf = () => "someone else" } = {}) {
  const sid = frameEnvelope && frameEnvelope.actor_session_id;
  if (!sid || !selfSessionId) {
    return { verdict: "unknown", needsConfirm: false, message: null };
  }
  if (sid === selfSessionId) return { verdict: "own", needsConfirm: false, message: null };
  const who = nameOf(sid, frameEnvelope.actor_user_id) || "someone else";
  return {
    verdict: "foreign",
    needsConfirm: true,
    message: `The next undo would reverse ${who}'s change, not yours. Undo it anyway?`,
  };
}
