// PULL ONLY — never push/migrate against the externally-managed warehouse. (D-02)
// This config exists solely to bootstrap types via `drizzle-kit pull` (read-only
// metadata). `drizzle-kit push`/`generate`/`migrate` is NEVER run against routing_vm.
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/lib/db/schema/routing.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.ROUTING_VM_DATABASE_URL!,
  },
});
