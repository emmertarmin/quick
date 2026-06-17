import { eq, like } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { fn } from "../fn";

export const openAuthKvTable = sqliteTable(
  "openauth_kv",
  {
    key: text("key").notNull().primaryKey(),
    value: text("value").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("openauth_kv_expires_at_idx").on(table.expiresAt)],
);

export type OpenAuthKvRow = typeof openAuthKvTable.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function isExpired(row: Pick<OpenAuthKvRow, "expiresAt">) {
  return row.expiresAt !== null && Date.parse(row.expiresAt) <= Date.now();
}

export namespace OpenAuthKv {
  export const get = fn((database, key: string): OpenAuthKvRow | undefined => {
    const row = database.query.openAuthKvTable
      .findFirst({
        where: () => eq(openAuthKvTable.key, key),
      })
      .sync();

    if (!row) {
      return undefined;
    }

    if (isExpired(row)) {
      database.delete(openAuthKvTable).where(eq(openAuthKvTable.key, key)).run();
      return undefined;
    }

    return row;
  });

  export const set = fn((database, key: string, value: string, expiresAt?: string): void => {
    const timestamp = nowIso();

    database
      .insert(openAuthKvTable)
      .values({ key, value, expiresAt, createdAt: timestamp, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: openAuthKvTable.key,
        set: { value, expiresAt, updatedAt: timestamp },
      })
      .run();
  });

  export const remove = fn((database, key: string): void => {
    database.delete(openAuthKvTable).where(eq(openAuthKvTable.key, key)).run();
  });

  export const scan = fn((database, prefix: string): OpenAuthKvRow[] => {
    const rows = database.query.openAuthKvTable
      .findMany({
        where: () => like(openAuthKvTable.key, `${prefix}%`),
      })
      .sync();

    const expired = rows.filter(isExpired);

    for (const row of expired) {
      database.delete(openAuthKvTable).where(eq(openAuthKvTable.key, row.key)).run();
    }

    return rows.filter((row) => !isExpired(row));
  });
}
