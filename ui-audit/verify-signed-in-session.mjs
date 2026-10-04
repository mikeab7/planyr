/* Proves a session can sign in as the test account. `node ui-audit/verify-signed-in-session.mjs [base]` */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
const base = process.argv[2] || "https://planyr.io";
let s;
try {
  s = await openSignedIn({ base });
  console.log("signed in ✓  build:", JSON.stringify(s.build), " visibility:", await s.page.evaluate(() => document.visibilityState));
  await s.page.waitForTimeout(4000);
  const hasFixture = await s.page.getByText(/e2e.?fixture/i).count();
  console.log("fixture text hits:", hasFixture, "site id:", FIXTURE_SITE_ID);
  console.log("page errors:", s.errors.length);
  await s.page.screenshot({ path: process.env.SHOT || "/tmp/signed-in.png" });
  await s.close();
} catch (e) { console.error("FAIL:", e.message.split("\n")[0]); if (s) await s.close(); process.exit(1); }
