import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, extname, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import type { CommandDefinition } from "../cli/types.js";
import { loadAuthForRemote, refreshAuthFromResponse, verifyAuthForRemote } from "./auth.js";
import { findQuickRepoConfig, printRepoConfigHint, resolveRepoPath } from "../config/repo.js";
import { resolveRemote } from "../config/remote.js";
import { getDataDir } from "../config/xdg.js";
import { saveAuth, type StoredAuth } from "../config/auth.js";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
type ThumbnailFormat = "webp" | "png";

function validateSiteName(site: string) {
  if (!siteNamePattern.test(site)) {
    throw new Error("Invalid site name. Use lowercase letters, numbers, and hyphens; start and end with a letter or number.");
  }
}

function siteUrl(remote: string, site: string) {
  const url = new URL(remote);
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.protocol}//${site}.${url.host}${path}`;
}

function cookieDomainForRemote(hostname: string) {
  const address = hostname.replace(/^\[|\]$/g, "");
  if (address === "localhost" || address.endsWith(".localhost") || isIP(address)) return undefined;
  return `.${hostname}`;
}

function apiUrl(remote: string, path: string) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}${path}`.replace(/\/+/g, "/");
  return url.toString();
}

function parseFormat(value: unknown, defaultFormat: ThumbnailFormat = "webp"): ThumbnailFormat {
  if (value === undefined) return defaultFormat;
  if (value === "webp" || value === "png") return value;
  throw new Error("Invalid output format. Use `webp` or `png`.");
}

function defaultOutputPath(site: string, format: ThumbnailFormat) {
  return resolve(getDataDir(), "thumbnails", `${site}.${format}`);
}

async function pngToWebp(png: Buffer) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return Buffer.from(await page.evaluate(async (base64) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create canvas context");
      context.drawImage(bitmap, 0, 0);
      const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
      return Array.from(new Uint8Array(await webp.arrayBuffer()));
    }, png.toString("base64")));
  } finally {
    await browser.close();
  }
}

async function persistAuthFromBrowserCookies(remote: string, auth: StoredAuth, cookies: { name: string; value: string }[]) {
  const accessToken = cookies.find((cookie) => cookie.name === "quick_access_token")?.value;
  const refreshToken = cookies.find((cookie) => cookie.name === "quick_refresh_token")?.value;

  if (!accessToken || !refreshToken || (accessToken === auth.accessToken && refreshToken === auth.refreshToken)) {
    return auth;
  }

  const nextAuth = { ...auth, remote, accessToken, refreshToken };
  await saveAuth(nextAuth);
  return nextAuth;
}

async function captureThumbnail(options: { remote: string; site: string; auth: StoredAuth; format: ThumbnailFormat; outputPath: string }) {
  const url = siteUrl(options.remote, options.site);
  const remoteUrl = new URL(options.remote);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
    });

    const cookieDomain = cookieDomainForRemote(remoteUrl.hostname);
    const cookieScope = cookieDomain ? { domain: cookieDomain } : { url };

    await context.addCookies([
      {
        name: "quick_access_token",
        value: options.auth.accessToken,
        ...cookieScope,
        path: "/",
        httpOnly: true,
        secure: remoteUrl.protocol === "https:",
        sameSite: "Lax",
      },
      {
        name: "quick_refresh_token",
        value: options.auth.refreshToken,
        ...cookieScope,
        path: "/",
        httpOnly: true,
        secure: remoteUrl.protocol === "https:",
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const nextAuth = await persistAuthFromBrowserCookies(options.remote, options.auth, await context.cookies(url));
    options.auth.accessToken = nextAuth.accessToken;
    options.auth.refreshToken = nextAuth.refreshToken;
    const finalUrl = new URL(page.url());
    const expectedUrl = new URL(url);

    if (!response) {
      throw new Error(`Thumbnail capture failed: no navigation response from ${url}`);
    }
    if (response.status() >= 400) {
      throw new Error(`Thumbnail capture failed: ${response.status()} ${response.statusText()} for ${url}`);
    }
    if (finalUrl.origin !== expectedUrl.origin) {
      throw new Error(`Thumbnail capture failed: expected to stay on ${expectedUrl.origin}, but ended at ${finalUrl.toString()}. Run \`quick auth login\` if authentication expired.`);
    }

    const png = Buffer.from(await page.screenshot({ type: "png", fullPage: false }));
    const image = options.format === "png" ? png : await pngToWebp(png);

    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, image);
  } finally {
    await browser.close();
  }
}

async function confirmUpload(site: string, path: string) {
  if (!process.stdin.isTTY) {
    throw new Error("Upload confirmation requires an interactive terminal. Re-run with `--yes` to skip confirmation.");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await readline.question(`Upload ${path} as the thumbnail for ${site}? [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}

function contentTypeForPath(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".webp": return "image/webp";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: throw new Error("Thumbnail file must be .webp, .png, .jpg, or .jpeg");
  }
}

async function uploadThumbnail(options: { remote: string; site: string; filePath: string; auth: StoredAuth }) {
  const contentType = contentTypeForPath(options.filePath);
  const bytes = await readFile(options.filePath);
  const response = await fetch(apiUrl(options.remote, `/sites/${encodeURIComponent(options.site)}/thumbnail`), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${options.auth.accessToken}`,
      "X-Quick-Refresh-Token": options.auth.refreshToken,
      "Content-Type": contentType,
    },
    body: bytes,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) as { error?: string; thumbnailUrl?: string } : {};
  return { response, body };
}

