import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Planning artifacts are not application source. .planning/ holds design
    // prototypes and saved HTML page snapshots (phase-10's .prototype-snapshot
    // is a vendored browser dump, not code we author or ship).
    ".planning/**",
    // Stale agent worktrees are full copies of the repo — linting them reports
    // every finding N+1 times.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
