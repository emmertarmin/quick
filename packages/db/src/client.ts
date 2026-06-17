import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultDatabasePath = join(packageRoot, "db.sqlite");
const databasePath = process.env.DATABASE_URL ?? defaultDatabasePath;

export const sqlite = new Database(databasePath, { create: true });

sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: join(packageRoot, "drizzle") });

export type AppDb = typeof db;
