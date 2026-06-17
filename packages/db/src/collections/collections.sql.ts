import { and, eq } from "drizzle-orm";
import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { fn } from "../fn";

export const jsonDocumentsTable = sqliteTable(
  "json_documents",
  {
    id: text("id").notNull(),
    site: text("site").notNull(),
    collection: text("collection").notNull(),
    data: text("data").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.site, table.collection, table.id] }),
    index("json_documents_site_collection_idx").on(table.site, table.collection),
  ],
);

export type JsonDocumentRow = typeof jsonDocumentsTable.$inferSelect;

function scope(site: string, collection: string) {
  return and(eq(jsonDocumentsTable.site, site), eq(jsonDocumentsTable.collection, collection));
}

function documentScope(site: string, collection: string, id: string) {
  return and(scope(site, collection), eq(jsonDocumentsTable.id, id));
}

export namespace JsonDocuments {
  export const list = fn((database, site: string, collection: string): JsonDocumentRow[] => {
    return database.query.jsonDocumentsTable
      .findMany({
        where: () => scope(site, collection),
      })
      .sync();
  });

  export const getById = fn((database, site: string, collection: string, id: string): JsonDocumentRow | undefined => {
    return database.query.jsonDocumentsTable
      .findFirst({
        where: () => documentScope(site, collection, id),
      })
      .sync();
  });

  export const insert = fn(
    (
      database,
      site: string,
      collection: string,
      id: string,
      data: string,
      createdAt: string,
      updatedAt: string,
    ): JsonDocumentRow | undefined => {
      return database
        .insert(jsonDocumentsTable)
        .values({ id, site, collection, data, createdAt, updatedAt })
        .onConflictDoNothing({
          target: [jsonDocumentsTable.site, jsonDocumentsTable.collection, jsonDocumentsTable.id],
        })
        .returning()
        .get();
    },
  );

  export const replace = fn(
    (database, site: string, collection: string, id: string, data: string, updatedAt: string): JsonDocumentRow | undefined => {
      return database
        .update(jsonDocumentsTable)
        .set({ data, updatedAt })
        .where(documentScope(site, collection, id))
        .returning()
        .get();
    },
  );

  export const remove = fn((database, site: string, collection: string, id: string): JsonDocumentRow | undefined => {
    return database.delete(jsonDocumentsTable).where(documentScope(site, collection, id)).returning().get();
  });
}
