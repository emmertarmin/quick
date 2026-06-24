import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { collections, sites } from "@quick/db";
import type { JsonBlob, QuickDocument, QuickUser } from "@quick/shared";
import type { Context } from "hono";
import { Type, type Static, type TSchema } from "typebox";
import { quickDomain, quickScheme, sitesRoot } from "./config";

export type QuickAiToolSummary = {
  name: string;
  description: string;
  label: string;
  parameters: Record<string, unknown>;
};

type QuickAiToolContext = {
  c: Context;
  user: QuickUser;
};

type QuickFileDocument = QuickDocument & {
  content_type: string;
  name: string;
  size: number;
  url: string;
};

const filesCollection = "_quick_files";
const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type QuickAiToolFactory<TParameters extends TSchema = TSchema, TDetails = unknown> = {
  name: string;
  description: string;
  label: string;
  parameters: TParameters;
  execute(ctx: QuickAiToolContext, params: Static<TParameters>): Promise<TDetails> | TDetails;
};

function textResult<TDetails>(details: TDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function createTool<TParameters extends TSchema, TDetails>(factory: QuickAiToolFactory<TParameters, TDetails>, ctx: QuickAiToolContext): AgentTool<TParameters, TDetails> {
  return {
    name: factory.name,
    description: factory.description,
    label: factory.label,
    parameters: factory.parameters,
    async execute(_toolCallId, params) {
      return textResult(await factory.execute(ctx, params));
    },
  };
}

function requestOrigin(c: Context) {
  const url = new URL(c.req.url);
  const proto = c.req.header("X-Forwarded-Proto") ?? url.protocol.replace(/:$/, "") ?? "https";
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? url.host;
  return `${proto}://${host}`;
}

function currentSite(c: Context) {
  const site = c.req.header("X-Quick-Site")?.trim();
  return site || undefined;
}

function requireCurrentSite(c: Context) {
  const site = currentSite(c);

  if (!site || !siteNamePattern.test(site)) {
    throw new Error("Missing or invalid trusted X-Quick-Site header");
  }

  return site;
}

function isJsonObject(value: unknown): value is JsonBlob {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireJsonObject(value: unknown, label: string) {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return value;
}

function pageParams(page?: number, pageSize?: number, defaults = { page: 1, pageSize: 20, maxPageSize: 100 }) {
  const normalizedPage = Math.max(1, Math.floor(page ?? defaults.page));
  const normalizedPageSize = Math.min(defaults.maxPageSize, Math.max(1, Math.floor(pageSize ?? defaults.pageSize)));
  const offset = (normalizedPage - 1) * normalizedPageSize;

  return { page: normalizedPage, pageSize: normalizedPageSize, offset };
}

function paged<T>(items: T[], page?: number, pageSize?: number) {
  const paging = pageParams(page, pageSize);
  const pageItems = items.slice(paging.offset, paging.offset + paging.pageSize);

  return {
    ...paging,
    total: items.length,
    returned: pageItems.length,
    hasMore: paging.offset + pageItems.length < items.length,
    items: pageItems,
  };
}

function asQuickFileDocument(document: JsonBlob | undefined) {
  if (!document) {
    return undefined;
  }

  if (
    typeof document.id !== "string" ||
    typeof document.name !== "string" ||
    typeof document.content_type !== "string" ||
    typeof document.size !== "number" ||
    typeof document.url !== "string"
  ) {
    return undefined;
  }

  return document as QuickFileDocument;
}

function siteUrl(site: string) {
  return `${quickScheme}://${site}.${quickDomain}`;
}

async function hasSiteIndex(site: string) {
  const index = await stat(join(sitesRoot, site, "index.html")).catch(() => undefined);
  return Boolean(index?.isFile());
}

async function currentSiteMetadata(site: string) {
  const metadata = sites.get(site);
  const hasIndex = await hasSiteIndex(site);

  if (!metadata && !hasIndex) {
    return { site, exists: false as const, url: siteUrl(site), hasIndex: false };
  }

  return { ...metadata, site, exists: true as const, url: siteUrl(site), hasIndex };
}

async function deployedSiteNames() {
  const entries = await readdir(sitesRoot, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && siteNamePattern.test(entry.name) && await hasSiteIndex(entry.name)) {
      names.push(entry.name);
    }
  }

  return names;
}

async function listSiteMetadata() {
  const metadataBySite = new Map(sites.all().map((metadata) => [metadata.site, metadata]));
  const names = new Set([...metadataBySite.keys(), ...await deployedSiteNames()]);

  return Promise.all(
    [...names].sort((a, b) => a.localeCompare(b)).map(async (site) => {
      const metadata = metadataBySite.get(site);

      return { ...metadata, site, exists: true as const, url: siteUrl(site), hasIndex: await hasSiteIndex(site) };
    }),
  );
}

function searchableText(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

function objectEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.entries(value as Record<string, unknown>);
}

function pathValues(value: unknown, path: string): unknown[] {
  const parts = path.split(".").filter(Boolean);
  let values = [value];

  for (const part of parts) {
    values = values.flatMap((current) => {
      if (Array.isArray(current)) {
        return current.flatMap((item) => pathValues(item, part));
      }

      if (current && typeof current === "object" && part in current) {
        return [(current as Record<string, unknown>)[part]];
      }

      return [];
    });
  }

  return values;
}

function deepEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) {
    return true;
  }

  if (left && right && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return false;
}

