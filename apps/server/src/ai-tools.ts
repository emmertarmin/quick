import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Context } from "hono";
import { Type, type Static, type TSchema } from "typebox";
import type { QuickUser } from "@quick/shared";

export type QuickAiToolSummary = {
  name: string;
  description: string;
  label: string;
};

type QuickAiToolContext = {
  c: Context;
  user: QuickUser;
};

type QuickAiToolFactory<TParameters extends TSchema = TSchema, TDetails = unknown> = {
  name: string;
  description: string;
  label: string;
  parameters: TParameters;
  execute(ctx: QuickAiToolContext, params: Static<TParameters>): Promise<TDetails> | TDetails;
};

function textResult<TDetails>(details: TDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function createTool<TParameters extends TSchema, TDetails>(factory: QuickAiToolFactory<TParameters, TDetails>, ctx: QuickAiToolContext): AgentTool<TParameters, TDetails> {
  return {
    name: factory.name,
    description: factory.description,
    label: factory.label,
    parameters: factory.parameters,
    async execute(_toolCallId, params) {
      return textResult(await factory.execute(ctx, params));
    },
  };
}

function requestOrigin(c: Context) {
  const url = new URL(c.req.url);
  const proto = c.req.header("X-Forwarded-Proto") ?? url.protocol.replace(/:$/, "") ?? "https";
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host") ?? url.host;
  return `${proto}://${host}`;
}

function currentSite(c: Context) {
  const site = c.req.header("X-Quick-Site")?.trim();
  return site || undefined;
}

const quickNativeToolFactories: QuickAiToolFactory[] = [
  {
    name: "quick_currentUser_get",
    label: "Current user",
    description: "Return the authenticated Quick user for this request.",
    parameters: Type.Object({}),
    execute: (ctx) => ({
      authenticated: true,
      user: ctx.user,
    }),
  },
  {
    name: "quick_appContext_get",
    label: "App context",
    description: "Return the current Quick app/site context for this request.",
    parameters: Type.Object({}),
    execute: (ctx) => {
      const origin = requestOrigin(ctx.c);
      const site = currentSite(ctx.c);

      return {
        site: site ?? null,
        origin,
        url: ctx.c.req.url,
        referer: ctx.c.req.header("Referer") ?? null,
        apiBase: "/api",
        features: ["auth", "identity", "ai", "db", "files", "realtime", "sites"],
      };
    },
  },
];

const quickNativeToolNames = new Set(quickNativeToolFactories.map((tool) => tool.name));

export function listQuickAiTools(): QuickAiToolSummary[] {
  return quickNativeToolFactories.map(({ name, description, label }) => ({ name, description, label }));
}

export function isQuickAiToolName(name: string) {
  return quickNativeToolNames.has(name);
}

export function createQuickAiTools(ctx: QuickAiToolContext, names: string[]) {
  const requested = new Set(names);
  return quickNativeToolFactories
    .filter((factory) => requested.has(factory.name))
    .map((factory) => createTool(factory, ctx));
}
