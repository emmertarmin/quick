import { afterEach, expect, test } from "bun:test";
import { createQuickClient } from "../src/index";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("quick.jev.classify posts the exact request body to /api/jev/classify", async () => {
  let captured: { input: string | URL | Request; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({
      model: "jev-latest",
      answers: {
        mood: { type: "choice", choice: "good", probabilities: { good: 0.9, bad: 0.1 }, confidence: 0.9 },
        score: { type: "score", score: 0.4, confidence: 0.5 },
        yes: { type: "bool", probability: 0.6 },
      },
      usage: { inputTokens: 8, outputTokens: 2 },
    });
  };

  const request = {
    state: { text: "hello" },
    questions: {
      mood: { type: "choice" as const, instructions: "Overall mood?", criteria: { good: "Good", bad: "Bad" } },
      score: { type: "score" as const, instructions: "How good?", criteria: ["low", "high"] },
      yes: { type: "bool" as const, instructions: "Positive?", criteria: { true: "Yes", false: "No" } },
    },
  };

  const result = await createQuickClient({ baseUrl: "/api" }).jev.classify(request);
  expect(captured?.input).toBe("/api/jev/classify");
  expect(captured?.init?.method).toBe("POST");
  expect(captured?.init?.body).toBe(JSON.stringify(request));
  expect(new Headers(captured?.init?.headers).get("content-type")).toBe("application/json");
  expect(result).toEqual({
    model: "jev-latest",
    answers: {
      mood: { type: "choice", choice: "good", probabilities: { good: 0.9, bad: 0.1 }, confidence: 0.9 },
      score: { type: "score", score: 0.4, confidence: 0.5 },
      yes: { type: "bool", probability: 0.6 },
    },
    usage: { inputTokens: 8, outputTokens: 2 },
  });
});
