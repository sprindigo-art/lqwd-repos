// PULL ONLY — never push/migrate against the externally-managed warehouse. (D-02)
// This config exists solely to bootstrap types via `drizzle-kit pull` (read-only
// metadata). `drizzle-kit push`/`generate`/`migrate` is NEVER run against ldk-lspd-main.
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/lib/db/schema/ldk.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.LDK_LSPD_DATABASE_URL!,
  },
});
