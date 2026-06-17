import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/**/*.sql.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./db.sqlite",
  },
  verbose: true,
  strict: true,
});
