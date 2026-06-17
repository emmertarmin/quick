import { loadConfig } from "./config.js";

export type ResolveRemoteOptions = {
  remoteFlag?: string | boolean;
};

export async function resolveRemote(options: ResolveRemoteOptions = {}) {
  if (typeof options.remoteFlag === "string" && options.remoteFlag.length > 0) {
    return normalizeRemote(options.remoteFlag);
  }

  if (process.env.QUICK_REMOTE && process.env.QUICK_REMOTE.length > 0) {
    return normalizeRemote(process.env.QUICK_REMOTE);
  }

  const config = await loadConfig();
  if (config.remote && config.remote.length > 0) {
    return normalizeRemote(config.remote);
  }

  const domain = process.env.QUICK_DOMAIN?.trim();
  if (domain && domain.length > 0) {
    const scheme = process.env.QUICK_SCHEME?.trim() || "https";
    return normalizeRemote(`${scheme}://${domain}`);
  }

  throw new Error("No Quick remote configured. Set --remote, QUICK_REMOTE, config remote, or QUICK_DOMAIN.");
}

function normalizeRemote(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid remote URL: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid remote URL protocol: ${url.protocol}`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}
