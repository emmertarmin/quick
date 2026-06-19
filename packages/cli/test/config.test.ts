import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

const cliCwd = join(import.meta.dir, "..");
let configHome: string;

async function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "index.ts", ...args],
    cwd: cliCwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...env,
      XDG_CONFIG_HOME: configHome,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "quick-cli-test-"));
});

afterEach(async () => {
  await rm(configHome, { recursive: true, force: true });
});

test("help is available at every config command depth", async () => {
  for (const args of [["-h"], ["auth", "-h"], ["auth", "login", "-h"], ["auth", "status", "-h"], ["auth", "logout", "-h"], ["config", "-h"], ["config", "get", "-h"], ["config", "set", "-h"], ["config", "path", "-h"], ["deploy", "-h"], ["purge", "-h"]]) {
    const result = await runCli(args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--help, -h");
  }
});

test("quick config prints config path and contents", async () => {
  const result = await runCli(["config"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(join(configHome, "quick", "config.json"));
  expect(result.stdout).toContain("{}");
});

test("quick config get dumps config contents", async () => {
  const result = await runCli(["config", "get"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("{}");
});

test("quick config path dumps the config file path", async () => {
  const result = await runCli(["config", "path"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(join(configHome, "quick", "config.json"));
});

test("quick config set remote creates config and quick config get remote reads it", async () => {
  const setResult = await runCli(["config", "set", "remote", "https://quick.example.com"]);
  const getResult = await runCli(["config", "get", "remote"]);
  const configFile = await readFile(join(configHome, "quick", "config.json"), "utf8");

  expect(setResult.exitCode).toBe(0);
  expect(setResult.stdout).toContain("remote = https://quick.example.com");
  expect(getResult.exitCode).toBe(0);
  expect(getResult.stdout.trim()).toBe("https://quick.example.com");
  expect(JSON.parse(configFile)).toEqual({ remote: "https://quick.example.com" });
});

test("quick deploy validates inputs and resolves remote from config", async () => {
  await runCli(["config", "set", "remote", "https://quick.example.com"]);
  const siteDir = await mkdtemp(join(tmpdir(), "quick-cli-site-"));
  await writeFile(join(siteDir, "index.html"), "<!doctype html><title>Test</title>");

  try {
    const result = await runCli(["deploy", siteDir, "fun", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Remote: https://quick.example.com");
    expect(result.stdout).toContain("Site: fun");
    expect(result.stdout).toContain(`Directory: ${siteDir}`);
    expect(result.stdout).toContain("Dry run complete. Upload skipped.");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }
});

test("quick deploy resolves remote from QUICK_DOMAIN", async () => {
  const siteDir = await mkdtemp(join(tmpdir(), "quick-cli-site-"));
  await writeFile(join(siteDir, "index.html"), "<!doctype html><title>Test</title>");

  try {
    const result = await runCli(["deploy", siteDir, "fun", "--dry-run"], {
      QUICK_REMOTE: undefined,
      QUICK_DOMAIN: "local.example.com",
      QUICK_SCHEME: undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Remote: https://local.example.com");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }
});

test("quick deploy allows QUICK_SCHEME to override the default", async () => {
  const siteDir = await mkdtemp(join(tmpdir(), "quick-cli-site-"));
  await writeFile(join(siteDir, "index.html"), "<!doctype html><title>Test</title>");

  try {
    const result = await runCli(["deploy", siteDir, "fun", "--dry-run"], {
      QUICK_REMOTE: undefined,
      QUICK_DOMAIN: "local.example.com",
      QUICK_SCHEME: "http",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Remote: http://local.example.com");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }
});

test("quick deploy remote flag overrides config", async () => {
  await runCli(["config", "set", "remote", "https://quick.example.com"]);
  const siteDir = await mkdtemp(join(tmpdir(), "quick-cli-site-"));
  await writeFile(join(siteDir, "index.html"), "<!doctype html><title>Test</title>");

  try {
    const result = await runCli(["deploy", siteDir, "fun", "--remote", "https://local.example.com", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Remote: https://local.example.com");
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }
});

test("quick deploy rejects invalid site names", async () => {
  const result = await runCli(["deploy", ".", "Bad_Site"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Invalid site name");
});
