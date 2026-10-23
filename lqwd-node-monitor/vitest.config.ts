import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Plain node/ESM environment — Phase 1 has no component rendering, so we do NOT use
// the Next.js Vitest plugin or @vitejs/plugin-react (RESEARCH §H). Pure-function tests
// (AFM-002 formatter, AFM-001 helper shape) run with no Next runtime.
//
// ── DB-REQUIRED TEST TAGGING CONVENTION (HARDEN-01 / 18-01) ─────────────────────
// Any suite that needs a live nodemon Postgres MUST call
// `requireNodemonDb("<file>.test.ts")` from `@/lib/queue/test-helpers` ONCE at
// module top, gate its describes with `describe.skipIf(!DB_AVAILABLE)` and
// early-return its top-level hooks. Semantics:
//   - CI + no NODEMON_QUEUE_URL → the guard THROWS (red run, never a silent no-op).
//   - Local DB-less run → visible-warning skip; pure suites keep running.
// The CI fail-on-skip gate (.github/workflows/ci.yml) grep-discovers files calling
// `requireNodemonDb(` and fails the job if any of their tests report a
// skipped/todo/pending/disabled status. New DB-integration tests in downstream
// plans enroll automatically by routing through the guard.
export default defineConfig({
  // Resolve the same `@/*` → `./src/*` alias as tsconfig so tests import via `@/lib/...`
  // (matches the workspace convention: always use `@/`, never relative paths).
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws when imported outside an RSC context; alias it to a
      // no-op stub so server-only DB/env modules can be unit-tested under node.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Phase 10 (DS-01) adds `.test.tsx` discovery for downstream primitive render
    // tests. These use `renderToStaticMarkup` from `react-dom/server` (DEP-FREE
    // path — no jsdom, no @testing-library/react), which runs fine under node, so
    // the env stays `node`.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
