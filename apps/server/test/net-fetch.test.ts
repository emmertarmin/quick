import { describe, expect, test } from "bun:test";
import {
  NET_FETCH_MAX_BYTES,
  NetFetchError,
  createNetFetchLimiter,
  fetchPublicTextResource,
  isAllowedTextContentType,
  isPublicIp,
  validateNetFetchUrl,
  type NetFetchDependencies,
} from "../src/net-fetch";

function body(text: string): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(text);
    },
  };
}

function dependencies(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  const requested: string[] = [];
  const deps: NetFetchDependencies = {
    async resolve(hostname) {
      if (hostname === "127.0.0.1") return [{ address: "127.0.0.1", family: 4 }];
      if (hostname === "::1") return [{ address: "::1", family: 6 }];
      if (hostname === "quick-alias.example") return [{ address: "8.8.8.8", family: 4 }];
      if (hostname === "private.example") return [{ address: "10.0.0.1", family: 4 }];
      if (hostname === "mixed.example") return [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
      return [{ address: "93.184.216.34", family: 4 }];
    },
    async blockedAddresses() {
      return ["8.8.8.8"];
    },
    async request(url, address) {
      requested.push(`${url.toString()}@${address.address}`);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return { status: response.status, headers: new Headers(response.headers), body: body(response.body ?? "") };
    },
  };
  return { deps, requested };
}

describe("rate and concurrency limiter", () => {
  test("releases active permits correctly when a request spans a rate window", () => {
    let now = 0;
    const limiter = createNetFetchLimiter({ now: () => now, windowMs: 100, maxRequestsPerWindow: 10 });
    const releaseFirst = limiter.acquire("actor");
    now = 100;
    const releaseSecond = limiter.acquire("actor");
    releaseFirst();
    const releaseThird = limiter.acquire("actor");
    expect(() => limiter.acquire("actor")).toThrow(NetFetchError);
    releaseSecond();
    releaseThird();
    expect(() => {
      const release = limiter.acquire("actor");
      release();
      release();
    }).not.toThrow();
  });
});

describe("public IP policy", () => {
  test.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "198.51.100.4", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "4000::1", "ff02::1"])("rejects %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  test.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])("permits %s", (address) => {
    expect(isPublicIp(address)).toBe(true);
  });
});

describe("URL and content policy", () => {
  test.each(["http://example.com", "https://user:pass@example.com", "https://example.com:8443", "https://quick.example", "https://app.quick.example"])("rejects %s", (url) => {
    expect(() => validateNetFetchUrl(url, "quick.example")).toThrow(NetFetchError);
  });

  test.each(["application/rss+xml", "application/problem+json", "text/calendar; charset=utf-8", "text/csv", "text/html"])("permits %s", (type) => {
    expect(isAllowedTextContentType(type)).toBe(true);
  });

  test.each(["image/png", "application/octet-stream", "application/pdf", "text/event-stream"])("rejects %s", (type) => {
    expect(isAllowedTextContentType(type)).toBe(false);
  });
});

describe("fetchPublicTextResource", () => {
  test("manually follows and revalidates each redirect, returning upstream HTTP errors", async () => {
    const { deps, requested } = dependencies([
      { status: 302, headers: { location: "https://other.example/feed" } },
      { status: 404, headers: { "content-type": "application/rss+xml", etag: "abc", "set-cookie": "secret=x" }, body: "<rss/>" },
    ]);
    const result = await fetchPublicTextResource("https://public.example/start", "quick.example", deps);
    expect(requested).toEqual([
      "https://public.example/start@93.184.216.34",
      "https://other.example/feed@93.184.216.34",
    ]);
    expect(result).toEqual({
      url: "https://other.example/feed",
      status: 404,
      headers: { "content-type": "application/rss+xml", etag: "abc" },
      body: "<rss/>",
    });
    expect(result.headers).not.toHaveProperty("set-cookie");
  });

  test.each(["private.example", "mixed.example"])("rejects when any DNS result for %s is non-public", async (hostname) => {
    const { deps, requested } = dependencies([]);
    await expect(fetchPublicTextResource(`https://${hostname}/`, "quick.example", deps)).rejects.toMatchObject({ status: 403 });
    expect(requested).toHaveLength(0);
  });

  test("rejects a public alias of a current Quick infrastructure address", async () => {
    const { deps, requested } = dependencies([]);
    await expect(fetchPublicTextResource("https://quick-alias.example/", "quick.example", deps)).rejects.toMatchObject({ status: 403 });
    expect(requested).toHaveLength(0);
  });

  test("revalidates a redirect before making the next request", async () => {
    const { deps, requested } = dependencies([{ status: 302, headers: { location: "https://127.0.0.1/metadata" } }]);
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", deps)).rejects.toMatchObject({ status: 403 });
    expect(requested).toHaveLength(1);
  });

  test("refreshes Quick infrastructure addresses before every redirect hop", async () => {
    let blockedChecks = 0;
    const { deps, requested } = dependencies([{ status: 302, headers: { location: "https://quick-alias.example/" } }]);
    deps.blockedAddresses = async () => ++blockedChecks === 1 ? [] : ["8.8.8.8"];
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", deps)).rejects.toMatchObject({ status: 403 });
    expect(blockedChecks).toBe(2);
    expect(requested).toHaveLength(1);
  });

  test("normalizes bracketed IPv6 literals before address validation", async () => {
    const { deps, requested } = dependencies([]);
    await expect(fetchPublicTextResource("https://[::1]/", "quick.example", deps)).rejects.toMatchObject({ status: 403 });
    expect(requested).toHaveLength(0);
  });

  test("enforces the body limit while reading", async () => {
    const { deps } = dependencies([{ status: 200, headers: { "content-type": "text/plain" }, body: "x".repeat(NET_FETCH_MAX_BYTES + 1) }]);
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", deps)).rejects.toMatchObject({ status: 413 });
  });

  test("maps unknown declared charsets to an unsupported-text error", async () => {
    const { deps } = dependencies([{ status: 200, headers: { "content-type": "text/plain; charset=not-a-real-charset" }, body: "hello" }]);
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", deps)).rejects.toMatchObject({ status: 415 });
  });

  test("rejects compressed, binary-typed, and binary-looking responses", async () => {
    const compressed = dependencies([{ status: 200, headers: { "content-type": "text/plain", "content-encoding": "gzip" } }]);
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", compressed.deps)).rejects.toMatchObject({ status: 415 });
    const binary = dependencies([{ status: 200, headers: { "content-type": "image/png" } }]);
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", binary.deps)).rejects.toMatchObject({ status: 415 });
    const mislabeled = dependencies([{ status: 200, headers: { "content-type": "text/plain" }, body: "text\0binary" }]);
    await expect(fetchPublicTextResource("https://public.example/", "quick.example", mislabeled.deps)).rejects.toMatchObject({ status: 415 });
  });
});
