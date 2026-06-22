import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { CommandDefinition } from "../cli/types.js";
import { loadConfig } from "../config/config.js";
import { resolveRemote } from "../config/remote.js";
import type { StoredAuth } from "../config/auth.js";
import { loadAuthForRemote, refreshAuthFromResponse, verifyAuthForRemote } from "./auth.js";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type QuickSiteConfig = {
  $schema?: string;
  site: string;
};

type SiteLookupResponse = {
  site?: string;
  exists?: boolean;
  lastDeployedBy?: { id: string; email?: string; name?: string };
};

function normalizeSiteName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function validateSiteName(site: string) {
  if (!siteNamePattern.test(site)) {
    throw new Error("Invalid site name. Use lowercase letters, numbers, and hyphens; start and end with a letter or number.");
  }
}

function apiUrl(remote: string, path: string) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}${path}`.replace(/\/+/g, "/");
  return url.toString();
}

async function prompt(message: string) {
  process.stdout.write(message);
  for await (const chunk of process.stdin) {
    return Buffer.from(chunk).toString("utf8").trim();
  }
  return "";
}

async function readSiteConfig(path: string) {
  const text = await readFile(path, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });

  if (text === undefined) return undefined;

  const parsed = JSON.parse(text) as Partial<QuickSiteConfig>;
  if (typeof parsed.site !== "string" || parsed.site.length === 0) {
    throw new Error(`${path} must define a non-empty "site" string.`);
  }

  return { site: parsed.site };
}

function repoConfigContents(site: string, schemaUrl: string) {
  return `${JSON.stringify({ $schema: schemaUrl, site }, null, 2)}\n`;
}

async function chooseSiteName(configPath: string, cwd: string, schemaUrl: string) {
  const existing = await readSiteConfig(configPath);
  if (existing) {
    validateSiteName(existing.site);
    return { site: existing.site, created: false };
  }

  const defaultName = normalizeSiteName(basename(cwd)) || "quick-site";
  const answer = await prompt(`Site name [${defaultName}]: `);
  const site = normalizeSiteName(answer || defaultName);
  validateSiteName(site);

  await writeFile(configPath, repoConfigContents(site, schemaUrl), "utf8");
  return { site, created: true };
}

async function checkSiteCollision(remote: string, site: string, auth: StoredAuth) {
  const response = await fetch(apiUrl(remote, `/sites/${encodeURIComponent(site)}`), {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "X-Quick-Refresh-Token": auth.refreshToken,
    },
  });
  const nextAuth = await refreshAuthFromResponse(remote, auth, response);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Could not check site name collision: ${text || `${response.status} ${response.statusText}`}`);
  }

  const body = (await response.json()) as SiteLookupResponse;
  return { exists: body.exists === true, body, auth: nextAuth };
}

async function fetchSkill(remote: string, auth: StoredAuth) {
  const response = await fetch(apiUrl(remote, "/skills/quick/SKILL.md"), {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "X-Quick-Refresh-Token": auth.refreshToken,
    },
  });
  const nextAuth = await refreshAuthFromResponse(remote, auth, response);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Could not fetch Quick skillfile: ${text || `${response.status} ${response.statusText}`}`);
  }

  return { text: await response.text(), auth: nextAuth };
}

export const initCommand: CommandDefinition = {
  name: "init",
  summary: "Initialize a Quick site",
  description: "Check auth/config, write .quick.json, verify the site name, and install the Quick agent skillfile.",
  arguments: [
    {
      name: "path",
      description: "Directory to initialize. Defaults to the current working directory.",
      required: false,
    },
  ],
  examples: ["quick init", "quick init ./site"],
  execute: async ({ positionals }) => {
    const [path, extra] = positionals;

    if (extra !== undefined) {
      throw new Error("Too many arguments. Usage: quick init [path]");
    }

    const config = await loadConfig();
    if (!config.remote) {
      throw new Error("No Quick remote configured. Run `quick config set remote <url>` first.");
    }
    const remote = await resolveRemote();

    const auth = await loadAuthForRemote(remote).catch(() => undefined);
    if (!auth) {
      throw new Error(`Not logged in to ${remote}. Run \`quick auth login\` first.`);
    }

    const session = await verifyAuthForRemote(remote, auth);
    if (!session.authenticated) {
      throw new Error(`Not logged in to ${remote}. Run \`quick auth login\` first.`);
    }
    let currentAuth: StoredAuth = session.auth;
    console.log(`Logged in to ${remote} as ${session.user.email ?? session.user.id}`);

    const targetDirectory = resolve(path ?? process.cwd());
    await mkdir(targetDirectory, { recursive: true });
    const siteConfigPath = join(targetDirectory, ".quick.json");
    const schemaUrl = apiUrl(remote, "/schemas/quick.schema.json");
    const chosen = await chooseSiteName(siteConfigPath, targetDirectory, schemaUrl);
    console.log(`${chosen.created ? "Created" : "Found"} .quick.json with site '${chosen.site}'.`);

    const collision = await checkSiteCollision(remote, chosen.site, currentAuth);
    currentAuth = collision.auth;
    if (collision.exists) {
      const deployer = collision.body.lastDeployedBy?.email ?? collision.body.lastDeployedBy?.id;
      const suffix = deployer ? ` Last deployed by ${deployer}.` : "";
      console.log(`Site '${chosen.site}' already exists.${suffix}`);
      const confirmed = await prompt(`Type '${chosen.site}' to keep this site name, or enter a different name: `);
      const nextSite = normalizeSiteName(confirmed);
      if (nextSite !== chosen.site) {
        validateSiteName(nextSite);
        const nextCollision = await checkSiteCollision(remote, nextSite, currentAuth);
        currentAuth = nextCollision.auth;
        if (nextCollision.exists) {
          throw new Error(`Site '${nextSite}' also exists. Re-run \`quick init\` and choose another name, or confirm it explicitly.`);
        }
        await writeFile(siteConfigPath, repoConfigContents(nextSite, schemaUrl), "utf8");
        console.log(`Updated .quick.json with site '${nextSite}'.`);
      } else {
        console.log(`Confirmed existing site '${chosen.site}'.`);
      }
    }

    const skill = await fetchSkill(remote, currentAuth);
    const skillPath = join(targetDirectory, ".agents", "skills", "quick", "SKILL.md");
    await mkdir(join(targetDirectory, ".agents", "skills", "quick"), { recursive: true });
    await writeFile(skillPath, skill.text, "utf8");
    console.log(`Installed Quick skillfile: ${skillPath}`);
  },
};
