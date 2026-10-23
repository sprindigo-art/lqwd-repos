// Next.js boot hook — runs once at server startup (RESEARCH §C). Throwing here
// aborts the server start, which is the fail-loud mechanism the success criteria
// require. Gated on the Node.js runtime so it never runs on the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupHealthCheck } = await import("@/lib/db/health");
    await runStartupHealthCheck(); // throws → server fails to start (fail loud)
  }
}
