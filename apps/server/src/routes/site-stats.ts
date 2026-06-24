import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { sites, sqlite } from "@quick/db";
import { filesRoot, quickDomain, quickScheme, sitesRoot } from "../config";
import { errorResponseSchema } from "../schemas";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const textExtensions = new Set([".html", ".htm", ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".txt", ".md", ".svg", ".xml", ".csv", ".yml", ".yaml"]);
const internalCollections = new Set(["_quick_files"]);

type ExtensionStats = { extension: string; files: number; bytes: number; lines: number };
type LargestFile = { path: string; bytes: number };
type ApiUsage = {
  sdkImport: boolean;
  usesAuth: boolean;
  usesIdentity: boolean;
  usesFiles: boolean;
  usesRealtime: boolean;
  collections: string[];
  realtimeChannels: string[];
  realtimePresence: string[];
};

type CollectionStatsRow = {
  collection: string;
  documentCount: number;
  approxBytes: number;
  oldestCreatedAt: string | null;
  newestUpdatedAt: string | null;
};

type FileMetadataRow = {
  id: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
  updated_at: string;
};

function siteUrl(site: string) {
  return `${quickScheme}://${site}.${quickDomain}`;
}

function safeRelative(root: string, path: string) {
  return relative(root, path).split(sep).join("/") || ".";
}

async function hasIndex(site: string) {
  return Boolean((await stat(join(sitesRoot, site, "index.html")).catch(() => undefined))?.isFile());
}

async function walk(root: string) {
  const files: string[] = [];
  let directoryCount = 0;

  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        directoryCount += 1;
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return { files, directoryCount };
}

function looksText(path: string, sample: Buffer) {
  const extension = extname(path).toLowerCase();
  if (textExtensions.has(extension)) return true;
  return !sample.includes(0) && sample.subarray(0, 512).every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32);
}

