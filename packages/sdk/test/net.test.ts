import { afterEach, expect, test } from "bun:test";
import { createQuickClient } from "../src/index";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("quick.net.fetch sends only the URL in a POST body", async () => {
  let captured: { input: string | URL | Request; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({
      url: "https://example.org/feed.xml",
      status: 200,
      headers: { "content-type": "application/rss+xml" },
      body: "<rss/>",
    });
  };

  const result = await createQuickClient({ baseUrl: "/api" }).net.fetch(new URL("https://example.org/feed.xml"));
  expect(captured?.input).toBe("/api/net/fetch");
  expect(captured?.init?.method).toBe("POST");
  expect(captured?.init?.body).toBe(JSON.stringify({ url: "https://example.org/feed.xml" }));
  expect(new Headers(captured?.init?.headers).get("content-type")).toBe("application/json");
  expect(result.status).toBe(200);
  expect(result.body).toBe("<rss/>");
});
