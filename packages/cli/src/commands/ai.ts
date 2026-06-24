import type { QuickAiToolsResponse } from "../api-types.js";
import type { CommandDefinition } from "../cli/types.js";
import { loadAuthForRemote, refreshAuthFromResponse } from "./auth.js";
import { resolveRemote } from "../config/remote.js";

function apiUrl(remote: string, path: string) {
  const url = new URL(remote);
  const basePath = url.pathname.replace(/\/+$/, "");
  const apiBasePath = basePath.endsWith("/api") || basePath === "/api" ? basePath : `${basePath}/api`;
  url.pathname = `${apiBasePath}${path}`.replace(/\/+/g, "/");
  return url.toString();
}

async function readJsonResponse(response: Response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) as unknown : undefined;
  } catch {
    return { error: text };
  }
}

async function fetchAiTools(remote: string) {
  const auth = await loadAuthForRemote(remote);
  const response = await fetch(apiUrl(remote, "/ai/tools"), {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "X-Quick-Refresh-Token": auth.refreshToken,
    },
  });
  await refreshAuthFromResponse(remote, auth, response);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    const error = typeof body === "object" && body && "error" in body ? String(body.error) : `${response.status} ${response.statusText}`;
    throw new Error(`AI tools failed: ${error}`);
  }

  return body as QuickAiToolsResponse;
}

function formatParameters(parameters: Record<string, unknown>) {
  return JSON.stringify(parameters, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function formatTools(response: QuickAiToolsResponse) {
  if (response.tools.length === 0) {
    return "No Quick AI tools are currently available.";
  }

  const lines = ["Quick AI tools", ""];

  for (const tool of response.tools) {
    lines.push(`- ${tool.name}`);
    lines.push(`  Label: ${tool.label}`);
    lines.push(`  Description: ${tool.description}`);
    lines.push("  Parameters:");
    lines.push(formatParameters(tool.parameters));
    lines.push("");
  }

  lines.push("Use tool names in quick.ai.agent({ tools: [...] }).");
  return lines.join("\n").trimEnd();
}

const toolsCommand: CommandDefinition = {
  name: "tools",
  summary: "List available Quick AI agent tools",
  description: "Fetch the runtime list of available Quick AI agent tools, including parameter schemas, so clients can choose which tools to pass to quick.ai.agent({ tools }).",
  flags: [
    {
      name: "remote",
      type: "string",
      description: "Quick server URL. Overrides QUICK_REMOTE and config remote.",
    },
    {
      name: "json",
      type: "boolean",
      description: "Print machine-readable JSON instead of a human-readable list.",
    },
  ],
  examples: ["quick ai tools", "quick ai tools --json", "quick ai tools --remote https://quick.example.com"],
  execute: async ({ values, positionals }) => {
    const [extra] = positionals;
    if (extra !== undefined) throw new Error("Too many arguments. Usage: quick ai tools");

    const remote = await resolveRemote({ remoteFlag: values.remote });
    const response = await fetchAiTools(remote);

    if (values.json === true) {
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.log(formatTools(response));
    }
  },
};

export const aiCommand: CommandDefinition = {
  name: "ai",
  summary: "Inspect Quick AI capabilities",
  description: "Discover server-side Quick AI capabilities such as agent tools.",
  subcommands: [toolsCommand],
};
