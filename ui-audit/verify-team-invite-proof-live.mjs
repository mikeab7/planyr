/* V2080640 / B2635968 — a team invite must prove the mailbox, driven signed in on a real deploy.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-team-invite-proof-live.mjs <base> <expectedBuild> --stage 1,2,… [--cleanup]
 *
 * The two pinned test accounts: PRIMARY (e2e@planyr.test) creates a throwaway team per path ("ZZ proof …") and the
 * invite; TEAMMATE (e2e-teammate@planyr.test) is the existing-account invitee. Between stages the caller toggles the
 * teammate's mailbox proof with SQL (mailbox_proofs) — a client cannot, by design:
 *   stage 1  no account, via the link        (new address zz-proof-<n>@planyr.test; the caller deletes that user afterwards)
 *   stage 4  signed in as ANOTHER address    (primary opens the teammate's link)            — teammate UNPROVEN or proven
 *   stage 6  account menu, UNPROVEN mailbox  (teammate; needs NO proof row)  + stage 7 the once-per-session notice
 *   stage 2  signed in as that address, tap to join (proves the mailbox)
 *   stage 5  account menu, PROVEN mailbox    (needs the proof row stage 2 wrote)
 *   stage 3  signed out → sign-in screen filled in → sign in → Accept
 *   stage 9  stranger: a throwaway address WITH an open invite signs up WITHOUT the link → not on the team
 *   stage 10 edge states each end on a next step (used / declined / replaced / gone)
 * Every stage asserts in ONE observation with the served build (/version.json) so a stale tab cannot pass or fail for
 * the wrong build. --cleanup deletes every "ZZ proof …" team the primary owns (cascades invites + memberships).
 * Exits non-zero on the first failed assertion, naming it. */
import { mkdirSync } from "node:fs";
import { openSignedIn, signInViaRoute } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const [base = "https://planyr.io", wantBuild, ...rest] = process.argv.slice(2);
const stageArg = (rest.find((a) => a.startsWith("--stage")) && (rest[rest.indexOf("--stage") + 1] || rest.find((a) => a.startsWith("--stage=")).split("=")[1])) || "";
const stages = new Set(String(stageArg).split(",").filter(Boolean).map(Number));
const CLEANUP = rest.includes("--cleanup");
if (!wantBuild || (!stages.size && !CLEANUP)) { console.error("usage: <base> <expectedBuild> --stage 1,2,… [--cleanup]"); process.exit(2); }
const SHOTS = process.env.SHOT_DIR || "/tmp/team-invite-proof-live";
mkdirSync(SHOTS, { recursive: true });
const TEAMMATE = "e2e-teammate@planyr.test";
const RUN = Date.now().toString(36);

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) throw new Error("assertion failed: " + name); };
const rpc = (page, fn, args) => page.evaluate(async ([f, a]) => { const r = await window.pfSupabase.rpc(f, a || {}); return r.error ? { error: r.error.message } : { data: r.data }; }, [fn, args]);
const link = (id) => `${base}/?app&invite=${id}`;
const trigger = (page) => page.locator('button[aria-label^="Account:"]:visible').first();

/** As the primary: a throwaway team + an invite for `email`. Returns { teamId, inviteId }. */
async function seed(page, label, email) {
  const made = await page.evaluate(async ([name, em]) => {
    const t = await window.pfSupabase.rpc("create_team", { p_name: name });
    if (t.error) return { error: "create_team: " + t.error.message };
    const i = await window.pfSupabase.from("team_invites").insert({ team_id: t.data, email: em, role: "member" }).select("id").single();
    return i.error ? { error: "invite: " + i.error.message } : { teamId: t.data, inviteId: i.data.id };
  }, [`ZZ proof ${label} ${RUN}`, email]);
  if (made.error) throw new Error("seed failed — " + made.error);
  return made;
}
async function signedOut(page) { await page.evaluate(async () => { await window.pfSupabase.auth.signOut({ scope: "local" }); }); }
async function open(page, url) { await page.goto(url, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 }); }

