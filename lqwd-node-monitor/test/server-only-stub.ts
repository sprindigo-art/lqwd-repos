// Vitest stub for the `server-only` package. The real module throws when imported
// outside a React Server Component context; under Vitest's plain-node environment
// our DB/env modules are unit-tested directly, so we alias `server-only` to this
// no-op. The build-time client-bundle guard still applies to the real Next.js build.
export {};
