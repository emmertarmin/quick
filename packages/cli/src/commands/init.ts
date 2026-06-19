import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { CommandDefinition } from "../cli/types.js";
import { loadConfig } from "../config/config.js";
import { resolveRemote } from "../config/remote.js";
import type { StoredAuth } from "../config/auth.js";
import { loadAuthForRemote, refreshAuthFromResponse, verifyAuthForRemote } from "./auth.js";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type QuickProjectConfig = {
  project: string;
};

type SiteLookupResponse = {
  site?: string;
  exists?: boolean;
  lastDeployedBy?: { id: string; email?: string; name?: string };
};

function normalizeProjectName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function validateProjectName(project: string) {
  if (!siteNamePattern.test(project)) {
    throw new Error("Invalid project name. Use lowercase letters, numbers, and hyphens; start and end with a letter or number.");
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

async function readProjectConfig(path: string) {
  const text = await readFile(path, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });

  if (text === undefined) return undefined;

  const parsed = JSON.parse(text) as Partial<QuickProjectConfig>;
  if (typeof parsed.project !== "string" || parsed.project.length === 0) {
    throw new Error(`${path} must define a non-empty "project" string.`);
  }

  return { project: parsed.project };
}

async function chooseProjectName(configPath: string, cwd: string) {
  const existing = await readProjectConfig(configPath);
  if (existing) {
    validateProjectName(existing.project);
    return { project: existing.project, created: false };
  }

  const defaultName = normalizeProjectName(basename(cwd)) || "quick-project";
  const answer = await prompt(`Project name [${defaultName}]: `);
  const project = normalizeProjectName(answer || defaultName);
  validateProjectName(project);

  await writeFile(configPath, `${JSON.stringify({ project }, null, 2)}\n`, "utf8");
  return { project, created: true };
}

async function checkSiteCollision(remote: string, project: string, auth: StoredAuth) {
  const response = await fetch(apiUrl(remote, `/sites/${encodeURIComponent(project)}`), {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "X-Quick-Refresh-Token": auth.refreshToken,
    },
  });
  const nextAuth = await refreshAuthFromResponse(remote, auth, response);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Could not check project name collision: ${text || `${response.status} ${response.statusText}`}`);
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
  summary: "Initialize a Quick project",
  description: "Check auth/config, write .quick.json, verify the project name, and install the Quick agent skillfile.",
  examples: ["quick init"],
  execute: async ({ positionals }) => {
    if (positionals.length > 0) {
      throw new Error("Too many arguments. Usage: quick init");
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

    const cwd = resolve(process.cwd());
    const projectConfigPath = join(cwd, ".quick.json");
    const chosen = await chooseProjectName(projectConfigPath, cwd);
    console.log(`${chosen.created ? "Created" : "Found"} .quick.json with project '${chosen.project}'.`);

    const collision = await checkSiteCollision(remote, chosen.project, currentAuth);
    currentAuth = collision.auth;
    if (collision.exists) {
      const deployer = collision.body.lastDeployedBy?.email ?? collision.body.lastDeployedBy?.id;
      const suffix = deployer ? ` Last deployed by ${deployer}.` : "";
      console.log(`Project/site '${chosen.project}' already exists.${suffix}`);
      const confirmed = await prompt(`Type '${chosen.project}' to keep this project name, or enter a different name: `);
      const nextProject = normalizeProjectName(confirmed);
      if (nextProject !== chosen.project) {
        validateProjectName(nextProject);
        const nextCollision = await checkSiteCollision(remote, nextProject, currentAuth);
        currentAuth = nextCollision.auth;
        if (nextCollision.exists) {
          throw new Error(`Project/site '${nextProject}' also exists. Re-run \`quick init\` and choose another name, or confirm it explicitly.`);
        }
        await writeFile(projectConfigPath, `${JSON.stringify({ project: nextProject }, null, 2)}\n`, "utf8");
        console.log(`Updated .quick.json with project '${nextProject}'.`);
      } else {
        console.log(`Confirmed existing project/site '${chosen.project}'.`);
      }
    }

    const skill = await fetchSkill(remote, currentAuth);
    const skillPath = join(cwd, ".agents", "skills", "quick", "SKILL.md");
    await mkdir(join(cwd, ".agents", "skills", "quick"), { recursive: true });
    await writeFile(skillPath, skill.text, "utf8");
    console.log(`Installed Quick skillfile: ${skillPath}`);
  },
};
