import { describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { QuickNetFetchResponse } from "@quick/shared";
import { registerNetRoutes } from "../src/routes/net";

const headers = {
  "Content-Type": "application/json",
  "X-Quick-Site": "test-site",
};

function createApp() {
  const app = new OpenAPIHono();
  const requested: string[] = [];
  registerNetRoutes(app, {
    isDeployedSite: async () => true,
    readAuthSession: async () => ({ user: { id: "test-user" } }),
    fetchPublicTextResource: async (url) => {
      requested.push(url);
      return {
        url,
        status: 200,
        headers: { "content-type": "application/rss+xml" },
        body: "<rss/>",
      } satisfies QuickNetFetchResponse;
    },
  });
  return { app, requested };
}

describe("POST /net/fetch", () => {
  test("uses the JSON body validated by the registered OpenAPI route", async () => {
    const { app, requested } = createApp();
    const response = await app.request("/net/fetch", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://lucumr.pocoo.org/feed.xml" }),
    });

    expect(response.status).toBe(200);
    expect(requested).toEqual(["https://lucumr.pocoo.org/feed.xml"]);
    expect(await response.json()).toMatchObject({ status: 200, body: "<rss/>" });
  });

  test("rejects a non-object JSON body through OpenAPI validation", async () => {
    const { app, requested } = createApp();
    const response = await app.request("/net/fetch", {
      method: "POST",
      headers,
      body: JSON.stringify("https://lucumr.pocoo.org/feed.xml"),
    });

    expect(response.status).toBe(400);
    expect(requested).toHaveLength(0);
  });

  test("rejects request bodies larger than 8 KiB before validation", async () => {
    const { app, requested } = createApp();
    const response = await app.request("/net/fetch", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://example.com/", padding: "x".repeat(8 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body is too large" });
    expect(requested).toHaveLength(0);
  });
});