async function uploadThumbnailAndReport(options: { remote: string; site: string; filePath: string; auth: StoredAuth }) {
  console.log("Uploading thumbnail...");
  const result = await uploadThumbnail(options);
  const auth = await refreshAuthFromResponse(options.remote, options.auth, result.response);

  if (!result.response.ok) {
    const message = result.response.status === 401 ? "Authentication required. Run `quick auth login`." : (result.body.error ?? `${result.response.status} ${result.response.statusText}`);
    throw new Error(`Thumbnail upload failed: ${message}`);
  }

  console.log("Thumbnail updated.");
  if (result.body.thumbnailUrl) console.log(`Thumbnail URL: ${new URL(result.body.thumbnailUrl, options.remote).toString()}`);
  console.log(`URL: ${siteUrl(options.remote, options.site)}`);

  return auth;
}

const captureCommand: CommandDefinition = {
  name: "capture",
  summary: "Capture authenticated site thumbnail screenshots",
  flags: [
    { name: "remote", type: "string", description: "Quick server URL. Overrides repo, env, and global config remote." },
    { name: "output", type: "string", description: "Image format: webp or png. Defaults to webp." },
    { name: "file", type: "string", description: "Output file path. Only valid when capturing one site." },
  ],
  arguments: [{ name: "site", description: "Site name(s) to capture. Defaults to site from .quick.json.", required: false, variadic: true }],
  examples: ["quick thumbnail capture todo", "quick thumbnail capture todo --output png", "quick thumbnail capture todo --file ./todo.webp", "quick thumbnail capture site-a site-b"],
  execute: async ({ values, positionals }) => {
    const repoConfig = await findQuickRepoConfig();
    const sites = positionals.length > 0 ? positionals : repoConfig?.config.site ? [repoConfig.config.site] : [];
    if (sites.length === 0) throw new Error("Missing site. Usage: quick thumbnail capture <site...>, or define site in .quick.json.");
    const defaultFormat = repoConfig?.config.thumbnail?.capture?.format;
    const format = parseFormat(values.output, defaultFormat);
    const configuredOutput = repoConfig?.config.thumbnail?.capture?.output;
    if (typeof values.file === "string" && sites.length !== 1) throw new Error("--file can only be used when capturing one site.");
    if (configuredOutput && sites.length !== 1) throw new Error("thumbnail.capture.output can only be used when capturing one site.");
    const file = typeof values.file === "string" ? values.file : configuredOutput && repoConfig ? resolveRepoPath(repoConfig, configuredOutput) : undefined;

    const remote = await resolveRemote({ remoteFlag: values.remote, repoRemote: repoConfig?.config.remote });
    let auth = await loadAuthForRemote(remote);
    const verified = await verifyAuthForRemote(remote, auth);
    if (!verified.authenticated) throw new Error("Authentication required. Run `quick auth login`.");
    auth = verified.auth;

    console.log(`Remote: ${remote}`);
    if (repoConfig) {
      console.log(`Config: ${relative(process.cwd(), repoConfig.path) || ".quick.json"}`);
      printRepoConfigHint("thumbnail");
    }
    for (const site of sites) {
      validateSiteName(site);
      const outputPath = resolve(file ?? defaultOutputPath(site, format));
      console.log(`Site: ${site}`);
      console.log(`URL: ${siteUrl(remote, site)}`);
      console.log("Capturing authenticated screenshot...");
      await captureThumbnail({ remote, site, auth, format, outputPath });
      console.log(`Saved thumbnail: ${outputPath}`);
      console.log(`Preview: ${pathToFileURL(outputPath).toString()}`);
      console.log(`Upload: quick thumbnail upload ${site} ${outputPath}`);
    }
  },
};

const uploadCommand: CommandDefinition = {
  name: "upload",
  summary: "Upload a thumbnail image for a site",
  flags: [
    { name: "remote", type: "string", description: "Quick server URL. Overrides repo, env, and global config remote." },
    { name: "yes", aliases: ["y"], type: "boolean", description: "Upload without interactive confirmation." },
  ],
  arguments: [
    { name: "site", description: "Site name", required: true },
    { name: "file", description: "Thumbnail image path (.webp, .png, .jpg, .jpeg)", required: true },
  ],
  examples: ["quick thumbnail upload todo ~/.local/share/quick/thumbnails/todo.webp", "quick thumbnail upload todo ./custom.png"],
  execute: async ({ values, positionals }) => {
    const [site, fileArg, extra] = positionals;
    if (!site || !fileArg || extra) throw new Error("Usage: quick thumbnail upload <site> <file>");
    validateSiteName(site);

    const filePath = resolve(fileArg);
    const info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`Thumbnail file does not exist: ${filePath}`);
    const contentType = contentTypeForPath(filePath);
    const repoConfig = await findQuickRepoConfig();
    const remote = await resolveRemote({ remoteFlag: values.remote, repoRemote: repoConfig?.config.remote });

    console.log(`Remote: ${remote}`);
    if (repoConfig) {
      console.log(`Config: ${relative(process.cwd(), repoConfig.path) || ".quick.json"}`);
      printRepoConfigHint("thumbnail");
    }
    console.log(`Site: ${site}`);
    console.log(`File: ${filePath}`);
    console.log(`Type: ${contentType}`);
    console.log(`Size: ${info.size} bytes`);

    if (values.yes !== true && !await confirmUpload(site, filePath)) {
      throw new Error("Thumbnail upload cancelled.");
    }

    const auth = await loadAuthForRemote(remote);
    await uploadThumbnailAndReport({ remote, site, filePath, auth });
  },
};

export const thumbnailCommand: CommandDefinition = {
  name: "thumbnail",
  aliases: ["thumb"],
  summary: "Capture and upload site thumbnails",
  description: "Generate authenticated 4:3 site screenshots and upload selected thumbnail images.",
  subcommands: [captureCommand, uploadCommand],
};