function valueEquals(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => valueEquals(item, expected));
  }

  return deepEqual(value, expected);
}

function comparable(value: unknown) {
  return typeof value === "number" || typeof value === "string" || value instanceof Date ? value : undefined;
}

function regexFromFilter(pattern: unknown, options: unknown) {
  if (typeof pattern !== "string") {
    throw new Error("$regex must be a string");
  }

  if (pattern.length > 256) {
    throw new Error("$regex patterns are capped at 256 characters");
  }

  if (options !== undefined && (typeof options !== "string" || /[^imsu]/.test(options))) {
    throw new Error("$options may only contain i, m, s, or u");
  }

  return new RegExp(pattern, options);
}

function matchesOperator(values: unknown[], operator: string, operand: unknown, condition: Record<string, unknown>) {
  switch (operator) {
    case "$eq": return values.some((value) => valueEquals(value, operand));
    case "$ne": return !values.some((value) => valueEquals(value, operand));
    case "$gt": return values.some((value) => comparable(value) !== undefined && comparable(operand) !== undefined && comparable(value)! > comparable(operand)!);
    case "$gte": return values.some((value) => comparable(value) !== undefined && comparable(operand) !== undefined && comparable(value)! >= comparable(operand)!);
    case "$lt": return values.some((value) => comparable(value) !== undefined && comparable(operand) !== undefined && comparable(value)! < comparable(operand)!);
    case "$lte": return values.some((value) => comparable(value) !== undefined && comparable(operand) !== undefined && comparable(value)! <= comparable(operand)!);
    case "$in": {
      if (!Array.isArray(operand)) throw new Error("$in must be an array");
      return values.some((value) => operand.some((expected) => valueEquals(value, expected)));
    }
    case "$nin": {
      if (!Array.isArray(operand)) throw new Error("$nin must be an array");
      return !values.some((value) => operand.some((expected) => valueEquals(value, expected)));
    }
    case "$exists": return operand ? values.length > 0 : values.length === 0;
    case "$regex": {
      const regex = regexFromFilter(operand, condition.$options);
      return values.some((value) => typeof value === "string" && regex.test(value));
    }
    case "$options": return true;
    default: throw new Error(`Unsupported filter operator: ${operator}`);
  }
}

function matchesFieldFilter(document: QuickDocument, path: string, condition: unknown) {
  const values = pathValues(document, path);
  const entries = objectEntries(condition);

  if (entries?.some(([key]) => key.startsWith("$"))) {
    return entries.every(([operator, operand]) => matchesOperator(values, operator, operand, condition as Record<string, unknown>));
  }

  return values.some((value) => valueEquals(value, condition));
}

function matchesMongoFilter(document: QuickDocument, filter: unknown): boolean {
  const entries = objectEntries(filter);

  if (!entries) {
    throw new Error("filter must be a JSON object");
  }

  return entries.every(([key, condition]) => {
    if (key === "$and") {
      if (!Array.isArray(condition)) throw new Error("$and must be an array of filter objects");
      return condition.every((item) => matchesMongoFilter(document, item));
    }

    if (key === "$or") {
      if (!Array.isArray(condition)) throw new Error("$or must be an array of filter objects");
      return condition.some((item) => matchesMongoFilter(document, item));
    }

    if (key.startsWith("$")) {
      throw new Error(`Unsupported top-level filter operator: ${key}`);
    }

    return matchesFieldFilter(document, key, condition);
  });
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date: Date) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export const defaultQuickAiToolNames = ["quick_datetime_get"] as const;

