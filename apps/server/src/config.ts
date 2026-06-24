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
export const maxUploadBytes = 25 * 1024 * 1024;
export const quickChatEnabled = process.env.QUICK_CHAT_ENABLED?.trim().toLowerCase() === "true";
export const quickChatProvider = process.env.QUICK_CHAT_PROVIDER?.trim() || "openrouter";
export const quickChatModel = process.env.QUICK_CHAT_MODEL?.trim() || "";

const entraClientID = process.env.QUICK_ENTRA_CLIENT_ID?.trim();
const entraClientSecret = process.env.QUICK_ENTRA_CLIENT_SECRET?.trim();

if ((entraClientID && !entraClientSecret) || (!entraClientID && entraClientSecret)) {
  throw new Error("QUICK_ENTRA_CLIENT_ID and QUICK_ENTRA_CLIENT_SECRET must be set together");
}

export const entraConfig = entraClientID && entraClientSecret
  ? {
      clientID: entraClientID,
      clientSecret: entraClientSecret,
      tenant: process.env.QUICK_ENTRA_TENANT_ID?.trim() || "common",
    }
  : undefined;

export const codeAuthEnabled = process.env.QUICK_AUTH_DISABLE_CODE?.trim().toLowerCase() !== "true";

if (!codeAuthEnabled && !entraConfig) {
  throw new Error("At least one auth provider must be enabled; unset QUICK_AUTH_DISABLE_CODE or configure Entra ID");
}
