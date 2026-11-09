import { describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { QuickJevClassifyRequest, QuickJevClassifyResponse } from "@quick/shared";
import { createJevLimiter } from "../src/jev";
import { registerJevRoutes } from "../src/routes/jev";

const headers = {
  "Content-Type": "application/json",
  "X-Quick-Site": "test-site",
};

type JevOverrides = NonNullable<Parameters<typeof registerJevRoutes>[1]>;

const validBody = {
  state: { text: "hello" },
  questions: {
    mood: { type: "choice", instructions: "Overall mood?", criteria: { good: "Good", bad: "Bad" } },
    score: { type: "score", instructions: "How good?", criteria: ["low", "high"] },
    yes: { type: "bool", instructions: "Positive?", criteria: { true: "Yes", false: "No" } },
  },
};

const validResponse: QuickJevClassifyResponse = {
  model: "jev-test",
  answers: {
    mood: { type: "choice", choice: "good", probabilities: { good: 0.8, bad: 0.2 }, confidence: 0.8 },
    score: { type: "score", score: 0.5, confidence: 0.6 },
    yes: { type: "bool", probability: 0.75 },
  },
  usage: { inputTokens: 10, outputTokens: 3 },
};

function createApp(overrides: JevOverrides = {}) {
  const app = new OpenAPIHono();
  const classified: QuickJevClassifyRequest[] = [];
  registerJevRoutes(app, {
    isDeployedSite: async () => true,
    readAuthSession: async () => ({ user: { id: "test-user" } }),
    config: { apiKey: "test-key", model: "jev-test", baseUrl: "https://typesafe.test/v1/" },
    classify: async (request) => {
      classified.push(request);
      return validResponse;
    },
    ...overrides,
  });
  return { app, classified };
}

function post(app: OpenAPIHono, body: unknown, requestHeaders: Record<string, string> = headers) {
  return app.request("/jev/classify", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

describe("POST /jev/classify", () => {
  test("classifies a valid request and returns the structured answers", async () => {
    const { app, classified } = createApp();
    const response = await post(app, validBody);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(validResponse);
    expect(classified).toHaveLength(1);
    expect(classified[0]).toMatchObject({ state: { text: "hello" }, questions: validBody.questions });
  });

  test("rejects a missing or invalid site context", async () => {
    const { app, classified } = createApp();
    for (const site of [undefined, "Bad_Site", "bad site"]) {
      const requestHeaders = { ...headers, "X-Quick-Site": site ?? "" };
      const response = await post(app, validBody, requestHeaders);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "A valid Quick site context is required" });
    }
    expect(classified).toHaveLength(0);
  });

  test("rejects a site without a deployment", async () => {
    const { app, classified } = createApp({ isDeployedSite: async () => false });
    const response = await post(app, validBody);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "A deployed Quick site context is required" });
    expect(classified).toHaveLength(0);
  });

  test("requires an authenticated session", async () => {
    const { app, classified } = createApp({ readAuthSession: async () => undefined });
    const response = await post(app, validBody);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(classified).toHaveLength(0);
  });

  test("returns 503 while the classifier is not configured", async () => {
    const { app, classified } = createApp({ config: undefined });
    const response = await post(app, validBody);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Jev classification is not configured" });
    expect(classified).toHaveLength(0);
  });

  test("rejects bodies larger than 64 KiB before validation", async () => {
    const { app, classified } = createApp();
    const response = await post(app, { ...validBody, padding: "x".repeat(64 * 1024) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body is too large" });
    expect(classified).toHaveLength(0);
  });

  test("rejects invalid questions and unknown fields", async () => {
    const { app, classified } = createApp();
    const invalidBodies: unknown[] = [
      { state: {}, questions: { mood: { type: "choice", instructions: "Mood?", criteria: { good: "Good" } } } },
      { state: {}, questions: { mood: { type: "choice", instructions: "", criteria: { good: "Good", bad: "Bad" } } } },
      { state: {}, questions: { score: { type: "score", instructions: "How good?", criteria: ["only"] } } },
      { state: {}, questions: { yes: { type: "bool", instructions: "Positive?", criteria: { true: "Yes" } } } },
      { state: {}, questions: { mood: { type: "choice", instructions: "Mood?", criteria: { good: "Good", bad: "Bad" }, images: [] } } },
      { ...validBody, model: "jev-other" },
      { ...validBody, apiKey: "leak" },
      { state: [], questions: validBody.questions },
      { state: {}, questions: {} },
      {
        state: {},
        questions: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
          `q${index}`,
          { type: "bool", instructions: "Yes?", criteria: { true: "Yes", false: "No" } },
        ])),
      },
    ];
    for (const body of invalidBodies) {
      const response = await post(app, body);
      expect(response.status).toBe(400);
    }
    expect(classified).toHaveLength(0);
  });

  test("bounds state nesting depth at 32 levels", async () => {
    const { app, classified } = createApp();
    function nested(wrappers: number) {
      let value: unknown = { leaf: true };
      for (let index = 0; index < wrappers; index += 1) value = { nested: value };
      return { state: value as Record<string, unknown>, questions: validBody.questions };
    }

    expect((await post(app, nested(31))).status).toBe(200);
    expect((await post(app, nested(32))).status).toBe(400);
    expect(classified).toHaveLength(1);
  });

  test("rejects hostile deep nesting with 400 instead of overflowing the stack", async () => {
    const { app, classified } = createApp();
    const depth = 30_000;
    const state = `{"deep":${"[".repeat(depth)}${"]".repeat(depth)}}`;
    const response = await app.request("/jev/classify", {
      method: "POST",
      headers,
      body: `{"state":${state},"questions":${JSON.stringify(validBody.questions)}}`,
    });
    expect(response.status).toBe(400);
    expect(classified).toHaveLength(0);
  });

  test("rate limits repeated classifications", async () => {
    const { app, classified } = createApp({ limiter: createJevLimiter({ maxRequestsPerWindow: 1 }) });
    expect((await post(app, validBody)).status).toBe(200);
    const response = await post(app, validBody);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Jev classification rate limit exceeded" });
    expect(classified).toHaveLength(1);
  });
});
