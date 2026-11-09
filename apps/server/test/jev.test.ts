import { describe, expect, test } from "bun:test";
import type { QuickJevClassifyRequest, QuickJevQuestion } from "@quick/shared";
import { JEV_MAX_RESPONSE_BYTES, JevError, classifyWithJev, createJevLimiter } from "../src/jev";

const config = { apiKey: "test-key", model: "jev-test", baseUrl: "https://typesafe.test/v1/" };

const questions = {
  pick: { type: "choice", instructions: "Pick one", criteria: { alpha: "Alpha", beta: "Beta" } },
  rating: { type: "score", instructions: "Rate it", criteria: ["low", "high"] },
  yes: { type: "bool", instructions: "Is it?", criteria: { true: "Yes", false: "No" } },
} satisfies Record<string, QuickJevQuestion>;

function classifyRequest(): QuickJevClassifyRequest {
  return { state: { text: "hello" }, questions };
}

function captureFetch(respond: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ input, init });
    return respond(input, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const validPayload = {
  answers: {
    pick: { type: "choice", choice: "alpha", probabilities: { alpha: 0.7, beta: 0.3 }, confidence: 0.9 },
    rating: { type: "score", score: 0.25, confidence: 0.5 },
    yes: { type: "noul", noul: 0.8 },
  },
  usage: { input_tokens: 12, output_tokens: 4 },
};

describe("classifyWithJev request mapping", () => {
  test("posts the model, state, and normalized questions to the systemone endpoint", async () => {
    const { calls, fetchImpl } = captureFetch(() => Response.json(validPayload));
    const response = await classifyWithJev(classifyRequest(), config, { fetch: fetchImpl });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(String(call.input)).toBe("https://typesafe.test/v1/systemone");
    expect(call.init?.method).toBe("POST");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(call.init?.redirect).toBe("error");
    expect(headers.get("content-type")).toBe("application/json");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "jev-test",
      state: { text: "hello" },
      questions: {
        pick: { type: "choice", instructions: "Pick one", criteria: { alpha: "Alpha", beta: "Beta" } },
        rating: { type: "score", instructions: "Rate it", criteria: ["low", "high"] },
        yes: { type: "noul", instructions: "Is it?", criteria: { true: "Yes", false: "No" } },
      },
    });

    expect(response).toEqual({
      model: "jev-test",
      answers: {
        pick: { type: "choice", choice: "alpha", probabilities: { alpha: 0.7, beta: 0.3 }, confidence: 0.9 },
        rating: { type: "score", score: 0.25, confidence: 0.5 },
        yes: { type: "bool", probability: 0.8 },
      },
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  test("normalizes a base URL without a trailing slash", async () => {
    const { calls, fetchImpl } = captureFetch(() => Response.json(validPayload));
    await classifyWithJev(classifyRequest(), { ...config, baseUrl: "https://typesafe.test/v1" }, { fetch: fetchImpl });
    expect(String(calls[0]!.input)).toBe("https://typesafe.test/v1/systemone");
  });

  test("omits usage when the upstream response has none and drops extra answer ids", async () => {
    const { fetchImpl } = captureFetch(() => Response.json({
      answers: { ...validPayload.answers, extra: { type: "score", score: 1, confidence: 1 } },
    }));
    const response = await classifyWithJev(classifyRequest(), config, { fetch: fetchImpl });
    expect(response).not.toHaveProperty("usage");
    expect(Object.keys(response.answers).sort()).toEqual(["pick", "rating", "yes"]);
  });
});

describe("classifyWithJev response validation", () => {
  const invalidPayloads: Array<[string, unknown]> = [
    ["a missing answer", { answers: { pick: validPayload.answers.pick, rating: validPayload.answers.rating } }],
    ["a wrong answer type", { answers: { ...validPayload.answers, rating: { type: "choice", choice: "low", probabilities: {}, confidence: 1 } } }],
    ["a choice outside the criteria", { answers: { ...validPayload.answers, pick: { ...validPayload.answers.pick, choice: "gamma" } } }],
    ["an unknown probability key", { answers: { ...validPayload.answers, pick: { ...validPayload.answers.pick, probabilities: { alpha: 1, gamma: 0 } } } }],
    ["a non-finite probability", { answers: { ...validPayload.answers, pick: { ...validPayload.answers.pick, probabilities: { alpha: null } } } }],
    ["a non-finite score", { answers: { ...validPayload.answers, rating: { type: "score", score: "high", confidence: 1 } } }],
    ["a non-record answers field", { answers: [] }],
  ];

  test.each(invalidPayloads)("rejects %s with a 502", async (_label, payload) => {
    const { fetchImpl } = captureFetch(() => Response.json(payload));
    const error = await classifyWithJev(classifyRequest(), config, { fetch: fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevError);
    expect(error).toMatchObject({ status: 502, message: "Jev returned an invalid response" });
  });

  test("rejects a non-JSON upstream body", async () => {
    const { fetchImpl } = captureFetch(() => new Response("not json", { status: 200 }));
    await expect(classifyWithJev(classifyRequest(), config, { fetch: fetchImpl }))
      .rejects.toMatchObject({ status: 502, message: "Jev returned an invalid response" });
  });

  test("rejects responses above the size limit", async () => {
    const oversized = captureFetch(() => new Response("x".repeat(JEV_MAX_RESPONSE_BYTES + 1), { status: 200 }));
    const error = await classifyWithJev(classifyRequest(), config, { fetch: oversized.fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevError);
    expect(error).toMatchObject({ status: 502 });

    const declared = captureFetch(() => new Response("{}", {
      status: 200,
      headers: { "content-length": String(JEV_MAX_RESPONSE_BYTES + 1) },
    }));
    await expect(classifyWithJev(classifyRequest(), config, { fetch: declared.fetchImpl })).rejects.toMatchObject({ status: 502 });
  });
});

describe("classifyWithJev upstream failures", () => {
  test("maps a non-2xx status to 502 without leaking the upstream body or key", async () => {
    const { fetchImpl } = captureFetch(() => new Response("upstream-secret-detail", { status: 500 }));
    const error = await classifyWithJev(classifyRequest(), config, { fetch: fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevError);
    expect(error).toMatchObject({ status: 502, message: "Jev classification failed (upstream status 500)" });
    expect((error as Error).message).not.toContain("upstream-secret-detail");
    expect((error as Error).message).not.toContain("test-key");
  });

  test("maps a timeout to 504", async () => {
    const { fetchImpl } = captureFetch(() => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    await expect(classifyWithJev(classifyRequest(), config, { fetch: fetchImpl }))
      .rejects.toMatchObject({ status: 504, message: "Jev classification timed out" });
  });

  test("maps a network failure to 502 without leaking the cause", async () => {
    const { fetchImpl } = captureFetch(() => {
      throw new Error("socket exploded for test-key");
    });
    const error = await classifyWithJev(classifyRequest(), config, { fetch: fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevError);
    expect(error).toMatchObject({ status: 502, message: "Jev classification failed" });
    expect((error as Error).message).not.toContain("test-key");
  });

  test("maps an unusable base URL to 502", async () => {
    const { fetchImpl } = captureFetch(() => Response.json(validPayload));
    await expect(classifyWithJev(classifyRequest(), { ...config, baseUrl: "not a url" }, { fetch: fetchImpl }))
      .rejects.toMatchObject({ status: 502 });
  });
});

describe("Jev limiter", () => {
  test("enforces the per-actor request window", () => {
    const limiter = createJevLimiter({ maxConcurrentPerActor: 10, maxConcurrentGlobal: 10, maxRequestsPerWindow: 2 });
    const first = limiter.acquire("site-a\nuser", "site-a");
    const second = limiter.acquire("site-a\nuser", "site-a");
    first();
    second();
    expect(() => limiter.acquire("site-a\nuser", "site-a")).toThrow("Jev classification rate limit exceeded");
  });

  test("enforces the per-site request budget across users", () => {
    const limiter = createJevLimiter({ maxRequestsPerSite: 2, maxRequestsPerWindow: 10 });
    limiter.acquire("site-a\nuser-1", "site-a")();
    limiter.acquire("site-a\nuser-2", "site-a")();
    expect(() => limiter.acquire("site-a\nuser-3", "site-a")).toThrow("Jev classification rate limit exceeded");
    expect(() => limiter.acquire("site-b\nuser-3", "site-b")).not.toThrow();
  });

  test("enforces per-actor and global concurrency", () => {
    const limiter = createJevLimiter({ maxConcurrentPerActor: 1, maxConcurrentGlobal: 2 });
    const release = limiter.acquire("site-a\nuser", "site-a");
    expect(() => limiter.acquire("site-a\nuser", "site-a")).toThrow("Too many concurrent Jev classifications");
    const releaseOther = limiter.acquire("site-a\nother", "site-a");
    expect(() => limiter.acquire("site-b\nthird", "site-b")).toThrow("Too many concurrent Jev classifications");
    release();
    releaseOther();
    expect(() => limiter.acquire("site-a\nuser", "site-a")).not.toThrow();
  });

  test("resets windows after the window expires and ignores duplicate releases", () => {
    let now = 0;
    const limiter = createJevLimiter({ maxRequestsPerWindow: 1, maxRequestsPerSite: 1, now: () => now, windowMs: 100 });
    const release = limiter.acquire("site-a\nuser", "site-a");
    release();
    release();
    expect(() => limiter.acquire("site-a\nuser", "site-a")).toThrow(JevError);
    now = 100;
    expect(() => limiter.acquire("site-a\nuser", "site-a")).not.toThrow();
  });
});
