import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigPath() {
  const baseDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(baseDir, "quick", "config.json");
}

export function getDataDir() {
  const baseDir = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(baseDir, "quick");
}
