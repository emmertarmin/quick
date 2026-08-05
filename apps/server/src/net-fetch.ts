import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

export const NET_FETCH_MAX_BYTES = 10 * 1024 * 1024;
export const NET_FETCH_MAX_REDIRECTS = 3;
export const NET_FETCH_TIMEOUT_MS = 30_000;

export type NetFetchHeaders = {
  "content-type"?: string;
  etag?: string;
  "last-modified"?: string;
};

export type NetFetchResult = {
  url: string;
  status: number;
  headers: NetFetchHeaders;
  body: string;
};

type Address = { address: string; family: 4 | 6 };
type UpstreamResponse = {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  close?(): void;
};

export type NetFetchDependencies = {
  resolve(hostname: string): Promise<Address[]>;
  request(url: URL, address: Address, signal: AbortSignal): Promise<UpstreamResponse>;
  blockedAddresses(): Promise<string[]>;
};

export class NetFetchError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 413 | 415 | 429 | 502 | 503 | 504,
  ) {
    super(message);
    this.name = "NetFetchError";
  }
}

export function createNetFetchLimiter(options: {
  maxConcurrentGlobal?: number;
  maxConcurrentPerActor?: number;
  maxRequestsPerWindow?: number;
  now?: () => number;
  windowMs?: number;
} = {}) {
  const maxConcurrentGlobal = options.maxConcurrentGlobal ?? 32;
  const maxConcurrentPerActor = options.maxConcurrentPerActor ?? 2;
  const maxRequestsPerWindow = options.maxRequestsPerWindow ?? 30;
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 60_000;
  const usage = new Map<string, { windowStarted: number; requests: number }>();
  const activeByActor = new Map<string, number>();
  let globalActive = 0;

  return {
    acquire(actor: string) {
      const acquiredAt = now();
      let state = usage.get(actor);
      if (!state || acquiredAt - state.windowStarted >= windowMs) {
        state = { windowStarted: acquiredAt, requests: 0 };
        usage.set(actor, state);
      }
      if (state.requests >= maxRequestsPerWindow) throw new NetFetchError("Network fetch rate limit exceeded", 429);
      const actorActive = activeByActor.get(actor) ?? 0;
      if (actorActive >= maxConcurrentPerActor || globalActive >= maxConcurrentGlobal) {
        throw new NetFetchError("Too many concurrent network fetches", 429);
      }
      state.requests += 1;
      activeByActor.set(actor, actorActive + 1);
      globalActive += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const currentActive = activeByActor.get(actor) ?? 0;
        if (currentActive <= 1) activeByActor.delete(actor);
        else activeByActor.set(actor, currentActive - 1);
        globalActive -= 1;
      };
    },
  };
}

function ipv4Number(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return undefined;
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!) >>> 0;
}

function ipv4InCidr(address: number, base: string, prefix: number) {
  const baseNumber = ipv4Number(base)!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) >>> 0 === (baseNumber & mask) >>> 0;
}

