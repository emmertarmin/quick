import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { Context } from "hono";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { sqlite, sites } from "@quick/db";
import type { QuickSite } from "@quick/shared";
import { filesRoot, maxUploadBytes, quickDomain, quickScheme, sitesRoot } from "../config";
import { errorResponseSchema, quickSiteSchema, quickSitesResponseSchema } from "../schemas";
import { readAuthSession } from "./auth";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateSiteName(site: string) {
  return siteNamePattern.test(site);
}

function sitePath(site: string) {
  return join(sitesRoot, site);
}

function deployError(message: string, details: Record<string, unknown> = {}) {
  return { error: message, ...details };
}

class UploadTooLargeError extends Error {
  constructor(public readonly maxUploadBytes: number) {
    super(`Upload is too large; maximum size is ${maxUploadBytes} bytes`);
  }
}

function siteUrl(site: string) {
  return `${quickScheme}://${site}.${quickDomain}`;
}

const thumbnailContentTypes = new Map([
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);
const maxThumbnailBytes = 5 * 1024 * 1024;
const thumbnailWidth = 640;
const thumbnailHeight = 480;
const thumbnailFormat = ".webp";

function thumbnailDir() {
  return join(filesRoot, "_thumbnails");
}

function thumbnailUrl(site: string, version?: number) {
  const base = `/api/sites/${encodeURIComponent(site)}/thumbnail`;
  return version === undefined ? base : `${base}?v=${version}`;
}

async function thumbnailFile(site: string) {
  for (const extension of thumbnailContentTypes.keys()) {
    const path = join(thumbnailDir(), `${site}${extension}`);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) return { path, version: Math.trunc(info.mtimeMs) };
  }
  return undefined;
}

async function siteThumbnailFields(site: string) {
  const thumbnail = await thumbnailFile(site);
  return thumbnail ? { thumbnailUrl: thumbnailUrl(site, thumbnail.version) } : {};
}

function thumbnailExtension(contentType: string) {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "image/webp": return ".webp";
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    default: return undefined;
  }
}

async function hasSiteIndex(site: string) {
  const index = await stat(join(sitePath(site), "index.html")).catch(() => undefined);
  return Boolean(index?.isFile());
}

async function deployedSiteNames() {
  const entries = await readdir(sitesRoot, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && validateSiteName(entry.name) && await hasSiteIndex(entry.name)) {
      names.push(entry.name);
    }
  }

  return names.sort((a, b) => a.localeCompare(b));
}

async function listSites(): Promise<QuickSite[]> {
  const metadataBySite = new Map(sites.list().map((metadata) => [metadata.site, metadata]));
  const names = new Set([...metadataBySite.keys(), ...await deployedSiteNames()]);

  return Promise.all(
    [...names].sort((a, b) => a.localeCompare(b)).map(async (site) => {
      const metadata = metadataBySite.get(site);

      return {
        site,
        url: siteUrl(site),
        exists: true as const,
        hasIndex: await hasSiteIndex(site),
        ...(metadata
          ? {
              lastDeployedAt: metadata.lastDeployedAt,
              lastDeployedBy: metadata.lastDeployedBy,
              fileCount: metadata.fileCount,
            }
          : {}),
        ...await siteThumbnailFields(site),
      };
    }),
  );
}

async function requireDeployIdentity(c: Context) {
  return readAuthSession(c);
}

function isSafeTarEntry(entry: string) {
  const normalized = entry.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");

  if (!normalized || normalized === ".") {
    return true;
  }

  if (normalized.startsWith("/") || normalized.includes("\0")) {
    return false;
  }

  return !normalized.split("/").includes("..");
}

async function runTar(args: string[]) {
  const proc = Bun.spawn(["tar", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `tar exited with code ${exitCode}`);
  }

  return stdout;
}

async function validateTarball(tarballPath: string) {
  const listing = await runTar(["-tzf", tarballPath]);
  const entries = listing.split("\n").filter(Boolean);

  if (entries.length === 0) {
    throw new Error("Deploy archive is empty");
  }

  const unsafe = entries.find((entry) => !isSafeTarEntry(entry));
  if (unsafe) {
    throw new Error(`Deploy archive contains unsafe path: ${unsafe}`);
  }
}

