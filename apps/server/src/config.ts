import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeRoot = process.env.QUICK_RUNTIME_ROOT ?? join(repoRoot, "runtime");

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

export const quickDomain = requiredEnv("QUICK_DOMAIN");
export const quickScheme = process.env.QUICK_SCHEME?.trim() || "https";
export const publicOrigin = `${quickScheme}://${quickDomain}`;
export const publicApiBase = `${publicOrigin}/api`;
export const port = Number(process.env.PORT ?? 3000);
export const sitesRoot = process.env.QUICK_SITES_ROOT ?? join(runtimeRoot, "sites");
export const filesRoot = process.env.QUICK_FILES_ROOT ?? join(runtimeRoot, "files");
