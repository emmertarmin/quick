import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getConfigPath } from "./xdg.js";
import type { ConfigKey, QuickConfig } from "./types.js";

export async function ensureConfigDir() {
  await mkdir(dirname(getConfigPath()), { recursive: true });
}

export async function loadConfig(): Promise<QuickConfig> {
  const configPath = getConfigPath();

  try {
    await access(configPath, fsConstants.R_OK);
  } catch {
    return {};
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config in ${configPath}: expected an object`);
  }

  const config = parsed as Partial<QuickConfig>;
  if (config.remote !== undefined && typeof config.remote !== "string") {
    throw new Error(`Invalid config in ${configPath}: remote must be a string`);
  }

  return config;
}

export async function saveConfig(config: QuickConfig) {
  await ensureConfigDir();
  await writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function setConfigValue(key: ConfigKey, value: string) {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
  return config;
}

export function printConfig(config: QuickConfig) {
  console.log(JSON.stringify(config, null, 2));
}
