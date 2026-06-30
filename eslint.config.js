import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

/* Intentionally minimal lint gate. The point is to catch the class of bug that a
 * build-only CI check can't see — a dangling/undefined identifier (e.g. the cfgOf
 * scope bug that shipped a blank page) — and fail the build before it ships, NOT to
 * impose a full style ruleset on a codebase that has never been linted. So we enable
 * the recommended *correctness* rules' essentials and leave stylistic rules off.
 */
export default [
  { ignores: ["dist/**", "node_modules/**", "ui-audit/.cache-vendor/**"] },  // vendored 3rd-party libs the scheduler boot-check downloads (gitignored; minified, not ours to lint)
  {
    files: ["**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      // The headline guard: a reference that resolves to no declaration in scope
      // fails the build (this is what would have caught `cfgOf` in renderElPx).
      "no-undef": "error",
      // A few more genuine-bug rules that are cheap and never stylistic.
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-dupe-class-members": "error",
      "no-const-assign": "error",
      "no-func-assign": "error",
      "no-obj-calls": "error",
      "use-isnan": "error",
      // React hooks: the codebase already carries `eslint-disable` directives for
      // exhaustive-deps, so register the plugin (otherwise those directives error on
      // an unknown rule). Kept as warnings — visible, non-blocking; only no-undef &
      // the correctness rules above fail the build.
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Tooling / test files run in Node and use Node globals.
  {
    files: ["test/**/*.js", "**/*.config.js", "server/**/*.js", "e2e/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