function normalizeArchiveEntry(entry: string) {
  return entry.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

async function extractZipArchive(zip: ArrayBuffer, extractPath: string) {
  let entries: Record<string, Uint8Array>;
  const maxExtractedBytes = 100 * 1024 * 1024;
  let extractedBytes = 0;
  let fileCount = 0;
  let validationError: Error | undefined;

  try {
    entries = unzipSync(new Uint8Array(zip), {
      filter(file) {
        const normalized = normalizeArchiveEntry(file.name);

        if (!isSafeTarEntry(file.name)) {
          validationError = new Error(`Upload archive contains unsafe path: ${file.name}`);
          throw validationError;
        }

        if (file.name.endsWith("/") || !normalized || normalized === ".") return false;

        fileCount += 1;
        extractedBytes += file.originalSize;
        if (extractedBytes > maxExtractedBytes) {
          validationError = new Error("Upload archive expands to more than 100 MB");
          throw validationError;
        }

        return true;
      },
    });
  } catch (error) {
    if (validationError) throw validationError;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read zip archive: ${message}`);
  }

  if (fileCount === 0) {
    throw new Error("Upload archive is empty");
  }

  for (const [entry, bytes] of Object.entries(entries)) {
    const normalized = normalizeArchiveEntry(entry);
    const target = join(extractPath, normalized);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function countFilesAndRejectSymlinks(dir: string): Promise<number> {
  let count = 0;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Deploy archive contains symlink: ${path}`);
    }

    if (entry.isDirectory()) {
      count += await countFilesAndRejectSymlinks(path);
      continue;
    }

    if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

async function assertInsideRoot(rootPath: string, path: string, label: string) {
  const root = resolve(rootPath);
  const target = resolve(path);
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;

  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new Error(`Resolved ${label} path escaped root: ${basename(path)}`);
  }
}

async function assertInsideSitesRoot(path: string) {
  await assertInsideRoot(sitesRoot, path, "site");
}

async function assertInsideFilesRoot(path: string) {
  await assertInsideRoot(filesRoot, path, "files");
}

type PurgeDatabaseCounts = {
  siteMetadataRows: number;
  documentRows: number;
};

type PurgeResult = {
  site: string;
  sourceDeleted: boolean;
  filesDeleted: boolean;
  database: PurgeDatabaseCounts;
};

function databaseCounts(site: string): PurgeDatabaseCounts {
  const documentRows = sqlite.prepare("select count(*) as count from json_documents where site = ?").get(site) as { count: number };
  const siteMetadataRows = sqlite.prepare("select count(*) as count from sites where name = ?").get(site) as { count: number };

  return {
    siteMetadataRows: Number(siteMetadataRows.count),
    documentRows: Number(documentRows.count),
  };
}

async function purgeSite(site: string): Promise<PurgeResult> {
  const sourcePath = sitePath(site);
  const fileUploadsPath = join(filesRoot, site);
  const thumbnailPath = await thumbnailFile(site);

  await assertInsideSitesRoot(sourcePath);
  await assertInsideFilesRoot(fileUploadsPath);

  const [sourceStats, fileUploadStats] = await Promise.all([
    stat(sourcePath).catch(() => undefined),
    stat(fileUploadsPath).catch(() => undefined),
  ]);
  const database = databaseCounts(site);

  await rm(sourcePath, { recursive: true, force: true });
  await rm(fileUploadsPath, { recursive: true, force: true });
  if (thumbnailPath) await rm(thumbnailPath.path, { force: true });

  sqlite.transaction((purgedSite: string) => {
    sqlite.prepare("delete from json_documents where site = ?").run(purgedSite);
    sqlite.prepare("delete from sites where name = ?").run(purgedSite);
  })(site);

  return {
    site,
    sourceDeleted: Boolean(sourceStats),
    filesDeleted: Boolean(fileUploadStats),
    database,
  };
}

async function publishExtractedSite(site: string, extractPath: string) {
  const index = await stat(join(extractPath, "index.html")).catch(() => undefined);
  if (!index?.isFile()) {
    throw new Error("Upload must contain index.html at its root");
  }

  const fileCount = await countFilesAndRejectSymlinks(extractPath);
  const targetPath = sitePath(site);
  const oldRoot = await mkdtemp(join(sitesRoot, ".quick-old-"));
  const oldPath = join(oldRoot, "site");

  try {
    await assertInsideSitesRoot(targetPath);

    const existing = await stat(targetPath).catch(() => undefined);
    if (existing) {
      await rename(targetPath, oldPath);
    }

    try {
      await rename(extractPath, targetPath);
    } catch (error) {
      if (existing) {
        await rename(oldPath, targetPath).catch(() => undefined);
      }
      throw error;
    }

    return { fileCount };
  } finally {
    await rm(oldRoot, { recursive: true, force: true });
  }
}