function detectApiUsage(text: string, usage: ApiUsage) {
  if (text.includes("/quick.js") || text.includes("createQuickClient")) usage.sdkImport = true;
  if (/\bquick\.auth\b/.test(text)) usage.usesAuth = true;
  if (/\bquick\.identity\b/.test(text)) usage.usesIdentity = true;
  if (/\bquick\.files\b/.test(text)) usage.usesFiles = true;
  if (/\bquick\.realtime\b/.test(text)) usage.usesRealtime = true;

  for (const match of text.matchAll(/\bquick\.db\.collection\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
    usage.collections.push(match[2] ?? "");
  }
  for (const match of text.matchAll(/\bquick\.realtime\.channel\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
    usage.realtimeChannels.push(match[2] ?? "");
  }
  for (const match of text.matchAll(/\bquick\.realtime\.presence\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
    usage.realtimePresence.push(match[2] ?? "");
  }
}

function uniqSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function sourceStats(site: string, top: number) {
  const root = join(sitesRoot, site);
  const exists = Boolean(await stat(root).catch(() => undefined));
  const emptyUsage: ApiUsage = { sdkImport: false, usesAuth: false, usesIdentity: false, usesFiles: false, usesRealtime: false, collections: [], realtimeChannels: [], realtimePresence: [] };

  if (!exists) {
    return { fileCount: 0, directoryCount: 0, totalBytes: 0, textFileCount: 0, binaryFileCount: 0, lineCount: 0, extensions: [], largestFiles: [], apiUsage: emptyUsage };
  }

  const { files, directoryCount } = await walk(root);
  const extensions = new Map<string, ExtensionStats>();
  const largestFiles: LargestFile[] = [];
  const apiUsage = emptyUsage;
  let totalBytes = 0;
  let textFileCount = 0;
  let binaryFileCount = 0;
  let lineCount = 0;

  for (const file of files) {
    const fileStat = await stat(file);
    const bytes = fileStat.size;
    totalBytes += bytes;
    largestFiles.push({ path: safeRelative(root, file), bytes });

    const extension = extname(file).toLowerCase() || "[none]";
    const extensionStats = extensions.get(extension) ?? { extension, files: 0, bytes: 0, lines: 0 };
    extensionStats.files += 1;
    extensionStats.bytes += bytes;

    const buffer = await readFile(file);
    if (looksText(file, buffer)) {
      textFileCount += 1;
      const text = buffer.toString("utf8");
      const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
      lineCount += lines;
      extensionStats.lines += lines;
      detectApiUsage(text, apiUsage);
    } else {
      binaryFileCount += 1;
    }

    extensions.set(extension, extensionStats);
  }

  apiUsage.collections = uniqSorted(apiUsage.collections);
  apiUsage.realtimeChannels = uniqSorted(apiUsage.realtimeChannels);
  apiUsage.realtimePresence = uniqSorted(apiUsage.realtimePresence);

  return {
    fileCount: files.length,
    directoryCount,
    totalBytes,
    textFileCount,
    binaryFileCount,
    lineCount,
    extensions: [...extensions.values()].sort((a, b) => b.bytes - a.bytes || a.extension.localeCompare(b.extension)),
    largestFiles: largestFiles.sort((a, b) => b.bytes - a.bytes).slice(0, top),
    apiUsage,
  };
}

function databaseStats(site: string) {
  const rows = sqlite
    .prepare("select collection, count(*) as documentCount, coalesce(sum(length(data)), 0) as approxBytes, min(created_at) as oldestCreatedAt, max(updated_at) as newestUpdatedAt from json_documents where site = ? group by collection order by documentCount desc, collection asc")
    .all(site) as CollectionStatsRow[];

  const documentCount = rows.reduce((sum, row) => sum + row.documentCount, 0);
  const approxBytes = rows.reduce((sum, row) => sum + row.approxBytes, 0);
  const collections = rows.map((row) => ({ ...row, internal: internalCollections.has(row.collection) }));

  return {
    collectionCount: rows.length,
    userCollectionCount: collections.filter((row) => !row.internal).length,
    internalCollectionCount: collections.filter((row) => row.internal).length,
    documentCount,
    approxBytes,
    collections,
  };
}

async function uploadedFileStats(site: string, top: number) {
  const rows = sqlite.prepare("select id, data, created_at, updated_at from json_documents where site = ? and collection = '_quick_files'").all(site) as { id: string; data: string; created_at: string; updated_at: string }[];
  const files: FileMetadataRow[] = [];

  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as Partial<FileMetadataRow>;
      if (typeof data.name === "string" && typeof data.content_type === "string" && typeof data.size === "number") {
        files.push({ id: row.id, name: data.name, content_type: data.content_type, size: data.size, created_at: row.created_at, updated_at: row.updated_at });
      }
    } catch {
      // Ignore malformed metadata in aggregate output; health checks surface count mismatches below.
    }
  }

  const byContentType = new Map<string, { contentType: string; files: number; bytes: number }>();
  for (const file of files) {
    const item = byContentType.get(file.content_type) ?? { contentType: file.content_type, files: 0, bytes: 0 };
    item.files += 1;
    item.bytes += file.size;
    byContentType.set(file.content_type, item);
  }

  const missingBlobs: string[] = [];
  for (const file of files) {
    if (!((await stat(join(filesRoot, site, file.id)).catch(() => undefined))?.isFile())) missingBlobs.push(file.id);
  }

  const blobIds = new Set<string>();
  for (const entry of await readdir(join(filesRoot, site), { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile()) blobIds.add(entry.name);
  }
  const metadataIds = new Set(files.map((file) => file.id));
  const orphanBlobs = [...blobIds].filter((id) => !metadataIds.has(id)).sort();

  return {
    count: files.length,
    bytes: files.reduce((sum, file) => sum + file.size, 0),
    contentTypes: [...byContentType.values()].sort((a, b) => b.bytes - a.bytes || a.contentType.localeCompare(b.contentType)),
    largest: files.sort((a, b) => b.size - a.size).slice(0, top),
    missingBlobs,
    orphanBlobs,
  };
}

const apiSiteStatsParamsSchema = z.object({
  site: z.string().openapi({ description: "Quick site name.", example: "demo" }),
}).openapi("SiteStatsParams");
const apiSiteStatsQuerySchema = z.object({
  top: z.string().optional().openapi({ description: "Maximum number of top files/items to return, clamped to 1..100.", example: "10" }),
}).openapi("SiteStatsQuery");
const apiSiteStatsResponseSchema = z.object({}).catchall(z.unknown()).openapi("SiteStatsResponse");
const apiErrorResponseSchema = errorResponseSchema.openapi("SiteStatsErrorResponse");

export function registerSiteStatsRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/sites/{site}/stats",
      request: {
        params: apiSiteStatsParamsSchema,
        query: apiSiteStatsQuerySchema,
      },
      responses: {
        200: {
          content: { "application/json": { schema: apiSiteStatsResponseSchema } },
          description: "Aggregate source, database, upload, API usage, and health stats for a site.",
        },
        400: {
          content: { "application/json": { schema: apiErrorResponseSchema } },
          description: "Invalid site name.",
        },
      },
    }),
    async (c) => {
    const site = c.req.param("site");
    if (!siteNamePattern.test(site)) return c.json({ error: "Invalid site name" }, 400);

    const requestedTop = Number(c.req.query("top") ?? 10);
    const top = Number.isFinite(requestedTop) ? Math.max(1, Math.min(100, Math.trunc(requestedTop))) : 10;
    const metadata = sites.get(site);
    const source = await sourceStats(site, top);
    const database = databaseStats(site);
    const files = await uploadedFileStats(site, top);
    const index = await hasIndex(site);
    const exists = Boolean(metadata || index || source.fileCount > 0 || database.documentCount > 0 || files.count > 0);

    const checks = [
      { name: "index.html present", status: index ? "ok" : "warning" },
      { name: "deploy metadata present", status: metadata ? "ok" : "warning" },
      { name: "uploaded-file metadata has blobs", status: files.missingBlobs.length === 0 ? "ok" : "warning", count: files.missingBlobs.length },
      { name: "uploaded blobs have metadata", status: files.orphanBlobs.length === 0 ? "ok" : "warning", count: files.orphanBlobs.length },
    ];

    return c.json({
      site,
      url: siteUrl(site),
      exists,
      hasIndex: index,
      inspectedAt: new Date().toISOString(),
      deployment: metadata ? { lastDeployedAt: metadata.lastDeployedAt, lastDeployedBy: metadata.lastDeployedBy, fileCount: metadata.fileCount } : null,
      source,
      database,
      files,
      health: { checks, warnings: checks.filter((check) => check.status !== "ok").map((check) => check.name) },
    }, 200);
  });
}