const quickNativeToolFactories: QuickAiToolFactory[] = [
  {
    name: "quick_datetime_get",
    label: "Current date and time",
    description: "Return the current server-local date and time formatted as YYYY-MM-DD hh:mm:ss.",
    parameters: Type.Object({}),
    execute: () => {
      const now = new Date();

      return {
        dateTime: formatLocalDateTime(now),
        format: "YYYY-MM-DD hh:mm:ss",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        iso: now.toISOString(),
      };
    },
  },
  {
    name: "quick_currentUser_get",
    label: "Current user",
    description: "Return the authenticated Quick user for this request.",
    parameters: Type.Object({}),
    execute: (ctx) => ({
      authenticated: true,
      user: ctx.user,
    }),
  },
  {
    name: "quick_appContext_get",
    label: "App context",
    description: "Return the current Quick app/site context for this request.",
    parameters: Type.Object({}),
    execute: (ctx) => {
      const origin = requestOrigin(ctx.c);
      const site = currentSite(ctx.c);

      return {
        site: site ?? null,
        origin,
        url: ctx.c.req.url,
        referer: ctx.c.req.header("Referer") ?? null,
        apiBase: "/api",
        features: ["auth", "identity", "ai", "db", "files", "realtime", "sites"],
      };
    },
  },
  {
    name: "quick_collection_all",
    label: "List collection documents",
    description: "Read documents from a Quick DB collection for the current app/site. Mirrors quick.db.collection(name).all() with an optional safety limit.",
    parameters: Type.Object({
      collection: Type.String({ description: "Collection name, e.g. 'todos' or 'messages'.", minLength: 1 }),
      limit: Type.Optional(Type.Integer({ description: "Maximum number of documents to return. Defaults to 50 and is capped at 200.", minimum: 1, maximum: 200 })),
    }),
    execute: (ctx, params) => {
      const input = params as { collection: string; limit?: number };
      const site = requireCurrentSite(ctx.c);
      const limit = Math.min(input.limit ?? 50, 200);
      const documents = collections.all(site, input.collection);

      return {
        site,
        collection: input.collection,
        count: documents.length,
        returned: Math.min(documents.length, limit),
        truncated: documents.length > limit,
        documents: documents.slice(0, limit),
      };
    },
  },
  {
    name: "quick_collection_get",
    label: "Get collection document",
    description: "Read a single document by id from a Quick DB collection for the current app/site. Mirrors quick.db.collection(name).get(id).",
    parameters: Type.Object({
      collection: Type.String({ description: "Collection name, e.g. 'todos' or 'messages'.", minLength: 1 }),
      id: Type.String({ description: "Document id.", minLength: 1 }),
    }),
    execute: (ctx, params) => {
      const input = params as { collection: string; id: string };
      const site = requireCurrentSite(ctx.c);
      const document = collections.get(site, input.collection, input.id);

      return {
        site,
        collection: input.collection,
        id: input.id,
        found: document !== undefined,
        document: document ?? null,
      };
    },
  },
  {
    name: "quick_collection_create",
    label: "Create collection document",
    description: "Create a document in a Quick DB collection for the current app/site. Mirrors quick.db.collection(name).create(document).",
    parameters: Type.Object({
      collection: Type.String({ description: "Collection name, e.g. 'todos' or 'messages'.", minLength: 1 }),
      document: Type.Record(Type.String(), Type.Unknown(), { description: "JSON object to store. Optional id is honored when provided." }),
    }),
    execute: (ctx, params) => {
      const input = params as { collection: string; document: unknown };
      const site = requireCurrentSite(ctx.c);
      const document = collections.create(site, input.collection, requireJsonObject(input.document, "document"));

      return {
        site,
        collection: input.collection,
        created: document !== undefined,
        document: document ?? null,
      };
    },
  },
  {
    name: "quick_collection_update",
    label: "Update collection document",
    description: "Merge fields into an existing Quick DB document for the current app/site. Mirrors quick.db.collection(name).update(id, document).",
    parameters: Type.Object({
      collection: Type.String({ description: "Collection name, e.g. 'todos' or 'messages'.", minLength: 1 }),
      id: Type.String({ description: "Document id.", minLength: 1 }),
      document: Type.Record(Type.String(), Type.Unknown(), { description: "Partial JSON object to merge into the existing document." }),
    }),
    execute: (ctx, params) => {
      const input = params as { collection: string; id: string; document: unknown };
      const site = requireCurrentSite(ctx.c);
      const document = collections.update(site, input.collection, input.id, requireJsonObject(input.document, "document"));

      return {
        site,
        collection: input.collection,
        id: input.id,
        updated: document !== undefined,
        document: document ?? null,
      };
    },
  },
  {
    name: "quick_collection_delete",
    label: "Delete collection document",
    description: "Delete a document by id from a Quick DB collection for the current app/site. Mirrors quick.db.collection(name).delete(id).",
    parameters: Type.Object({
      collection: Type.String({ description: "Collection name, e.g. 'todos' or 'messages'.", minLength: 1 }),
      id: Type.String({ description: "Document id.", minLength: 1 }),
    }),
    execute: (ctx, params) => {
      const input = params as { collection: string; id: string };
      const site = requireCurrentSite(ctx.c);
      const document = collections.delete(site, input.collection, input.id);

      return {
        site,
        collection: input.collection,
        id: input.id,
        deleted: document !== undefined,
        document: document ?? null,
      };
    },
  },
  {
    name: "quick_collection_search",
    label: "Search collection documents",
    description: "Search documents in a Quick DB collection for the current app/site. Supports optional broad text query plus a Mongo-inspired filter with dot paths and operators like $eq, $in, $exists, $regex, $and, and $or.",
    parameters: Type.Object({
      collection: Type.String({ description: "Collection name, e.g. 'todos' or 'messages'.", minLength: 1 }),
      query: Type.Optional(Type.String({ description: "Optional case-insensitive text to search for in full document JSON.", minLength: 1 })),
      filter: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Optional Mongo-inspired filter object. Examples: {\"basket.fruits\": \"melon\"}, {\"teaser_text\": {\"$regex\": \"Armin\", \"$options\": \"i\"}}, {\"$or\": [{\"status\": \"todo\"}, {\"done\": false}]}" })),
      page: Type.Optional(Type.Integer({ description: "1-based result page. Defaults to 1.", minimum: 1 })),
      pageSize: Type.Optional(Type.Integer({ description: "Results per page. Defaults to 20 and is capped at 100.", minimum: 1, maximum: 100 })),
    }),
    execute: (ctx, params) => {
      const input = params as { collection: string; query?: string; filter?: unknown; page?: number; pageSize?: number };
      const site = requireCurrentSite(ctx.c);

      if (!input.query && input.filter === undefined) {
        throw new Error("quick_collection_search requires query, filter, or both");
      }

      const query = input.query?.toLowerCase();
      const matches = collections.all(site, input.collection).filter((document) => {
        const textMatches = query ? searchableText(document).includes(query) : true;
        const filterMatches = input.filter === undefined ? true : matchesMongoFilter(document, input.filter);
        return textMatches && filterMatches;
      });
      const { items, ...results } = paged(matches, input.page, input.pageSize);

      return {
        site,
        collection: input.collection,
        query: input.query ?? null,
        filter: input.filter ?? null,
        ...results,
        documents: items,
      };
    },
  },
  {
    name: "quick_files_list",
    label: "List uploaded files",
    description: "List uploaded file metadata for the current app/site with safe pagination defaults.",
    parameters: Type.Object({
      page: Type.Optional(Type.Integer({ description: "1-based result page. Defaults to 1.", minimum: 1 })),
      pageSize: Type.Optional(Type.Integer({ description: "Files per page. Defaults to 20 and is capped at 100.", minimum: 1, maximum: 100 })),
    }),
    execute: (ctx, params) => {
      const input = params as { page?: number; pageSize?: number };
      const site = requireCurrentSite(ctx.c);
      const files = collections.all(site, filesCollection).map(asQuickFileDocument).filter((file) => file !== undefined);
      const { items, ...results } = paged(files, input.page, input.pageSize);

      return {
        site,
        ...results,
        files: items,
      };
    },
  },
  {
    name: "quick_sites_list",
    label: "List Quick sites",
    description: "List known Quick sites. This is intentionally not scoped to the current app/site.",
    parameters: Type.Object({
      page: Type.Optional(Type.Integer({ description: "1-based result page. Defaults to 1.", minimum: 1 })),
      pageSize: Type.Optional(Type.Integer({ description: "Sites per page. Defaults to 20 and is capped at 100.", minimum: 1, maximum: 100 })),
    }),
    execute: async (_ctx, params) => {
      const input = params as { page?: number; pageSize?: number };
      const { items, ...results } = paged(await listSiteMetadata(), input.page, input.pageSize);

      return {
        ...results,
        sites: items,
      };
    },
  },
  {
    name: "quick_site_get",
    label: "Get current site",
    description: "Return metadata for the current Quick app/site only. This tool does not allow looking up arbitrary sites.",
    parameters: Type.Object({}),
    execute: async (ctx) => {
      const site = requireCurrentSite(ctx.c);

      return await currentSiteMetadata(site);
    },
  },
];

const quickNativeToolNames = new Set(quickNativeToolFactories.map((tool) => tool.name));

export function listQuickAiTools(): QuickAiToolSummary[] {
  return quickNativeToolFactories.map(({ name, description, label, parameters }) => ({ name, description, label, parameters: parameters as Record<string, unknown> }));
}

export function isQuickAiToolName(name: string) {
  return quickNativeToolNames.has(name);
}

export function createQuickAiTools(ctx: QuickAiToolContext, names: string[]) {
  const requested = new Set([...defaultQuickAiToolNames, ...names]);
  return quickNativeToolFactories
    .filter((factory) => requested.has(factory.name))
    .map((factory) => createTool(factory, ctx));
}
