/* V1895328 / B2451824 — the team-invite inbox, driven signed in on a real deploy.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-team-invite-inbox-live.mjs <base> <expectedBuild> "<team to accept>" "<team to decline>"
 *
 * Runs as the SECOND pinned test account (e2e-teammate@planyr.test — it owns nothing, so a throwaway
 * team + invite seeded for it by SQL is the whole fixture; the caller deletes them afterwards, owner
 * constraint #15). Asserts, in ONE observation with the served build (a stale tab would otherwise pass
 * or fail for the wrong build):
 *   1. /version.json build starts with <expectedBuild>
 *   2. the badge on the visible account button equals the invite count the server itself reports
 *      (known-good arm: list_my_invites over the page's own client — the count is independent of the UI)
 *   3. each card shows its team, "<inviter> invited you as <role>", Accept and Decline
 *   4. Accept → card leaves, "You joined …", list_my_teams has the team, one invite left
 *   5. Decline → card leaves, list_my_teams does NOT have the team, none left, badge gone
 *   6. after a reload both answers persisted (no invite back, membership kept, no silent re-join)
 * Exits non-zero on the first failed assertion, naming it. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const [base = "https://planyr.io", wantBuild, acceptName, declineName] = process.argv.slice(2);
if (!wantBuild || !acceptName || !declineName) { console.error("usage: <base> <expectedBuild> <accept team> <decline team>"); process.exit(2); }
const SHOTS = process.env.SHOT_DIR || "/tmp/team-invite-inbox-live";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) throw new Error("assertion failed: " + name); };

const rpc = (page, fn, args) => page.evaluate(async ([f, a]) => { const r = await window.pfSupabase.rpc(f, a || {}); return r.error ? { error: r.error.message } : { data: r.data }; }, [fn, args]);
const trigger = (page) => page.locator('button[aria-label^="Account:"]:visible').first();

let s;
try {
  s = await openSignedIn({ account: "teammate", base });
  const { page } = s;
  await assertMeasurable(page, "verify-team-invite-inbox-live");
  check("served build matches the merge commit (read in this same run)", !!(s.build && String(s.build.build).startsWith(wantBuild)), JSON.stringify(s.build));
  check("signed in as the teammate test account", s.proof.email === "e2e-teammate@planyr.test", s.proof.email);

  const listed = await rpc(page, "list_my_invites");
  check("server lists exactly the two seeded invitations for this account", !listed.error && listed.data.length === 2, JSON.stringify(listed.error || listed.data.map((r) => r.team_name)));
  const expectedCount = String(listed.data.length);

  await trigger(page).waitFor({ state: "visible", timeout: 20000 });
  const badge = trigger(page).getByTestId("account-invite-badge");
  await badge.waitFor({ state: "visible", timeout: 20000 });
  check("badge count equals the server's own count", (await badge.innerText()).trim() === expectedCount, `badge=${(await badge.innerText()).trim()} server=${expectedCount}`);

  await trigger(page).click();
  const card = (name) => page.getByTestId("account-invite-card").filter({ hasText: name });
  for (const name of [acceptName, declineName]) {
    const c = card(name);
    await c.waitFor({ state: "visible", timeout: 10000 });
    const text = await c.innerText();
    const row = listed.data.find((r) => r.team_name === name);
    check(`card "${name}" shows who invited and the role`, text.includes(`${row.invited_by_name} invited you as ${row.role}`), text.replace(/\s+/g, " "));
    check(`card "${name}" has Accept and Decline`, (await c.getByTestId("account-invite-accept").isVisible()) && (await c.getByTestId("account-invite-decline").isVisible()));
  }
  const box = await page.getByTestId("account-invites").boundingBox();
  const vp = page.viewportSize();
  check("the invitations block sits inside the viewport", box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height, JSON.stringify(box));
  await page.screenshot({ path: `${SHOTS}/menu-two-invites.png` });

  // Accept
  await card(acceptName).getByTestId("account-invite-accept").click();
  await card(acceptName).waitFor({ state: "detached", timeout: 15000 });
  check("Accept: the card leaves and the note says you joined", (await page.getByTestId("account-invites").innerText()).includes(`You joined ${acceptName}.`));
  let teams = await rpc(page, "list_my_teams");
  check("Accept: list_my_teams now has the team (and only that one)", !teams.error && teams.data.some((t) => t.name === acceptName) && !teams.data.some((t) => t.name === declineName), JSON.stringify(teams.error || teams.data.map((t) => t.name + ":" + t.role)));
  check("Accept: one invitation is left", (await rpc(page, "list_my_invites")).data.length === 1);
  await page.screenshot({ path: `${SHOTS}/menu-after-accept.png` });

  // Decline
  await card(declineName).getByTestId("account-invite-decline").click();
  await card(declineName).waitFor({ state: "detached", timeout: 15000 });
  teams = await rpc(page, "list_my_teams");
  check("Decline: no membership in the declined team", !teams.data.some((t) => t.name === declineName));
  check("Decline: no invitations left", (await rpc(page, "list_my_invites")).data.length === 0);
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 400);
  check("Decline: the badge is gone", (await trigger(page).getByTestId("account-invite-badge").count()) === 0);

  // Persistence + no silent re-join on a fresh load
  await page.reload({ waitUntil: "domcontentloaded" });
  await trigger(page).waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2500);
  check("after reload: still no badge", (await trigger(page).getByTestId("account-invite-badge").count()) === 0);
  teams = await rpc(page, "list_my_teams");
  check("after reload: membership kept for the accepted team only", teams.data.some((t) => t.name === acceptName) && !teams.data.some((t) => t.name === declineName));
  console.log(`\nALL ${results.length} CHECKS PASSED  (screenshots in ${SHOTS})`);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exitCode = 1;
} finally { if (s) await s.close(); }
