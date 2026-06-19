import type { CommandDefinition } from "../cli/types.js";
import { resolveRemote } from "../config/remote.js";
import type { QuickSiteStats } from "../api-types.js";

const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function validateSiteName(site: string) {
  if (!siteNamePattern.test(site)) {
    throw new Error("Invalid site name. Use lowercase letters, numbers, and hyphens; start and end with a letter or number.");
  }
}

function statsApiUrl(remote: string, site: string, top: number) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}/sites/${encodeURIComponent(site)}/stats`.replace(/\/+/g, "/");
  url.searchParams.set("top", String(top));
  return url.toString();
}

async function fetchStats(remote: string, site: string, top: number) {
  const response = await fetch(statsApiUrl(remote, site, top));
  const text = await response.text();
  let body: unknown;

  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = { error: text };
  }

  if (!response.ok) {
    const error = typeof body === "object" && body && "error" in body ? String(body.error) : `${response.status} ${response.statusText}`;
    throw new Error(`Stats failed: ${error}`);
  }

  return body as QuickSiteStats;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function userLabel(user: { id: string; email?: string; name?: string } | undefined) {
  if (!user) return "—";
  return user.email ?? user.name ?? user.id;
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function mdTable(headers: string[], rows: string[][]) {
  if (rows.length === 0) return "_None._\n";
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n") + "\n";
}

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

function color(open: string, close: string, value: string) {
  if (process.env.NO_COLOR || process.env.TERM === "dumb") return value;
  return `${open}${value}${close}`;
}

function shouldRenderMarkdownForTerminal() {
  return process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
}

function stripAnsi(value: string) {
  return value.replace(new RegExp(String.raw`\x1b\[[0-9;]*m`, "g"), "");
}

function padVisual(value: string, width: number) {
  const visibleLength = stripAnsi(value).length;
  return `${value}${" ".repeat(Math.max(0, width - visibleLength))}`;
}

function renderMarkdownForTerminal(markdown: string) {
  let tableHeader = false;

  return Bun.markdown.render(
    markdown,
    {
      heading(children: string, meta: { level: number }) {
        const prefix = meta.level === 1 ? "# " : `${"#".repeat(meta.level)} `;
        const style = meta.level === 1 ? `${ansi.bold}${ansi.underline}${ansi.cyan}` : `${ansi.bold}${ansi.cyan}`;
        return `\n${color(style, ansi.reset, `${prefix}${children}`)}\n`;
      },
      paragraph(children: string) {
        return `${children}\n`;
      },
      strong(children: string) {
        return color(ansi.bold, "\x1b[22m", children);
      },
      emphasis(children: string) {
        return color(ansi.italic, "\x1b[23m", children);
      },
      codespan(children: string) {
        return color(ansi.yellow, ansi.reset, children);
      },
      list(children: string) {
        return `${children}\n`;
      },
      listItem(children: string) {
        return `  ${color(ansi.gray, ansi.reset, "•")} ${children.trim()}\n`;
      },
      table(children: string) {
        return `${children}\n`;
      },
      thead(children: string) {
        tableHeader = true;
        const rendered = children;
        tableHeader = false;
        return rendered;
      },
      tbody(children: string) {
        return children;
      },
      tr(children: string) {
        return `${children.replace(/\s+$/g, "")}\n`;
      },
      th(children: string) {
        return `${color(ansi.bold, "\x1b[22m", padVisual(children, 24))} `;
      },
      td(children: string) {
        const value = tableHeader ? color(ansi.bold, "\x1b[22m", children) : children;
        return `${padVisual(value, 24)} `;
      },
    },
    { tables: true, strikethrough: true },
  ).replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function list(values: string[]) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "—";
}

function formatMarkdown(stats: QuickSiteStats) {
  const lines: string[] = [];
  const api = stats.source.apiUsage;

  lines.push(`# Quick site stats: ${stats.site}`);
  lines.push("");

  if (!stats.exists) {
    lines.push(`Site \`${stats.site}\` does not exist.`);
    lines.push("");
    lines.push(`URL checked: ${stats.url}`);
    lines.push(`Inspected: ${formatDate(stats.inspectedAt)}`);
    return lines.join("\n");
  }

  lines.push(`- URL: ${stats.url}`);
  lines.push(`- Exists: ${yesNo(stats.exists)}`);
  lines.push(`- Index: ${yesNo(stats.hasIndex)}`);
  lines.push(`- Inspected: ${formatDate(stats.inspectedAt)}`);
  lines.push("");

  lines.push("## Deployment");
  if (stats.deployment) {
    lines.push(`- Last deployed: ${formatDate(stats.deployment.lastDeployedAt)}`);
    lines.push(`- Last deployer: ${userLabel(stats.deployment.lastDeployedBy)}`);
    lines.push(`- Recorded deployed files: ${stats.deployment.fileCount}`);
  } else {
    lines.push("_No deploy metadata._");
  }
  lines.push(`- Source size: ${formatBytes(stats.source.totalBytes)}`);
  lines.push("");

  lines.push("## Source");
  lines.push(`- Files: ${stats.source.fileCount}`);
  lines.push(`- Directories: ${stats.source.directoryCount}`);
  lines.push(`- Text files: ${stats.source.textFileCount}`);
  lines.push(`- Binary files: ${stats.source.binaryFileCount}`);
  lines.push(`- Lines: ${stats.source.lineCount}`);
  lines.push("");
  lines.push("### By type");
  lines.push(mdTable(["Type", "Files", "Bytes", "Lines"], stats.source.extensions.map((item) => [item.extension, String(item.files), formatBytes(item.bytes), String(item.lines)])));
  lines.push("### Largest deployed files");
  lines.push(mdTable(["Path", "Bytes"], stats.source.largestFiles.map((file) => [`\`${file.path}\``, formatBytes(file.bytes)])));

  lines.push("## Quick API usage detected in source");
  lines.push(mdTable(["API", "Detected", "Detail"], [
    ["SDK import", yesNo(api.sdkImport), api.sdkImport ? "`/quick.js` or `createQuickClient`" : ""],
    ["DB", yesNo(api.collections.length > 0), list(api.collections)],
    ["Files", yesNo(api.usesFiles), ""],
    ["Realtime channels", yesNo(api.realtimeChannels.length > 0), list(api.realtimeChannels)],
    ["Realtime presence", yesNo(api.realtimePresence.length > 0), list(api.realtimePresence)],
    ["Identity", yesNo(api.usesIdentity), ""],
    ["Auth", yesNo(api.usesAuth), ""],
  ]));

  lines.push("## Database");
  lines.push(`- Collections: ${stats.database.userCollectionCount} user, ${stats.database.internalCollectionCount} internal`);
  lines.push(`- Documents: ${stats.database.documentCount}`);
  lines.push(`- Approx data size: ${formatBytes(stats.database.approxBytes)}`);
  lines.push("");
  lines.push(mdTable(["Collection", "Docs", "Bytes", "Oldest", "Newest", "Internal"], stats.database.collections.map((collection) => [
    `\`${collection.collection}\``,
    String(collection.documentCount),
    formatBytes(collection.approxBytes),
    formatDate(collection.oldestCreatedAt),
    formatDate(collection.newestUpdatedAt),
    yesNo(collection.internal),
  ])));

  lines.push("## Files");
  lines.push(`- Uploaded files: ${stats.files.count}`);
  lines.push(`- Uploaded bytes: ${formatBytes(stats.files.bytes)}`);
  lines.push(`- Missing blobs: ${stats.files.missingBlobs.length}`);
  lines.push(`- Orphan blobs: ${stats.files.orphanBlobs.length}`);
  lines.push("");
  lines.push("### By content type");
  lines.push(mdTable(["Content type", "Files", "Bytes"], stats.files.contentTypes.map((item) => [item.contentType, String(item.files), formatBytes(item.bytes)])));
  lines.push("### Largest uploads");
  lines.push(mdTable(["Name", "Type", "Bytes", "Created"], stats.files.largest.map((file) => [`\`${file.name}\``, file.content_type, formatBytes(file.size), formatDate(file.created_at)])));

  lines.push("## Health");
  lines.push(mdTable(["Status", "Check", "Count"], stats.health.checks.map((check) => [check.status === "ok" ? "✓" : "!", check.name, check.count === undefined ? "" : String(check.count)])));

  return lines.join("\n");
}

