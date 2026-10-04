/* NEW-1 (B2038784) — Settings › Team, grouped by role, phone + desktop. Signed in via a seeded session
 * and a STATEFUL mock of teams / members / invites (a role change, a removal, a cancel and a resend
 * really change what the next read returns). Measures the layout rules the owner listed: centred
 * title, three equal tiles with centred content, labels aligned with avatars, switch and ⋯ aligned,
 * no paragraph text, and Resend adding no invite row.
 *
 *   VITE_SUPABASE_URL="https://teamlayout1.supabase.co" VITE_SUPABASE_ANON_KEY="teamlayout1-dummy-key" \
 *     npx playwright test e2e/team-settings-layout.spec.js
 * SHOTS=1 also writes ui-audit/screens/team-settings-*.png. */
import { test, expect } from "@playwright/test";

const HOST = "teamlayout1.supabase.co";
const UID = "22222222-2222-2222-2222-222222222222";
const SHOTS = !!process.env.SHOTS;

function session() {
  const now = Math.floor(Date.now() / 1000), iso = new Date().toISOString();
  return {
    access_token: "a.b.c", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r",
    user: { id: UID, aud: "authenticated", role: "authenticated", email: "mike@planyr.test", email_confirmed_at: iso, phone: "", confirmed_at: iso, last_sign_in_at: iso,
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co" }, identities: [], created_at: iso, updated_at: iso },
  };
}

const freshState = () => ({
  members: [
    { user_id: UID, role: "admin", first_name: "Mike", last_name: "Abbott", email: "mike@planyr.test" },
    { user_id: "u-2", role: "admin", first_name: "Michael", last_name: "Butler", email: "mb.one@planyr.test" },
    { user_id: "u-3", role: "member", first_name: "Ana", last_name: "Ruiz", email: "ana@planyr.test" },
  ],
  invites: [{ id: "inv-1", email: "throwaway@planyr.test", role: "member", created_at: "2026-10-01T00:00:00Z", claimed_at: null }],
  inviteWrites: 0, inviteDeletes: 0, sends: 0, lastSend: {},
});

async function mock(page, st) {
  const KEY = `sb-${HOST.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch (_) {} }, [KEY, session()]);
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      // NEW-1: the invite-email Pages Function. Mirrors its contract incl. the 60 s server throttle.
      if (u.pathname === "/api/team/invite-email") {
        let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch (_) {}
        const last = st.lastSend[b.email] || 0;
        if (Date.now() - last < 60_000) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "throttled", retryAfterSeconds: 30 }) });
        st.lastSend[b.email] = Date.now(); st.sends++;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      return route.continue();
    }
    if (u.hostname !== HOST) return route.abort();
    const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    const p = u.pathname, m = req.method();
    if (p === "/auth/v1/token") return json(session());
    if (p === "/auth/v1/user") return json(session().user);
    if (p.startsWith("/auth/v1/")) return json({});
    if (p === "/rest/v1/rpc/list_my_teams") return json([{ id: "t1", name: "HIP Houston", role: "admin", created_by: UID, created_at: "2026-01-01T00:00:00Z" }]);
    if (p === "/rest/v1/rpc/list_team_members") return json(st.members);
    if (p === "/rest/v1/team_invites") {
      if (m === "GET") return json(st.invites.filter((i) => !i.claimed_at));
      if (m === "POST") {
        st.inviteWrites++;
        let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch (_) {}
        const dup = st.invites.some((i) => i.email === b.email);
        if (!dup) st.invites.push({ id: `inv-${st.invites.length + 1}`, email: b.email, role: b.role, claimed_at: null });
        return json([], 201);
      }
      if (m === "DELETE") { st.inviteDeletes++; const id = (u.searchParams.get("id") || "").replace("eq.", ""); st.invites = st.invites.filter((i) => i.id !== id); return json([]); }
    }
    if (p === "/rest/v1/team_members") {
      const uid = (u.searchParams.get("user_id") || "").replace("eq.", "");
      if (m === "PATCH") { let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch (_) {} st.members = st.members.map((x) => x.user_id === uid ? { ...x, ...b } : x); return json([]); }
      if (m === "DELETE") { st.members = st.members.filter((x) => x.user_id !== uid); return json([]); }
    }
    if (p === "/rest/v1/profiles") {
      const row = { id: UID, first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co", prefs: {} };
      if (m === "GET") return json((req.headers()["accept"] || "").includes("pgrst.object") ? row : [row]);
      return json([row], 201);
    }
    if (p.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

async function openTeam(page, phone) {
  await page.goto("/?app");
  const acct = page.getByRole("button", { name: /^Account: Mike/ });
  await expect(acct).toBeVisible({ timeout: 30_000 });
  await acct.click();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("[data-team-panel]")).toBeVisible({ timeout: 20_000 });
  await expect(dlg.locator('[data-team-section="admins"]')).toBeVisible();
  await page.waitForTimeout(350);
  return dlg;
}


/* A menu is REALLY open only if it has a real position and is opaque — Playwright's toBeVisible()
 * passes for left:-9999px / opacity:0 (the B2038784 amendment: row ⋯ menus were "visible" to the
 * old assertions while unreachable on the live site). */
async function expectMenuReallyOpen(page, loc) {
  await expect(loc).toBeVisible();
  const st = await loc.evaluate((el) => {
    const m = el.closest(".menu") || el; const cs = getComputedStyle(m); const r = m.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, opacity: parseFloat(cs.opacity), pe: cs.pointerEvents, vw: innerWidth, vh: innerHeight };
  });
  expect(st.opacity).toBe(1);
  expect(st.pe).not.toBe("none");
  expect(st.left).toBeGreaterThanOrEqual(0);
  expect(st.top).toBeGreaterThanOrEqual(0);
  expect(st.right).toBeLessThanOrEqual(st.vw);
  expect(st.bottom).toBeLessThanOrEqual(st.vh);
  // and it can actually be hit: the centre of its first item answers to the menu, not to something else
  const hit = await loc.first().evaluate((el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!h && el.contains(h); });
  expect(hit).toBe(true);
}

const box = async (loc) => (await loc.boundingBox());

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("grouped by role, aligned, no paragraphs; menu actions + resend work", async ({ page }) => {
    test.setTimeout(120_000);
    const st = freshState();
    await mock(page, st);
    const dlg = await openTeam(page, true);

    // Header: team name is the page title, centred in the dialog; × close.
    const title = dlg.locator("[data-settings-title]");
    await expect(title).toHaveText("HIP Houston");
    const dB = await box(dlg), tB = await box(title);
    expect(Math.abs((tB.x + tB.width / 2) - (dB.x + dB.width / 2))).toBeLessThan(2);
    await expect(dlg.locator("[data-settings-close]")).toBeVisible();

    // Three equal tiles, content centred.
    const tiles = dlg.locator("[data-team-tiles] > *");
    await expect(tiles).toHaveCount(3);
    const tb = [await box(tiles.nth(0)), await box(tiles.nth(1)), await box(tiles.nth(2))];
    expect(new Set(tb.map((b) => Math.round(b.height))).size).toBe(1);
    expect(new Set(tb.map((b) => Math.round(b.width))).size).toBe(1);
    await expect(tiles.nth(0)).toContainText("3");
    await expect(tiles.nth(0)).toContainText("Members");
    await expect(tiles.nth(2)).toContainText("Invite");
    for (let i = 0; i < 3; i++) {
      const kids = tiles.nth(i).locator("span");
      const n = await kids.count();
      const tbx = tb[i];
      let top = Infinity, bot = -Infinity;
      for (let k = 0; k < n; k++) {
        const b = await box(kids.nth(k));
        expect(Math.abs((b.x + b.width / 2) - (tbx.x + tbx.width / 2))).toBeLessThan(2);
        top = Math.min(top, b.y); bot = Math.max(bot, b.y + b.height);
      }
      expect(Math.abs(((top + bot) / 2) - (tbx.y + tbx.height / 2))).toBeLessThan(4);
    }

    // Sections in order, with labels on the avatar column.
    await expect(dlg.locator("[data-team-section]")).toHaveCount(4);
    const ids = await dlg.locator("[data-team-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team-section")));
    expect(ids).toEqual(["admins", "members", "invited", "sharing"]);
    const lbl = await box(dlg.locator('[data-team-section="admins"] > div').first());
    const firstAvatar = await box(dlg.locator('[data-team-section="admins"] [data-team-row] > span').first());
    expect(Math.abs(lbl.x - firstAvatar.x)).toBeLessThan(2);
    const labelEl = dlg.locator('[data-team-section="admins"] > div').first();
    // label's text starts at the avatar's left edge (box x includes its margin-left)
    const textX = await labelEl.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().x; });
    expect(Math.abs(textX - firstAvatar.x)).toBeLessThan(2);

    // Equal vertical rhythm between sections.
    const sB = [];
    for (const id of ids) sB.push(await box(dlg.locator(`[data-team-section="${id}"]`)));
    const gaps = sB.slice(1).map((b, i) => Math.round(b.y - (sB[i].y + sB[i].height)));
    expect(new Set(gaps).size).toBe(1);

    // Rows: "· You" without ⋯; email always shown; invited row copy.
    const me = dlg.locator('[data-team-row="member"]').filter({ hasText: "· You" });
    await expect(me).toHaveCount(1);
    await expect(me.locator("[data-team-more]")).toHaveCount(0);
    await expect(me).toContainText("mike@planyr.test");
    const inv = dlg.locator('[data-team-row="invite"]');
    await expect(inv).toContainText("throwaway@planyr.test");
    await expect(inv).toContainText("Member · not joined yet");

    // Switch right edge lines up with the ⋯ buttons' right edge.
    const sw = await box(dlg.locator("[data-team-autoshare]"));
    const mores = dlg.locator("[data-team-more]");
    const mb = await box(mores.first());
    expect(Math.abs((sw.x + sw.width) - (mb.x + mb.width))).toBeLessThan(6);
    expect(mb.height).toBeGreaterThanOrEqual(44);

    // No paragraph text on the page.
    const text = await dlg.innerText();
    expect(text).not.toMatch(/shared workspace|Applies only to projects/);
    await expect(dlg.locator("p")).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: "ui-audit/screens/team-settings-phone.png" });

    // Info icon carries the old explanation.
    await dlg.locator("[data-team-info]").click();
    await expect(page.getByText(/Applies only to projects you create from now on/)).toBeVisible();
    await page.keyboard.press("Escape");

    // ⋯ → bottom sheet: change role moves Ana between sections.
    await mores.nth(1).click(); // Michael Butler (admin #2)... open Ana's instead
    await page.keyboard.press("Escape");
    const anaRow = dlg.locator('[data-team-row="member"]').filter({ hasText: "Ana Ruiz" });
    await anaRow.locator("[data-team-more]").click();
    const sheet = page.locator("[data-team-sheet]");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("ana@planyr.test");
    await expectMenuReallyOpen(page, sheet.locator('[data-team-menu-item="Admin"]'));
    if (SHOTS) await page.screenshot({ path: "ui-audit/screens/team-settings-phone-sheet.png" });
    await sheet.locator('[data-team-menu-item="Admin"]').click();
    await expect(dlg.locator('[data-team-section="admins"] [data-team-row]')).toHaveCount(3);
    await expect(dlg.locator('[data-team-section="members"]')).toHaveCount(0); // empty section hidden

    // Resend: send path called once, no extra invite row, confirmation shown.
    const before = st.inviteWrites;
    await inv.locator("[data-team-more]").click();
    await page.locator('[data-team-sheet] [data-team-menu-item="Resend invite"]').click();
    await expect(dlg.getByText("Invite email sent again")).toBeVisible();
    expect(st.sends).toBe(1);               // one send…
    expect(st.inviteWrites - before).toBe(0); // …and no row written
    expect(st.invites).toHaveLength(1);
    await expect(dlg.locator('[data-team-row="invite"]')).toHaveCount(1);

    // Cancel invite → INVITED section disappears; Remove from team works.
    await inv.locator("[data-team-more]").click();
    await page.locator('[data-team-sheet] [data-team-menu-item="Cancel invite"]').click();
    await expect(dlg.locator('[data-team-section="invited"]')).toHaveCount(0);
    await dlg.locator('[data-team-row="member"]').filter({ hasText: "Ana Ruiz" }).locator("[data-team-more]").click();
    await page.locator('[data-team-sheet] [data-team-menu-item="Remove from team"]').click();
    await expect(dlg.getByText("Ana Ruiz")).toHaveCount(0);
    expect(st.members.some((x) => x.user_id === "u-3")).toBe(false);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("pane header, row anatomy, dropdown menu, inline Resend link", async ({ page }) => {
    test.setTimeout(90_000);
    const st = freshState();
    await mock(page, st);
    const dlg = await openTeam(page, false);
    await expect(dlg.locator("nav.settings-nav")).toBeVisible();
    const head = dlg.locator("[data-team-header]");
    await expect(head).toContainText("HIP Houston");
    await expect(head).toContainText("3 members · 0 shared projects");
    await expect(head.locator("[data-team-invite]")).toHaveText("+ Invite");
    await expect(dlg.locator("[data-team-tiles]")).toHaveCount(0);
    // Pane header's left edge lines up with the card edges.
    const hb = await box(head.locator("div").first()), cb = await box(dlg.locator('[data-team-section="admins"] > div').nth(1));
    expect(Math.abs(hb.x - cb.x)).toBeLessThan(2);
    // Invited row has the inline Resend link; ⋯ opens a dropdown (no sheet).
    const inv = dlg.locator('[data-team-row="invite"]');
    await expect(inv.locator("[data-team-resend]")).toHaveText("Resend invite");
    if (SHOTS) await page.screenshot({ path: "ui-audit/screens/team-settings-desktop.png" });
    await dlg.locator('[data-team-row="member"]').filter({ hasText: "Ana Ruiz" }).locator("[data-team-more]").click();
    await expectMenuReallyOpen(page, page.locator('[data-team-dropdown] [data-team-menu-item="Admin"]'));
    await expect(page.locator("[data-team-sheet]")).toHaveCount(0);
    await expect(page.locator('[data-team-dropdown] [data-team-menu-item="Member"]')).toContainText("✓");
    if (SHOTS) await page.screenshot({ path: "ui-audit/screens/team-settings-desktop-menu.png" });
    await page.keyboard.press("Escape");
    // Inline Resend: one send, no new row.
    await inv.locator("[data-team-resend]").click();
    await expect(dlg.getByText("Invite email sent again")).toBeVisible();
    expect(st.sends).toBe(1);
    expect(st.inviteWrites).toBe(0);
    await expect(inv.locator("[data-team-resend]")).toBeDisabled(); // cooldown after a send
    expect(st.invites).toHaveLength(1);
    // Switch toggles.
    const sw = dlg.locator("[data-team-autoshare]");
    const was = await sw.getAttribute("aria-checked");
    await sw.click();
    await expect(sw).not.toHaveAttribute("aria-checked", was);
  });
});

test.describe("desktop, short window (520 tall)", () => {
  test.use({ viewport: { width: 1280, height: 520 } });

  test("row menus are really open, header ⋯ inside the pane, invite email not cut", async ({ page }) => {
    test.setTimeout(90_000);
    const st = freshState();
    st.invites = [{ id: "inv-1", email: "ryan.baumgartner.throwaway@hillwood.com", role: "member", created_at: "2026-10-01T00:00:00Z", claimed_at: null }];
    await mock(page, st);
    const dlg = await openTeam(page, false);
    // Header ⋯ lines up with the row ⋯ buttons below it, and sits fully inside the pane.
    const hb = await box(dlg.locator("[data-team-menu]"));
    const rb0 = await box(dlg.locator('[data-team-row="member"] [data-team-more]').first());
    expect(Math.abs((hb.x + hb.width) - (rb0.x + rb0.width))).toBeLessThan(1.5);
    const cardBox = await box(dlg.locator('[data-team-section="admins"] > div').nth(1));
    expect(hb.x + hb.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    // Invite row: the whole email shows, and Resend sits on the second line after the status.
    const inv = dlg.locator('[data-team-row="invite"]');
    const nameEl = inv.locator("[data-team-invite-email]");
    await expect(nameEl).toHaveText("ryan.baumgartner.throwaway@hillwood.com"); // whole address in the DOM, nothing elided
    expect(await nameEl.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(false); // no horizontal clipping
    expect(await nameEl.evaluate((e) => getComputedStyle(e).textOverflow)).not.toBe("ellipsis");
    const second = inv.locator("[data-team-resend]");
    await expect(second).toHaveText("Resend invite");
    const nb = await box(nameEl), rb = await box(second);
    expect(rb.y).toBeGreaterThan(nb.y + nb.height - 2); // Resend below the email
    // the status text is complete too (not cut)
    const status = inv.getByText("Member · not joined yet");
    expect(await status.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    if (SHOTS) await page.screenshot({ path: "ui-audit/screens/team-settings-fix-desktop-short.png" });
    // Every row ⋯ — member, admin, invite — opens a REAL, reachable menu.
    for (const row of [dlg.locator('[data-team-row="member"]').filter({ hasText: "Ana Ruiz" }), dlg.locator('[data-team-row="member"]').filter({ hasText: "mb.one@planyr.test" }), inv]) {
      await row.locator("[data-team-more]").click();
      await expectMenuReallyOpen(page, page.locator("[data-team-dropdown] [data-team-menu-item]").first());
      if (SHOTS && (await row.getAttribute("data-team-row")) === "invite") await page.screenshot({ path: "ui-audit/screens/team-settings-fix-desktop-short-menu.png" });
      await page.keyboard.press("Escape");
    }
    // …and the role change reachable through it works end to end.
    await dlg.locator('[data-team-row="member"]').filter({ hasText: "Ana Ruiz" }).locator("[data-team-more]").click();
    await page.locator('[data-team-dropdown] [data-team-menu-item="Admin"]').click();
    await expect(dlg.locator('[data-team-section="members"]')).toHaveCount(0);
  });
});

test.describe("phone, long invite email", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test("the invite email wraps instead of truncating", async ({ page }) => {
    test.setTimeout(90_000);
    const st = freshState();
    st.invites = [{ id: "inv-1", email: "ryan.baumgartner.throwaway@hillwood.com", role: "member", created_at: "2026-10-01T00:00:00Z", claimed_at: null }];
    await mock(page, st);
    const dlg = await openTeam(page, true);
    const nameEl = dlg.locator("[data-team-invite-email]");
    await expect(nameEl).toHaveText("ryan.baumgartner.throwaway@hillwood.com");
    expect(await nameEl.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(false);
    const row = await box(dlg.locator('[data-team-row="invite"]'));
    const eb = await box(nameEl);
    expect(eb.x + eb.width).toBeLessThanOrEqual(row.x + row.width);
    await nameEl.scrollIntoViewIfNeeded();
    if (SHOTS) await page.screenshot({ path: "ui-audit/screens/team-settings-fix2-phone-invite.png" });
  });
});
