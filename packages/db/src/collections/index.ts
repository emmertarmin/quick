import { randomUUID } from "node:crypto";
import type { JsonBlob, QuickDocument } from "@quick/shared";
import { db } from "../client";
import { JsonDocuments, type JsonDocumentRow } from "./collections.sql";

function parseRow(row: JsonDocumentRow) {
  return {
    ...(JSON.parse(row.data) as JsonBlob),
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  } satisfies QuickDocument;
}

function stringifyBlob(data: JsonBlob) {
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...documentData } = data;
  return JSON.stringify(documentData);
}

function now() {
  return new Date().toISOString();
}

export const collections = {
  list(site: string, collection: string) {
    return JsonDocuments.list(db, site, collection).map(parseRow);
  },

  get(site: string, collection: string, id: string) {
    const row = JsonDocuments.getById(db, site, collection, id);
    return row ? parseRow(row) : undefined;
  },

  create(site: string, collection: string, data: JsonBlob) {
    const id = typeof data.id === "string" ? data.id : randomUUID();
    const timestamp = now();
    const row = JsonDocuments.insert(db, site, collection, id, stringifyBlob(data), timestamp, timestamp);
    return row ? parseRow(row) : undefined;
  },

  replace(site: string, collection: string, id: string, data: JsonBlob) {
    const row = JsonDocuments.replace(db, site, collection, id, stringifyBlob(data), now());
    return row ? parseRow(row) : undefined;
  },

  update(site: string, collection: string, id: string, data: JsonBlob) {
    const existing = this.get(site, collection, id);

    if (!existing) {
      return undefined;
    }

    return this.replace(site, collection, id, { ...existing, ...data });
  },

  delete(site: string, collection: string, id: string) {
    const row = JsonDocuments.remove(db, site, collection, id);
    return row ? parseRow(row) : undefined;
  },
};
