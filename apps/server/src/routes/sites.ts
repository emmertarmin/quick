import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { sqlite, sites } from "@quick/db";
import type { QuickSite } from "@quick/shared";
import { filesRoot, quickDomain, quickScheme, sitesRoot } from "../config";
import { readAuthSession } from "./auth";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateSiteName(site: string) {
  return siteNamePattern.test(site);
}

function sitePath(site: string) {
  return join(sitesRoot, site);
}

function deployError(message: string) {
  return { error: message };
}

function siteUrl(site: string) {
  return `${quickScheme}://${site}.${quickDomain}`;
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
  const metadataBySite = new Map(sites.all().map((metadata) => [metadata.site, metadata]));
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

  await assertInsideSitesRoot(sourcePath);
  await assertInsideFilesRoot(fileUploadsPath);

  const [sourceStats, fileUploadStats] = await Promise.all([
    stat(sourcePath).catch(() => undefined),
    stat(fileUploadsPath).catch(() => undefined),
  ]);
  const database = databaseCounts(site);

  await rm(sourcePath, { recursive: true, force: true });
  await rm(fileUploadsPath, { recursive: true, force: true });

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

async function publishDeploy(site: string, tarball: ArrayBuffer) {
  await mkdir(sitesRoot, { recursive: true });

  const tempRoot = await mkdtemp(join(sitesRoot, ".quick-deploy-"));
  const tarballPath = join(tempRoot, "site.tar.gz");
  const extractPath = join(tempRoot, "site");
  const targetPath = sitePath(site);
  const oldPath = join(tempRoot, "old-site");

  try {
    await writeFile(tarballPath, Buffer.from(tarball));
    await validateTarball(tarballPath);
    await mkdir(extractPath);
    await runTar(["--no-same-owner", "--no-same-permissions", "-xzf", tarballPath, "-C", extractPath]);

    const index = await stat(join(extractPath, "index.html")).catch(() => undefined);
    if (!index?.isFile()) {
      throw new Error("Deploy archive must contain index.html at its root");
    }

    const fileCount = await countFilesAndRejectSymlinks(extractPath);

    await assertInsideSitesRoot(targetPath);
    await rm(oldPath, { recursive: true, force: true });

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

    await rm(oldPath, { recursive: true, force: true });
    return { fileCount };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function registerSiteRoutes(app: OpenAPIHono) {
  app.get("/sites", async (c) => {
    return c.json({ sites: await listSites() }, 200);
  });

  app.get("/sites/:site", async (c) => {
    const site = c.req.param("site");

    if (!validateSiteName(site)) {
      return c.json(deployError("Invalid site name"), 400);
    }

    const metadata = sites.get(site);
    const hasIndex = await hasSiteIndex(site);

    if (!metadata && !hasIndex) {
      return c.json({ site, exists: false, url: siteUrl(site), hasIndex: false }, 200);
    }

    return c.json({ ...metadata, site, exists: true, url: siteUrl(site), hasIndex }, 200);
  });

  app.delete("/sites/:site", async (c) => {
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

  app.put("/sites/:site/deploy", async (c) => {
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
