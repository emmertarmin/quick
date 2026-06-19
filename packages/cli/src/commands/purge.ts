import type { CommandDefinition } from "../cli/types.js";
import type { StoredAuth } from "../config/auth.js";
import { resolveRemote } from "../config/remote.js";
import { loadAuthForRemote, refreshAuthFromResponse } from "./auth.js";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateSiteName(site: string) {
  if (!siteNamePattern.test(site)) {
    throw new Error("Invalid site name. Use lowercase letters, numbers, and hyphens; start and end with a letter or number.");
  }
}

function purgeApiUrl(remote: string, site: string) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}/sites/${encodeURIComponent(site)}`.replace(/\/+/g, "/");
  return url.toString();
}

async function confirmPurge(site: string) {
  if (!process.stdin.isTTY) {
    throw new Error(`Purging '${site}' requires an interactive terminal.`);
  }

  console.log(`WARNING: This will permanently purge site '${site}'.`);
  console.log("All deployed files, uploaded files, and database records for this site will be deleted.");
  console.log("There is no way to recover anything that is lost.");
  process.stdout.write(`Type '${site}' to permanently purge it: `);

  for await (const chunk of process.stdin) {
    return Buffer.from(chunk).toString("utf8").trim() === site;
  }

  return false;
}

type PurgeResponse = {
  error?: string;
  site?: string;
  sourceDeleted?: boolean;
  filesDeleted?: boolean;
  database?: {
    siteMetadataRows: number;
    documentRows: number;
  };
};

async function parsePurgeResponse(response: Response): Promise<PurgeResponse> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as PurgeResponse;
  } catch {
    return { error: text };
  }
}

async function requestPurge(options: { remote: string; site: string; auth: StoredAuth }) {
  const url = purgeApiUrl(options.remote, options.site);
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${options.auth.accessToken}`,
      "X-Quick-Refresh-Token": options.auth.refreshToken,
    },
  });

  return { response, body: await parsePurgeResponse(response), url };
}

export const purgeCommand: CommandDefinition = {
  name: "purge",
  summary: "Permanently purge a site",
  description: "Delete a site's deployed source, uploaded files, database records, and deploy metadata.",
  flags: [
    {
      name: "remote",
      type: "string",
      description: "Quick server URL. Overrides QUICK_REMOTE and config remote.",
    },
  ],
  arguments: [
    {
      name: "site",
      description: "Site name to purge",
      required: true,
    },
  ],
  examples: ["quick purge todo", "quick purge gallery --remote https://quick.example.com"],
  execute: async ({ values, positionals }) => {
    const [site, extra] = positionals;
    if (site === undefined) throw new Error("Missing argument. Usage: quick purge <site>");
    if (extra !== undefined) throw new Error("Too many arguments. Usage: quick purge <site>");

    validateSiteName(site);
    const remote = await resolveRemote({ remoteFlag: values.remote });

    console.log(`Remote: ${remote}`);
    console.log(`Site: ${site}`);

    const confirmed = await confirmPurge(site);
    if (!confirmed) {
      throw new Error("Purge cancelled.");
    }

    let auth = await loadAuthForRemote(remote);
    const result = await requestPurge({ remote, site, auth });
    auth = await refreshAuthFromResponse(remote, auth, result.response);

    if (!result.response.ok) {
      const message = result.response.status === 401 ? "Authentication required. Run `quick auth login`." : (result.body.error ?? `${result.response.status} ${result.response.statusText}`);
      throw new Error(`Purge failed: ${message}`);
    }

    const database = result.body.database;
    console.log(`Purged ${result.body.site ?? site}.`);
    console.log(`Deleted deployed source: ${result.body.sourceDeleted ? "yes" : "no"}`);
    console.log(`Deleted uploaded files: ${result.body.filesDeleted ? "yes" : "no"}`);
    if (database) {
      console.log(`Deleted database rows: ${database.documentRows} document(s), ${database.siteMetadataRows} deploy metadata row(s).`);
    }
  },
};