const blockedIpv4Cidrs: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function expandIpv6(address: string): bigint | undefined {
  const zoneIndex = address.indexOf("%");
  const withoutZone = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
  let normalized = withoutZone.toLowerCase();
  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const value = ipv4Number(ipv4Tail);
    if (value === undefined) return undefined;
    normalized = `${normalized.slice(0, -ipv4Tail.length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6InCidr(address: bigint, base: string, prefix: number) {
  const baseNumber = expandIpv6(base)!;
  const shift = BigInt(128 - prefix);
  return address >> shift === baseNumber >> shift;
}

const blockedIpv6Cidrs: Array<[string, number]> = [
  ["::", 96], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["2620:4f:8000::", 48],
  ["3fff::", 20], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];

export function isPublicIp(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address)!;
    return !blockedIpv4Cidrs.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
  }
  if (family === 6) {
    const value = expandIpv6(address);
    return value !== undefined && ipv6InCidr(value, "2000::", 3)
      && !blockedIpv6Cidrs.some(([base, prefix]) => ipv6InCidr(value, base, prefix));
  }
  return false;
}

function normalizedIp(address: string) {
  if (isIP(address) === 4) return `4:${ipv4Number(address)}`;
  const value = expandIpv6(address);
  return value === undefined ? undefined : `6:${value.toString(16)}`;
}

function destinationHostname(url: URL) {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
}

export function validateNetFetchUrl(value: string, quickDomain: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NetFetchError("Expected an absolute HTTPS URL", 400);
  }

  if (url.protocol !== "https:") throw new NetFetchError("Only HTTPS destinations are allowed", 400);
  if (url.username || url.password) throw new NetFetchError("URL credentials are not allowed", 400);
  if (url.port && url.port !== "443") throw new NetFetchError("Only destination port 443 is allowed", 400);
  if (!url.hostname || url.hostname.endsWith(".")) throw new NetFetchError("Invalid destination hostname", 400);

  const hostname = destinationHostname(url).toLowerCase();
  const domain = quickDomain.toLowerCase().replace(/\.$/, "");
  if (hostname === domain || hostname.endsWith(`.${domain}`)) {
    throw new NetFetchError("Quick platform destinations are not allowed", 403);
  }
  return url;
}

export function isAllowedTextContentType(value: string | null) {
  if (!value) return false;
  const mime = value.split(";", 1)[0]!.trim().toLowerCase();
  return mime === "text/plain" || mime === "text/html" || mime === "text/csv" || mime === "text/calendar"
    || mime === "text/xml" || mime === "application/json" || mime === "application/xml"
    || mime === "application/rss+xml" || mime === "application/atom+xml"
    || mime.endsWith("+json") || mime.endsWith("+xml");
}

async function defaultResolve(hostname: string): Promise<Address[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily) return [{ address: hostname, family: literalFamily === 4 ? 4 : 6 }];
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry): Address[] => entry.family === 4 || entry.family === 6
    ? [{ address: entry.address, family: entry.family === 4 ? 4 : 6 }]
    : []);
}

function nodeHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

async function defaultRequest(url: URL, target: Address, signal: AbortSignal): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      agent: false,
      headers: {
        Accept: "application/json, application/*+json, application/xml, application/*+xml, text/plain, text/html, text/csv, text/calendar",
        "Accept-Encoding": "identity",
        Host: url.host,
        "User-Agent": "Quick-Public-Resource-Fetch/1.0",
      },
      host: target.address,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      port: 443,
      servername: isIP(destinationHostname(url)) ? undefined : destinationHostname(url),
    }, (response) => {
      resolve({
        status: response.statusCode ?? 502,
        headers: nodeHeaders(response.headers),
        body: response,
        close: () => response.destroy(),
      });
    });
    const abort = () => request.destroy(new DOMException("The request was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal.removeEventListener("abort", abort));
    request.once("error", reject);
    request.end();
  });
}

function localAddresses() {
  return Object.values(networkInterfaces()).flatMap((entries) => entries ?? []).map((entry) => entry.address);
}

export function createNetFetchDependencies(quickDomain: string): NetFetchDependencies {
  return {
    resolve: defaultResolve,
    request: defaultRequest,
    async blockedAddresses() {
      const resolveQuick = (hostname: string) => defaultResolve(hostname).catch(() => {
        throw new NetFetchError("Could not verify Quick infrastructure addresses", 503);
      });
      const [apexAddresses, wildcardAddresses] = await Promise.all([
        resolveQuick(quickDomain),
        resolveQuick(`net-fetch-address-check.${quickDomain}`),
      ]);
      return [...localAddresses(), ...apexAddresses, ...wildcardAddresses].map((entry) => typeof entry === "string" ? entry : entry.address);
    },
  };
}

async function readLimitedBody(response: UpstreamResponse) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > NET_FETCH_MAX_BYTES) {
    response.close?.();
    throw new NetFetchError(`Upstream response exceeds ${NET_FETCH_MAX_BYTES} byte limit`, 413);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > NET_FETCH_MAX_BYTES) {
      response.close?.();
      throw new NetFetchError(`Upstream response exceeds ${NET_FETCH_MAX_BYTES} byte limit`, 413);
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseHeaders(headers: Headers): NetFetchHeaders {
  const result: NetFetchHeaders = {};
  for (const name of ["content-type", "etag", "last-modified"] as const) {
    const value = headers.get(name);
    if (value) result[name] = value;
  }
  return result;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("The request was aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("The request was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function fetchPublicTextResource(
  input: string,
  quickDomain: string,
  dependencies: NetFetchDependencies = createNetFetchDependencies(quickDomain),
): Promise<NetFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NET_FETCH_TIMEOUT_MS);
  let current = validateNetFetchUrl(input, quickDomain);

  try {
    for (let redirects = 0; redirects <= NET_FETCH_MAX_REDIRECTS; redirects += 1) {
      let blocked: Set<string>;
      let addresses: Address[];
      try {
        const blockedAddresses = await withAbort(dependencies.blockedAddresses(), controller.signal);
        blocked = new Set(blockedAddresses.flatMap((address) => {
          const normalized = normalizedIp(address);
          return normalized ? [normalized] : [];
        }));
        addresses = await withAbort(dependencies.resolve(destinationHostname(current)), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw new NetFetchError("Upstream request timed out", 504);
        if (error instanceof NetFetchError) throw error;
        throw new NetFetchError("Destination DNS resolution failed", 502);
      }
      if (addresses.length === 0) throw new NetFetchError("Destination did not resolve to an IP address", 502);
      if (addresses.some(({ address }) => {
        const normalized = normalizedIp(address);
        return !isPublicIp(address) || normalized === undefined || blocked.has(normalized);
      })) {
        throw new NetFetchError("Destination resolves to a non-public or Quick infrastructure address", 403);
      }

      let response: UpstreamResponse;
      try {
        // Connecting to the validated numeric address pins this hop; SNI/certificate and Host remain the URL hostname.
        response = await withAbort(dependencies.request(current, addresses[0]!, controller.signal), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw new NetFetchError("Upstream request timed out", 504);
        if (error instanceof NetFetchError) throw error;
        throw new NetFetchError("Upstream request failed", 502);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.close?.();
        if (redirects === NET_FETCH_MAX_REDIRECTS) throw new NetFetchError("Upstream redirect limit exceeded", 502);
        const location = response.headers.get("location");
        if (!location) throw new NetFetchError("Upstream redirect did not include Location", 502);
        let redirectUrl: string;
        try {
          redirectUrl = new URL(location, current).toString();
        } catch {
          throw new NetFetchError("Upstream redirect Location is invalid", 502);
        }
        current = validateNetFetchUrl(redirectUrl, quickDomain);
        continue;
      }

      const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
      if (contentEncoding && contentEncoding !== "identity") {
        response.close?.();
        throw new NetFetchError("Compressed upstream responses are not supported", 415);
      }
      const contentType = response.headers.get("content-type");
      if (!isAllowedTextContentType(contentType)) {
        response.close?.();
        throw new NetFetchError("Upstream content type is not an allowed text format", 415);
      }
      let bytes: Uint8Array;
      try {
        bytes = await withAbort(readLimitedBody(response), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) {
          response.close?.();
          throw new NetFetchError("Upstream request timed out", 504);
        }
        throw error;
      }
      const charset = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
      if (bytes.includes(0)) throw new NetFetchError("Upstream body appears to contain binary data", 415);
      let body: string;
      try {
        body = new TextDecoder(charset, { fatal: true }).decode(bytes);
      } catch {
        throw new NetFetchError("Upstream body is not valid text in its declared charset", 415);
      }
      return { url: current.toString(), status: response.status, headers: responseHeaders(response.headers), body };
    }
    throw new NetFetchError("Upstream redirect limit exceeded", 502);
  } finally {
    clearTimeout(timeout);
  }
}