export const statsCommand: CommandDefinition = {
  name: "stats",
  summary: "Show stats for a site",
  description: "Inspect deployment, source, database, uploaded-file, and health stats for a Quick site.",
  flags: [
    {
      name: "remote",
      type: "string",
      description: "Quick server URL. Overrides QUICK_REMOTE and config remote.",
    },
    {
      name: "json",
      type: "boolean",
      description: "Print machine-readable JSON instead of markdown.",
    },
    {
      name: "top",
      type: "string",
      description: "Number of largest/top items to show. Defaults to 10.",
      defaultValue: "10",
    },
  ],
  arguments: [
    {
      name: "site",
      description: "Site name to inspect",
      required: true,
    },
  ],
  examples: ["quick stats chat", "quick stats gallery --json", "quick stats todo --top 20"],
  execute: async ({ values, positionals }) => {
    const [site, extra] = positionals;
    if (site === undefined) throw new Error("Missing argument. Usage: quick stats <site>");
    if (extra !== undefined) throw new Error("Too many arguments. Usage: quick stats <site>");

    validateSiteName(site);
    const top = Number(values.top ?? 10);
    if (!Number.isFinite(top) || top < 1) throw new Error("--top must be a positive number");

    const remote = await resolveRemote({ remoteFlag: values.remote });
    const stats = await fetchStats(remote, site, Math.trunc(top));

    if (values.json === true) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      const markdown = formatMarkdown(stats);
      console.log(shouldRenderMarkdownForTerminal() ? renderMarkdownForTerminal(markdown) : markdown);
    }
  },
};
