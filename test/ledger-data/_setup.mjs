// Make sure the real ledger (the `ledger` branch) is checked out under .ledger/ and current before the data tests read it.
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { ensureLedger } from "../../scripts/lib/ledgerBranch.mjs";

export default function setup() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  ensureLedger(repo, { fresh: true });
}
