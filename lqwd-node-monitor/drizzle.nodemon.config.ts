// The ONLY drizzle-kit config that may run generate/migrate (D-08). nodemon is
// the only Drizzle-owned DB. Queue tables (commands/executions/audit) land in
// Phase 6 (D-07) — the schema is intentionally empty in Phase 1.
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  out: "./drizzle/nodemon",
  schema: "./src/lib/db/schema/nodemon.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.NODEMON_QUEUE_URL!,
  },
});
