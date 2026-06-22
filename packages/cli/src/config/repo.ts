import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { normalizeRemote } from "./remote.js";

export type QuickRepoConfig = {
  $schema?: string;
  site?: string;
  remote?: string;
  deploy?: {
    input?: string;
    confirmOverwrite?: boolean;
  };
  thumbnail?: {
    capture?: {
      format?: "webp" | "png";
      output?: string;
    };
  };
};

export type LoadedQuickRepoConfig = {
  path: string;
  directory: string;
  config: QuickRepoConfig;
};

async function fileExists(path: string) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findQuickRepoConfig(startDirectory = process.cwd()): Promise<LoadedQuickRepoConfig | undefined> {
  let directory = resolve(startDirectory);

  while (true) {
    const path = join(directory, ".quick.json");
    if (await fileExists(path)) return loadQuickRepoConfig(path);
    if (await fileExists(join(directory, ".git"))) return undefined;

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export async function loadQuickRepoConfig(path: string): Promise<LoadedQuickRepoConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid repo config in ${path}: expected an object`);
  }

  const config = parsed as QuickRepoConfig;

  if (config.$schema !== undefined && typeof config.$schema !== "string") {
    throw new Error(`Invalid repo config in ${path}: $schema must be a string`);
  }

  if (config.site !== undefined && typeof config.site !== "string") {
    throw new Error(`Invalid repo config in ${path}: site must be a string`);
  }

  if (config.remote !== undefined) {
    if (typeof config.remote !== "string") throw new Error(`Invalid repo config in ${path}: remote must be a string`);
    config.remote = normalizeRemote(config.remote);
  }

  if (config.deploy !== undefined) {
    if (!config.deploy || typeof config.deploy !== "object" || Array.isArray(config.deploy)) {
      throw new Error(`Invalid repo config in ${path}: deploy must be an object`);
    }
    if (config.deploy.input !== undefined && typeof config.deploy.input !== "string") {
      throw new Error(`Invalid repo config in ${path}: deploy.input must be a string`);
    }
    if (config.deploy.confirmOverwrite !== undefined && typeof config.deploy.confirmOverwrite !== "boolean") {
      throw new Error(`Invalid repo config in ${path}: deploy.confirmOverwrite must be a boolean`);
    }
  }

  if (config.thumbnail !== undefined) {
    if (!config.thumbnail || typeof config.thumbnail !== "object" || Array.isArray(config.thumbnail)) {
      throw new Error(`Invalid repo config in ${path}: thumbnail must be an object`);
    }
    const capture = config.thumbnail.capture;
    if (capture !== undefined) {
      if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
        throw new Error(`Invalid repo config in ${path}: thumbnail.capture must be an object`);
      }
      if (capture.format !== undefined && capture.format !== "webp" && capture.format !== "png") {
        throw new Error(`Invalid repo config in ${path}: thumbnail.capture.format must be "webp" or "png"`);
      }
      if (capture.output !== undefined && typeof capture.output !== "string") {
        throw new Error(`Invalid repo config in ${path}: thumbnail.capture.output must be a string`);
      }
    }
  }

  return { path, directory: dirname(path), config };
}

export function resolveRepoPath(repoConfig: LoadedQuickRepoConfig, path: string) {
  return resolve(repoConfig.directory, path);
}

export function printRepoConfigHint(command: "deploy" | "thumbnail") {
  const text = command === "deploy"
    ? "Hint: .quick.json can set remote, deploy.input, and deploy.confirmOverwrite defaults."
    : "Hint: .quick.json can set remote, site, and thumbnail.capture defaults.";
  console.log(process.stdout.isTTY ? `\u001B[2m${text}\u001B[22m` : text);
}
