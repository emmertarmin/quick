import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CommandDefinition } from "../cli/types.js";
import { loadAuthForRemote, refreshAuthFromResponse } from "./auth.js";
import { resolveRemote } from "../config/remote.js";
import type { StoredAuth } from "../config/auth.js";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateSiteName(site: string) {
  if (!siteNamePattern.test(site)) {
    throw new Error("Invalid site name. Use lowercase letters, numbers, and hyphens; start and end with a letter or number.");
  }
}

async function resolveDeployDirectory(path: string) {
  const absolutePath = resolve(path);
  const stats = await stat(absolutePath).catch(() => undefined);

  if (!stats) {
    throw new Error(`Deploy directory does not exist: ${absolutePath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Deploy path is not a directory: ${absolutePath}`);
  }

  const index = await stat(join(absolutePath, "index.html")).catch(() => undefined);
  if (!index?.isFile()) {
    throw new Error(`Deploy directory must contain index.html: ${absolutePath}`);
  }

  return absolutePath;
}

type QuickSiteConfig = {
  site: string;
};

async function readDeploySiteConfig(directory: string) {
  const path = join(directory, ".quick.json");
  const text = await readFile(path, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });

  if (text === undefined) return undefined;

  const parsed = JSON.parse(text) as Partial<QuickSiteConfig>;
  if (typeof parsed.site !== "string" || parsed.site.length === 0) {
    throw new Error(`${path} must define a non-empty "site" string.`);
  }

  return parsed.site;
}

function deployApiUrl(remote: string, site: string) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}/sites/${encodeURIComponent(site)}/deploy`.replace(/\/+/g, "/");
  return url.toString();
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
}

async function createTarball(directory: string) {
  const tempRoot = await mkdtemp(join(tmpdir(), "quick-cli-deploy-"));
  const tarballPath = join(tempRoot, "site.tar.gz");

  try {
    await runTar(["-czf", tarballPath, "-C", directory, "."]);
    const file = Bun.file(tarballPath);
    return {
      bytes: await file.arrayBuffer(),
      size: file.size,
      cleanup: async () => rm(tempRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function confirmOverwrite(site: string) {
  if (!process.stdin.isTTY) {
    throw new Error(`Site '${site}' already exists. Re-run from an interactive terminal to confirm overwrite.`);
  }

  process.stdout.write(`Site '${site}' already exists. Type '${site}' to overwrite: `);
  for await (const chunk of process.stdin) {
    return Buffer.from(chunk).toString("utf8").trim() === site;
  }

  return false;
}

type DeployResponse = {
  error?: string;
  site?: string;
  lastDeployedAt?: string;
  lastDeployedBy?: { id: string; email?: string; name?: string };
  fileCount?: number;
};

async function parseDeployResponse(response: Response): Promise<DeployResponse> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as DeployResponse;
  } catch {
    return { error: text };
  }
}

async function uploadDeploy(options: { remote: string; site: string; tarball: ArrayBuffer; confirmOverwrite: boolean; auth: StoredAuth }) {
  const url = deployApiUrl(options.remote, options.site);
  const headers = new Headers({
    "Content-Type": "application/tar+gzip",
    Authorization: `Bearer ${options.auth.accessToken}`,
    "X-Quick-Refresh-Token": options.auth.refreshToken,
  });

  if (options.confirmOverwrite) {
    headers.set("X-Quick-Confirm-Overwrite", options.site);
  }

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: options.tarball,
  });

  return { response, body: await parseDeployResponse(response), url };
}

export const deployCommand: CommandDefinition = {
  name: "deploy",
  summary: "Deploy a static site",
  description: "Package a directory and upload it to a Quick server.",
  flags: [
    {
      name: "remote",
      type: "string",
      description: "Quick server URL. Overrides QUICK_REMOTE and config remote.",
    },
    {
      name: "dry-run",
      type: "boolean",
      description: "Validate and package without uploading.",
    },
  ],
  arguments: [
    {
      name: "dir",
      description: "Directory containing static site files",
      required: true,
    },
    {
      name: "site",
      description: "Site name to deploy to. Defaults to .quick.json in the deploy directory.",
      required: false,
    },
  ],
  examples: ["quick deploy .", "quick deploy . fun", "quick deploy ./site fun --remote https://quick.example.com"],
  execute: async ({ values, positionals }) => {
    const [dir, siteArg, extra] = positionals;

    if (dir === undefined) {
      throw new Error("Missing arguments. Usage: quick deploy <dir> [site]");
    }

    if (extra !== undefined) {
      throw new Error("Too many arguments. Usage: quick deploy <dir> [site]");
    }

    if (siteArg !== undefined) {
      validateSiteName(siteArg);
    }

    const directory = await resolveDeployDirectory(dir);
    const site = siteArg ?? await readDeploySiteConfig(directory);
    if (site === undefined) {
      throw new Error(`Missing site. Pass one explicitly or define "site" in ${join(directory, ".quick.json")}.`);
    }

    if (siteArg === undefined) {
      validateSiteName(site);
    }
    const remote = await resolveRemote({ remoteFlag: values.remote });

    console.log(`Remote: ${remote}`);
    console.log(`Site: ${site}`);
    console.log(`Directory: ${directory}`);
    console.log("Packaging site...");

    const archive = await createTarball(directory);
    try {
      console.log(`Archive: ${archive.size} bytes`);

      if (values["dry-run"] === true) {
        console.log("Dry run complete. Upload skipped.");
        return;
      }

      let auth = await loadAuthForRemote(remote);
      let result = await uploadDeploy({
        remote,
        site,
        tarball: archive.bytes,
        confirmOverwrite: false,
        auth,
      });
      auth = await refreshAuthFromResponse(remote, auth, result.response);

      if (result.response.status === 409) {
        const existing = result.body.lastDeployedBy?.email ?? result.body.lastDeployedBy?.id;
        if (existing) {
          console.log(`Site '${site}' was last deployed by ${existing}.`);
        }

        const confirmed = await confirmOverwrite(site);
        if (!confirmed) {
          throw new Error("Deployment cancelled.");
        }

        result = await uploadDeploy({ remote, site, tarball: archive.bytes, confirmOverwrite: true, auth });
        auth = await refreshAuthFromResponse(remote, auth, result.response);
      }

      if (!result.response.ok) {
        const message = result.response.status === 401 ? `Authentication required. Run \`quick auth login\`.` : (result.body.error ?? `${result.response.status} ${result.response.statusText}`);
        throw new Error(`Deploy failed: ${message}`);
      }

      const deployedSite = result.body.site ?? site;
      const url = new URL(remote);
      const siteUrl = `${url.protocol}//${deployedSite}.${url.host}/`;
      console.log(`Deployed ${deployedSite} (${result.body.fileCount ?? "?"} files).`);
      console.log(`URL: ${siteUrl}`);
    } finally {
      await archive.cleanup();
    }
  },
};
