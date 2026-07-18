import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://routino:routino@localhost:5432/routino",
  },
  // Fail loudly rather than silently dropping a column.
  strict: true,
  verbose: true,
});