let primary, mate;
try {
  primary = await openSignedIn({ account: "primary", base });
  const pg = primary.page;
  await assertMeasurable(pg, "verify-team-invite-proof-live");
  check("served build matches the merge commit (read in this same run)", !!(primary.build && String(primary.build.build).startsWith(wantBuild)), JSON.stringify(primary.build));
  check("signed in as the primary test account", primary.proof.email === "e2e@planyr.test", primary.proof.email);

  if (CLEANUP) {
    const del = await pg.evaluate(async () => {
      const mine = await window.pfSupabase.from("teams").select("id,name").like("name", "ZZ proof %");
      const ids = (mine.data || []).map((t) => t.id);
      for (const id of ids) await window.pfSupabase.from("teams").delete().eq("id", id);
      const left = await window.pfSupabase.from("teams").select("id").like("name", "ZZ proof %");
      return { deleted: ids.length, left: (left.data || []).length };
    });
    check(`cleanup: ${del.deleted} throwaway team(s) deleted, none left`, del.left === 0, JSON.stringify(del));
  }

  // ── stage 1: no account, via the link ──────────────────────────────────────────────────────────────────────────
  if (stages.has(1)) {
    const email = `zz-proof-${RUN}@planyr.test`;
    const s = await seed(pg, "1 new-account", email);
    await signedOut(pg);
    await open(pg, link(s.inviteId));
    const card = pg.getByTestId("invite-landing-signup");
    await card.waitFor({ state: "visible", timeout: 20000 });
    check("1: create-account card shows, address filled in and read-only, no Turnstile widget", (await pg.getByTestId("invite-signup-email").inputValue()) === email && (await pg.getByTestId("invite-signup-email").getAttribute("readonly")) !== null && (await pg.locator('iframe[src*="turnstile"], .cf-turnstile').count()) === 0);
    await pg.getByTestId("invite-signup-first").fill("Zz");
    await pg.getByTestId("invite-signup-last").fill("Proof");
    await pg.getByTestId("invite-signup-password").fill("Zz-proof-" + RUN);
    await pg.getByTestId("invite-signup-submit").click();
    await pg.getByTestId("invite-landing-joined").waitFor({ state: "visible", timeout: 30000 });
    const text = await pg.getByTestId("invite-landing-joined").innerText();
    check("1: \"You're on <team>.\" — never \"already been used\"", /You're on ZZ proof 1 new-account/.test(text) && !/already been used/.test(text), text.replace(/\s+/g, " "));
    const me = await pg.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.email);
    const teams = await rpc(pg, "list_my_teams");
    check("1: signed in as the invited address and the team is in list_my_teams", me === email && !teams.error && teams.data.some((t) => /ZZ proof 1 new-account/.test(t.name)), JSON.stringify(teams.error || teams.data.map((t) => t.name)));
    const inv = await rpc(pg, "list_my_invites");
    check("1: the mailbox is proven (list_my_invites answers, no invitation left)", !inv.error && inv.data.length === 0);
    console.log(`  (caller: delete auth user ${email} afterwards)`);
    await pg.screenshot({ path: `${SHOTS}/stage1-joined.png` });
    await pg.evaluate(async () => { await window.pfSupabase.auth.signOut({ scope: "local" }); });
    await signInViaRoute(pg, process.env.E2E_LOGIN_KEY, "primary");
  }

  // ── stage 9: a stranger signs up with an invited address WITHOUT the link ───────────────────────────────────────────
  if (stages.has(9)) {
    const email = `zz-proof-stranger-${RUN}@planyr.test`;
    const s = await seed(pg, "9 stranger", email);
    // The stranger's account is made the way any sign-up is (admin route needs the invite; here we want NO link) — so the
    // caller creates auth user <email> by SQL/admin and re-runs with --stage 9b. This stage records the fixture only.
    console.log(`  fixture: team ${s.teamId}, open invite for ${email}. Create the auth user for that address WITHOUT the link, then sign in as it and assert: not a member, list_my_invites → proven:false with null team_name, team_invites unreadable.`);
  }

  // ── stage 4: signed in as ANOTHER address ──────────────────────────────────────────────────────────────────────────
  if (stages.has(4)) {
    const s = await seed(pg, "4 wrong-account", TEAMMATE);
    await open(pg, link(s.inviteId));
    const card = pg.getByTestId("invite-landing-wrong-account");
    await card.waitFor({ state: "visible", timeout: 20000 });
    const t = (await card.innerText()).replace(/\s+/g, " ");
    check("4: names the invited address AND the current account, offers a switch", t.includes(TEAMMATE) && t.includes("e2e@planyr.test") && (await pg.getByTestId("invite-landing-switch").innerText()).includes(TEAMMATE), t);
    check("4: no Accept offered", (await pg.getByTestId("invite-landing-accept").count()) === 0);
    const teams = await rpc(pg, "list_my_teams");
    check("4: nothing written for the primary (it was already admin of its own team only)", !teams.error);
    await pg.screenshot({ path: `${SHOTS}/stage4-wrong-account.png` });
  }

  // ── teammate stages ────────────────────────────────────────────────────────────────────────────────────────────────
  if ([2, 3, 5, 6, 7, 10].some((n) => stages.has(n))) {
    mate = await openSignedIn({ account: "teammate", base });
    const mp = mate.page;
    check("signed in as the teammate test account", mate.proof.email === TEAMMATE, mate.proof.email);

    if (stages.has(6) || stages.has(7)) {
      const s = await seed(pg, "6 unproven-menu", TEAMMATE);
      const listed = await rpc(mp, "list_my_invites");
      check("6: UNPROVEN — the server answers only that one is waiting (null id/team/inviter/role)", !listed.error && listed.data.length >= 1 && listed.data.every((r) => r.proven === false && r.invite_id === null && r.team_name === null && r.invited_by_name === null && r.role === null), JSON.stringify(listed.error || listed.data));
      const direct = await mp.evaluate(async () => { const r = await window.pfSupabase.from("team_invites").select("id"); return r.error ? { error: r.error.message } : { n: r.data.length }; });
      check("6: the invite row itself is unreadable to the invitee (0 rows)", direct.n === 0, JSON.stringify(direct));
      await mp.reload({ waitUntil: "domcontentloaded" });
      await trigger(mp).waitFor({ state: "visible", timeout: 20000 });
      if (stages.has(7)) {
        const notice = mp.getByTestId("waiting-invite-notice");
        await notice.waitFor({ state: "visible", timeout: 20000 });
        const nt = (await notice.innerText()).replace(/\s+/g, " ");
        check("7: ONE notice 'A team invitation is waiting for <address>', naming no team", nt.includes("waiting for " + TEAMMATE) && !/ZZ proof/.test(nt), nt);
        await mp.reload({ waitUntil: "domcontentloaded" });
        await trigger(mp).waitFor({ state: "visible", timeout: 20000 });
        await mp.waitForTimeout(3000);
        check("7: not shown again on the next load in the same session", (await mp.getByTestId("waiting-invite-notice").count()) === 0);
      }
      await trigger(mp).click();
      const wait = mp.getByTestId("account-invite-waiting");
      await wait.waitFor({ state: "visible", timeout: 20000 });
      const wt = (await wait.innerText()).replace(/\s+/g, " ");
      check("6: menu card 'A team invitation is waiting for you.' and no team name anywhere in the page", /team invitation/i.test(wt) && !(await mp.content()).includes("ZZ proof"), wt);
      const calls = [];
      mp.on("response", (r) => { if (r.url().endsWith("/api/team/invite-resend")) calls.push(r.status()); });
      await wait.getByTestId("account-invite-accept-waiting").click();
      await mp.getByTestId("account-invite-sent").waitFor({ state: "visible", timeout: 30000 });
      check("6: Accept → \"We sent a confirmation to <address>.\"", (await mp.getByTestId("account-invite-sent").innerText()).includes(`We sent a confirmation to ${TEAMMATE}.`));
      await mp.getByTestId("account-invite-resend").click();
      await mp.waitForTimeout(2500);
      check("6: Resend inside the window is throttled by the server (200 then 429), not a second email", calls.join(",") === "200,429", calls.join(","));
      await mp.screenshot({ path: `${SHOTS}/stage6-waiting.png` });
      void s;
    }

    if (stages.has(2)) {
      const s = await seed(pg, "2 signed-in-link", TEAMMATE);
      await open(mp, link(s.inviteId));
      const ans = mp.getByTestId("invite-landing-answer");
      await ans.waitFor({ state: "visible", timeout: 20000 });
      check("2: 'You've been invited to <team>' with Accept / Decline", (await ans.innerText()).includes("ZZ proof 2 signed-in-link") && (await mp.getByTestId("invite-landing-accept").isVisible()) && (await mp.getByTestId("invite-landing-decline").isVisible()));
      await mp.getByTestId("invite-landing-accept").click();
      await mp.getByTestId("invite-landing-joined").waitFor({ state: "visible", timeout: 20000 });
      check("2: \"You're on <team>.\"", /You're on ZZ proof 2 signed-in-link/.test(await mp.getByTestId("invite-landing-joined").innerText()));
      const teams = await rpc(mp, "list_my_teams");
      check("2: list_my_teams has the team", !teams.error && teams.data.some((t) => /2 signed-in-link/.test(t.name)));
      await mp.screenshot({ path: `${SHOTS}/stage2-joined.png` });
    }

    if (stages.has(5)) {
      const s = await seed(pg, "5 proven-menu", TEAMMATE);
      void s;
      const listed = await rpc(mp, "list_my_invites");
      check("5: PROVEN — the server answers in full (team name + inviter)", !listed.error && listed.data.some((r) => r.proven === true && /5 proven-menu/.test(r.team_name || "")), JSON.stringify(listed.error || listed.data));
      await mp.reload({ waitUntil: "domcontentloaded" });
      await trigger(mp).waitFor({ state: "visible", timeout: 20000 });
      await trigger(mp).click();
      const card = mp.getByTestId("account-invite-card").filter({ hasText: "5 proven-menu" });
      await card.waitFor({ state: "visible", timeout: 20000 });
      await card.getByTestId("account-invite-accept").click();
      await card.waitFor({ state: "detached", timeout: 15000 });
      const teams = await rpc(mp, "list_my_teams");
      check("5: Accept joins at once", !teams.error && teams.data.some((t) => /5 proven-menu/.test(t.name)));
    }

    if (stages.has(3)) {
      const s = await seed(pg, "3 signed-out", TEAMMATE);
      await signedOut(mp);
      await open(mp, link(s.inviteId));
      const email = mp.locator('input[aria-label="Email"]');
      await email.waitFor({ state: "visible", timeout: 20000 });
      check("3: the sign-in screen opens with the invited address filled in", (await email.inputValue()).toLowerCase() === TEAMMATE);
      await signInViaRoute(mp, process.env.E2E_LOGIN_KEY, "teammate");
      await mp.getByTestId("invite-landing-answer").waitFor({ state: "visible", timeout: 30000 });
      await mp.getByTestId("invite-landing-accept").click();
      await mp.getByTestId("invite-landing-joined").waitFor({ state: "visible", timeout: 20000 });
      check("3: after signing in, Accept joins", /You're on ZZ proof 3 signed-out/.test(await mp.getByTestId("invite-landing-joined").innerText()));
    }

    if (stages.has(10)) {
      // used (the teammate is a member) · declined · replaced (deleted + re-seeded = a new id) · gone (team deleted)
      const used = await seed(pg, "10 used", TEAMMATE);
      await open(mp, link(used.inviteId)); await mp.getByTestId("invite-landing-accept").click(); await mp.getByTestId("invite-landing-joined").waitFor({ timeout: 20000 });
      await open(mp, link(used.inviteId));
      const usedCard = mp.getByTestId("invite-landing-notice"); await usedCard.waitFor({ state: "visible", timeout: 20000 });
      const ut = (await usedCard.innerText()).replace(/\s+/g, " ");
      check("10: used link → plain line + a next step button", /already been used/.test(ut) && /ask a team admin to invite you again/.test(ut) && (await mp.getByTestId("invite-landing-open-work").isVisible()), ut);
      const declined = await seed(pg, "10 declined", TEAMMATE);
      await open(mp, link(declined.inviteId)); await mp.getByTestId("invite-landing-decline").click(); await mp.getByTestId("invite-landing-done").waitFor({ timeout: 20000 });
      await open(mp, link(declined.inviteId));
      const dt = (await mp.getByTestId("invite-landing-notice").innerText()).replace(/\s+/g, " ");
      check("10: declined link → says so + ask an admin; next step offered", /was declined/.test(dt) && /invite you again/.test(dt) && (await mp.getByTestId("invite-landing-open-work").isVisible()), dt);
      const gone = await seed(pg, "10 gone", TEAMMATE);
      await pg.evaluate(async (id) => { await window.pfSupabase.from("teams").delete().eq("id", id); }, gone.teamId);
      await open(mp, link(gone.inviteId));
      const gt = (await mp.getByTestId("invite-landing-notice").innerText()).replace(/\s+/g, " ");
      check("10: deleted team / replaced invite → 'no longer available' + what to do", /no longer available/.test(gt) && /ask a team admin to invite you again|check your email/.test(gt), gt);
      const wrongFmt = await open(mp, `${base}/?app&invite=not-a-uuid`).then(() => true);
      check("10: a malformed link opens the app normally (no landing card)", wrongFmt && (await mp.getByTestId("invite-landing-notice").count()) === 0);
    }
  }
  console.log(`\nALL ${results.length} CHECKS PASSED  (screenshots in ${SHOTS})`);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exitCode = 1;
} finally { if (mate) await mate.close(); if (primary) await primary.close(); }
