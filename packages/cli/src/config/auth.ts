import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { QuickUser } from "../api-types.js";
import { getConfigPath } from "./xdg.js";

export type StoredAuth = {
  remote: string;
  accessToken: string;
  refreshToken: string;
  user?: QuickUser;
};

export function getAuthPath() {
  return join(dirname(getConfigPath()), "auth.json");
}

export async function loadAuth(): Promise<StoredAuth | undefined> {
  const path = getAuthPath();

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }

  const parsed = JSON.parse(raw) as Partial<StoredAuth>;
  if (typeof parsed.remote !== "string" || typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") {
    throw new Error(`Invalid auth state in ${path}`);
  }

  return parsed as StoredAuth;
}

export async function saveAuth(auth: StoredAuth) {
  const path = getAuthPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

export async function clearAuth() {
  await rm(getAuthPath(), { force: true });
}