async function publishDeploy(site: string, tarball: ArrayBuffer) {
  await mkdir(sitesRoot, { recursive: true });

  const tempRoot = await mkdtemp(join(sitesRoot, ".quick-deploy-"));
  const tarballPath = join(tempRoot, "site.tar.gz");
  const extractPath = join(tempRoot, "site");

  try {
    await writeFile(tarballPath, Buffer.from(tarball));
    await validateTarball(tarballPath);
    await mkdir(extractPath);
    await runTar(["--no-same-owner", "--no-same-permissions", "-xzf", tarballPath, "-C", extractPath]);
    return await publishExtractedSite(site, extractPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function browserUploadPublishPath(extractPath: string) {
  const rootIndex = await stat(join(extractPath, "index.html")).catch(() => undefined);
  if (rootIndex?.isFile()) {
    return extractPath;
  }

  const entries = await readdir(extractPath, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());

  if (files.length === 0 && directories.length === 1) {
    const nestedPath = join(extractPath, directories[0].name);
    const nestedIndex = await stat(join(nestedPath, "index.html")).catch(() => undefined);
    if (nestedIndex?.isFile()) {
      return nestedPath;
    }
  }

  const rootNames = entries.slice(0, 8).map((entry) => entry.name).join(", ");
  const detail = rootNames ? ` Root entries found: ${rootNames}${entries.length > 8 ? ", …" : ""}.` : "";
  throw new Error(`Upload must contain index.html at its root, or inside a single top-level folder.${detail}`);
}

function looksLikeHtml(bytes: ArrayBuffer) {
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.includes("<head") || prefix.includes("<body");
}

async function publishBrowserUpload(site: string, file: File) {
  await mkdir(sitesRoot, { recursive: true });

  if (file.size > maxUploadBytes) {
    throw new UploadTooLargeError(maxUploadBytes);
  }

  const tempRoot = await mkdtemp(join(sitesRoot, ".quick-upload-"));
  const extractPath = join(tempRoot, "site");

  try {
    await mkdir(extractPath);

    if (file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      await extractZipArchive(await file.arrayBuffer(), extractPath);
    } else if (file.name === "index.html" || file.type === "text/html") {
      const bytes = await file.arrayBuffer();
      if (!looksLikeHtml(bytes)) {
        throw new Error("Uploaded HTML file does not look like HTML");
      }
      await writeFile(join(extractPath, "index.html"), Buffer.from(bytes));
    } else {
      throw new Error("Upload a .zip file or a single index.html file");
    }

    return await publishExtractedSite(site, await browserUploadPublishPath(extractPath));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function uploadFileFromForm(form: FormData) {
  const value = form.get("file") ?? form.get("upload");
  return value instanceof File ? value : undefined;
}

async function readRequestBodyWithLimit(c: Context, maxBytes: number, errorMessage: string) {
  const contentLength = c.req.header("Content-Length");
  const declaredLength = contentLength ? Number(contentLength) : undefined;
  if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(errorMessage);
  }

  const body = c.req.raw.body;
  if (!body) return new ArrayBuffer(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(errorMessage);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function storeThumbnail(site: string, contentType: string, bytes: ArrayBuffer) {
  const extension = thumbnailExtension(contentType);
  if (!extension) {
    throw new Error("Thumbnail must be image/webp, image/png, or image/jpeg");
  }

  if (bytes.byteLength > maxThumbnailBytes) {
    throw new Error("Thumbnail must be 5 MB or smaller");
  }

  const optimized = await sharp(Buffer.from(bytes), { failOn: "warning" })
    .rotate()
    .resize({ width: thumbnailWidth, height: thumbnailHeight, fit: "cover", position: "top" })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  await mkdir(thumbnailDir(), { recursive: true });
  for (const existing of thumbnailContentTypes.keys()) {
    await rm(join(thumbnailDir(), `${site}${existing}`), { force: true });
  }

  const path = join(thumbnailDir(), `${site}${thumbnailFormat}`);
  await writeFile(path, optimized);
  const info = await stat(path);
  return { thumbnailUrl: thumbnailUrl(site, Math.trunc(info.mtimeMs)) };
}

const apiErrorResponseSchema = errorResponseSchema.catchall(z.unknown()).openapi("SiteErrorResponse");
const apiQuickSiteSchema = quickSiteSchema.extend({ exists: z.boolean(), thumbnailUrl: z.string().optional() }).partial({ url: true, hasIndex: true }).openapi("SiteQuickSite");
const apiQuickSitesResponseSchema = quickSitesResponseSchema.openapi("SiteQuickSitesResponse");
const apiSiteParamsSchema = z.object({
  site: z.string().openapi({ description: "Quick site name.", example: "demo" }),
}).openapi("SiteParams");
const apiMissingSiteSchema = z.object({
  site: z.string(),
  exists: z.boolean(),
  url: z.string(),
  hasIndex: z.boolean(),
}).openapi("MissingQuickSite");
const apiSiteLookupResponseSchema = z.union([apiQuickSiteSchema, apiMissingSiteSchema]).openapi("SiteLookupResponse");
const apiPurgeResponseSchema = z.object({}).catchall(z.unknown()).openapi("SitePurgeResponse");

const errorJson = (description: string) => ({
  content: {
    "application/json": {
      schema: apiErrorResponseSchema,
    },
  },
  description,
});

const siteJson = (description: string) => ({
  content: {
    "application/json": {
      schema: apiQuickSiteSchema,
    },
  },
  description,
});

export function registerSiteRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/sites",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: apiQuickSitesResponseSchema,
            },
          },
          description: "Known Quick sites.",
        },
      },
    }),
    async (c) => {
    return c.json({ sites: await listSites() }, 200);
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/sites/{site}",
      request: { params: apiSiteParamsSchema },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: apiSiteLookupResponseSchema,
            },
          },
          description: "Site lookup result.",
        },
        400: errorJson("Invalid site name."),
      },
    }),
    async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const metadata = sites.get(site);
    const hasIndex = await hasSiteIndex(site);

    if (!metadata && !hasIndex) {
      return c.json({ site, exists: false, url: siteUrl(site), hasIndex: false }, 200);
    }

    return c.json({ ...metadata, site, exists: true, url: siteUrl(site), hasIndex, ...await siteThumbnailFields(site) }, 200);
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/sites/{site}/thumbnail",
      request: { params: apiSiteParamsSchema },
      responses: {
        200: {
          content: {
            "image/webp": { schema: z.string().openapi({ type: "string", format: "binary" }) },
            "image/png": { schema: z.string().openapi({ type: "string", format: "binary" }) },
            "image/jpeg": { schema: z.string().openapi({ type: "string", format: "binary" }) },
          },
          description: "Site thumbnail image.",
        },
        400: errorJson("Invalid site name."),
        404: errorJson("Thumbnail not found."),
      },
    }),
    async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const thumbnail = await thumbnailFile(site);
    if (!thumbnail) {
      return c.json(deployError("Thumbnail not found"), 404);
    }

    return new Response(Bun.file(thumbnail.path), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": thumbnailContentTypes.get(extname(thumbnail.path).toLowerCase()) ?? "application/octet-stream",
      },
    });
  });

  app.openapi(
    createRoute({
      method: "put",
      path: "/sites/{site}/thumbnail",
      request: {
        params: apiSiteParamsSchema,
        body: {
          content: {
            "image/webp": { schema: z.string().openapi({ type: "string", format: "binary" }) },
            "image/png": { schema: z.string().openapi({ type: "string", format: "binary" }) },
            "image/jpeg": { schema: z.string().openapi({ type: "string", format: "binary" }) },
          },
          required: true,
        },
      },
      responses: {
        200: siteJson("Updated site thumbnail metadata."),
        400: errorJson("Invalid site name, content type, or thumbnail body."),
        401: errorJson("Authentication required."),
        404: errorJson("Site does not exist."),
      },
    }),
    async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const session = await requireDeployIdentity(c);
    if (!session) {
      return c.json(deployError("Authentication required"), 401);
    }

    const existing = sites.get(site);
    const hasIndex = await hasSiteIndex(site);
    if (!existing && !hasIndex) {
      return c.json(deployError("Site does not exist"), 404);
    }

    try {
      const contentType = c.req.header("Content-Type") ?? "";
      const uploaded = await readRequestBodyWithLimit(c, maxThumbnailBytes, "Thumbnail must be 5 MB or smaller");
      const thumbnail = await storeThumbnail(site, contentType, uploaded);
      return c.json({ site, exists: true, url: siteUrl(site), hasIndex, ...thumbnail }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(deployError(message), 400);
    }
  });

  app.openapi(
    createRoute({
      method: "delete",
      path: "/sites/{site}",
      request: { params: apiSiteParamsSchema },
      responses: {
        200: {
          content: { "application/json": { schema: apiPurgeResponseSchema } },
          description: "Site purge result.",
        },
        400: errorJson("Invalid site name."),
        401: errorJson("Authentication required."),
        404: errorJson("Site does not exist."),
        500: errorJson("Purge failed."),
      },
    }),
    async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const session = await requireDeployIdentity(c);
    if (!session) {
      return c.json(deployError("Authentication required"), 401);
    }

    try {
      const result = await purgeSite(site);
      const existed = result.sourceDeleted || result.filesDeleted || result.database.siteMetadataRows > 0 || result.database.documentRows > 0;

      if (!existed) {
        return c.json({ error: "Site does not exist", site }, 404);
      }

      return c.json(result, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(deployError(message), 500);
    }
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/sites/{site}/upload",
      request: {
        params: apiSiteParamsSchema,
        headers: z.object({
          "X-Quick-Confirm-Overwrite": z.string().optional().openapi({ description: "Set to the site name to confirm overwriting an existing site." }),
        }),
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({ file: z.any().openapi({ type: "string", format: "binary" }) }).openapi("SiteUploadRequest"),
            },
          },
          required: true,
        },
      },
      responses: {
        200: siteJson("Existing site replaced from browser upload."),
        201: siteJson("New site created from browser upload."),
        400: errorJson("Invalid site name or upload body."),
        401: errorJson("Authentication required."),
        409: errorJson("Site exists and overwrite was not confirmed."),
        413: errorJson("Upload exceeds size limit."),
      },
    }),
    async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const session = await requireDeployIdentity(c);
    if (!session) {
      return c.json(deployError("Authentication required"), 401);
    }

    const existing = sites.get(site);
    if (existing && c.req.header("X-Quick-Confirm-Overwrite") !== site) {
      return c.json(
        {
          error: "Site exists",
          ...existing,
        },
        409,
      );
    }

    try {
      const form = await c.req.formData();
      const file = uploadFileFromForm(form);
      if (!file) {
        return c.json(deployError("Expected multipart upload with a file field"), 400);
      }

      const { fileCount } = await publishBrowserUpload(site, file);
      const metadata = sites.recordDeploy({
        site,
        deployer: session.user,
        deployedAt: new Date().toISOString(),
        fileCount,
      });

      return c.json({ ...metadata, url: siteUrl(site), hasIndex: true }, existing ? 200 : 201);
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        return c.json(deployError(error.message, { maxUploadBytes: error.maxUploadBytes }), 413);
      }

      const message = error instanceof Error ? error.message : String(error);
      return c.json(deployError(message), 400);
    }
  });

  app.openapi(
    createRoute({
      method: "put",
      path: "/sites/{site}/deploy",
      request: {
        params: apiSiteParamsSchema,
        headers: z.object({
          "X-Quick-Confirm-Overwrite": z.string().optional().openapi({ description: "Set to the site name to confirm overwriting an existing site." }),
        }),
        body: {
          content: {
            "application/tar+gzip": { schema: z.string().openapi({ type: "string", format: "binary" }) },
            "application/gzip": { schema: z.string().openapi({ type: "string", format: "binary" }) },
            "application/octet-stream": { schema: z.string().openapi({ type: "string", format: "binary" }) },
          },
          required: true,
        },
      },
      responses: {
        200: siteJson("Existing site deployed."),
        201: siteJson("New site deployed."),
        400: errorJson("Invalid site name or deploy archive."),
        401: errorJson("Authentication required."),
        409: errorJson("Site exists and overwrite was not confirmed."),
        415: errorJson("Unsupported upload content type."),
      },
    }),
    async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const session = await requireDeployIdentity(c);
    if (!session) {
      return c.json(deployError("Authentication required"), 401);
    }

    const existing = sites.get(site);
    if (existing && c.req.header("X-Quick-Confirm-Overwrite") !== site) {
      return c.json(
        {
          error: "Site exists",
          ...existing,
        },
        409,
      );
    }

    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.includes("application/tar+gzip") && !contentType.includes("application/gzip") && !contentType.includes("application/octet-stream")) {
      return c.json(deployError("Expected application/tar+gzip upload"), 415);
    }

    try {
      const uploaded = await c.req.arrayBuffer();
      const { fileCount } = await publishDeploy(site, uploaded);
      const metadata = sites.recordDeploy({
        site,
        deployer: session.user,
        deployedAt: new Date().toISOString(),
        fileCount,
      });

      return c.json(metadata, existing ? 200 : 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(deployError(message), 400);
    }
  });
}
