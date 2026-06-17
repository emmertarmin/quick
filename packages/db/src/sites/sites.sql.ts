import { asc, eq } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { fn } from "../fn";

export const sitesTable = sqliteTable("sites", {
  name: text("name").primaryKey().notNull(),
  lastDeployedAt: text("last_deployed_at").notNull(),
  lastDeployedById: text("last_deployed_by_id").notNull(),
  lastDeployedByEmail: text("last_deployed_by_email"),
  lastDeployedByName: text("last_deployed_by_name"),
  fileCount: integer("file_count").notNull(),
});

export type SiteRow = typeof sitesTable.$inferSelect;
export type UpsertSiteInput = typeof sitesTable.$inferInsert;

export namespace Sites {
  export const all = fn((database): SiteRow[] => {
    return database.query.sitesTable
      .findMany({
        orderBy: () => asc(sitesTable.name),
      })
      .sync();
  });

  export const getByName = fn((database, name: string): SiteRow | undefined => {
    return database.query.sitesTable
      .findFirst({
        where: () => eq(sitesTable.name, name),
      })
      .sync();
  });

  export const upsert = fn((database, input: UpsertSiteInput): SiteRow => {
    return database
      .insert(sitesTable)
      .values(input)
      .onConflictDoUpdate({
        target: sitesTable.name,
        set: {
          lastDeployedAt: input.lastDeployedAt,
          lastDeployedById: input.lastDeployedById,
          lastDeployedByEmail: input.lastDeployedByEmail,
          lastDeployedByName: input.lastDeployedByName,
          fileCount: input.fileCount,
        },
      })
      .returning()
      .get();
  });
}
