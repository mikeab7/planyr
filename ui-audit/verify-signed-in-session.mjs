/* Proves the shared signed-in helper end to end against a real deploy:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-signed-in-session.mjs [https://planyr.io]
 * Prints the served build (/version.json) and the signed-in proof. Exits non-zero with the exact error. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
try {
  const s = await openSignedIn({ base });
  await assertMeasurable(s.page, "verify-signed-in-session");
  console.log("PASS signed in as", s.proof.email, "| fixture e2e-fixture-site visible:", s.proof.fixtureVisible);
  console.log("build:", JSON.stringify(s.build));
  await s.close();
} catch (e) { console.error("FAIL", e.message); process.exit(1); }
