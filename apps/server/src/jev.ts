import type {
  QuickJevAnswer,
  QuickJevClassifyRequest,
  QuickJevClassifyResponse,
  QuickJevQuestion,
} from "@quick/shared";

export const JEV_MAX_RESPONSE_BYTES = 256 * 1024;
export const JEV_TIMEOUT_MS = 20_000;

export type JevConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

export class JevError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 429 | 502 | 503 | 504,
  ) {
    super(message);
    this.name = "JevError";
  }
}

type WindowUsage = { windowStarted: number; requests: number };

export type JevLimiter = {
  acquire(actor: string, site: string): () => void;
};

export function createJevLimiter(options: {
  maxConcurrentGlobal?: number;
  maxConcurrentPerActor?: number;
  maxEntries?: number;
  maxRequestsPerSite?: number;
  maxRequestsPerWindow?: number;
  now?: () => number;
  windowMs?: number;
} = {}): JevLimiter {
  const maxConcurrentGlobal = options.maxConcurrentGlobal ?? 16;
  const maxConcurrentPerActor = options.maxConcurrentPerActor ?? 2;
  const maxEntries = options.maxEntries ?? 10_000;
  const maxRequestsPerSite = options.maxRequestsPerSite ?? 120;
  const maxRequestsPerWindow = options.maxRequestsPerWindow ?? 20;
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 60_000;
  const usage = new Map<string, WindowUsage>();
  const activeByActor = new Map<string, number>();
  let globalActive = 0;

  function windowFor(key: string, startedAt: number) {
    let state = usage.get(key);
    if (!state || startedAt - state.windowStarted >= windowMs) {
      state = { windowStarted: startedAt, requests: 0 };
      usage.set(key, state);
    }
    return state;
  }

  function pruneExpired(startedAt: number) {
    if (usage.size <= maxEntries) return;
    for (const [key, state] of usage) {
      if (startedAt - state.windowStarted >= windowMs) usage.delete(key);
    }
  }

  return {
    acquire(actor, site) {
      const acquiredAt = now();
      pruneExpired(acquiredAt);
      const actorWindow = windowFor(`actor\n${actor}`, acquiredAt);
      const siteWindow = windowFor(`site\n${site}`, acquiredAt);
      if (actorWindow.requests >= maxRequestsPerWindow || siteWindow.requests >= maxRequestsPerSite) {
        throw new JevError("Jev classification rate limit exceeded", 429);
      }
      const actorActive = activeByActor.get(actor) ?? 0;
      if (actorActive >= maxConcurrentPerActor || globalActive >= maxConcurrentGlobal) {
        throw new JevError("Too many concurrent Jev classifications", 429);
      }
      actorWindow.requests += 1;
      siteWindow.requests += 1;
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

type JevWireQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } };

function wireQuestion(question: QuickJevQuestion): JevWireQuestion {
  return question.type === "bool"
    ? { type: "noul", instructions: question.instructions, criteria: question.criteria }
    : question;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse() {
  return new JevError("Jev returned an invalid response", 502);
}

function requiredNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidResponse();
  return value;
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseUsage(value: unknown) {
  if (!isRecord(value) || (value.input_tokens === undefined && value.output_tokens === undefined)) return undefined;
  return { inputTokens: tokenCount(value.input_tokens), outputTokens: tokenCount(value.output_tokens) };
}

function parseProbabilities(value: unknown, criteria: Record<string, string>) {
  if (!isRecord(value)) throw invalidResponse();
  const probabilities: Record<string, number> = {};
  for (const [key, probability] of Object.entries(value)) {
    if (!Object.hasOwn(criteria, key)) throw invalidResponse();
    probabilities[key] = requiredNumber(probability);
  }
  return probabilities;
}

function parseAnswer(question: QuickJevQuestion, value: unknown): QuickJevAnswer {
  if (!isRecord(value)) throw invalidResponse();
  if (question.type === "choice") {
    if (value.type !== "choice" || typeof value.choice !== "string" || !Object.hasOwn(question.criteria, value.choice)) {
      throw invalidResponse();
    }
    return {
      type: "choice",
      choice: value.choice,
      probabilities: parseProbabilities(value.probabilities, question.criteria),
      confidence: requiredNumber(value.confidence),
    };
  }
  if (question.type === "score") {
    if (value.type !== "score") throw invalidResponse();
    return { type: "score", score: requiredNumber(value.score), confidence: requiredNumber(value.confidence) };
  }
  if (value.type !== "noul") throw invalidResponse();
  return { type: "bool", probability: requiredNumber(value.noul) };
}

function parseResponse(payload: unknown, request: QuickJevClassifyRequest, model: string): QuickJevClassifyResponse {
  if (!isRecord(payload) || !isRecord(payload.answers)) throw invalidResponse();
  const answers: Record<string, QuickJevAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    answers[id] = parseAnswer(question, payload.answers[id]);
  }
  const usage = parseUsage(payload.usage);
  return usage ? { model, answers, usage } : { model, answers };
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function readLimitedText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > JEV_MAX_RESPONSE_BYTES) {
    throw new JevError("Jev response exceeds the size limit", 502);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > JEV_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new JevError("Jev response exceeds the size limit", 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function classifyWithJev(
  request: QuickJevClassifyRequest,
  config: JevConfig,
  dependencies: { fetch?: typeof fetch } = {},
): Promise<QuickJevClassifyResponse> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  let url: URL;
  try {
    url = new URL("systemone", `${config.baseUrl.replace(/\/+$/u, "")}/`);
  } catch {
    throw new JevError("Jev classification failed", 502);
  }

  const questions = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id, wireQuestion(question)]));
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: config.model, state: request.state, questions }),
      // Never forward the bearer key to a redirect target.
      redirect: "error",
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw new JevError("Jev classification timed out", 504);
    throw new JevError("Jev classification failed", 502);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new JevError(`Jev classification failed (upstream status ${response.status})`, 502);
  }

  let text: string;
  try {
    text = await readLimitedText(response);
  } catch (error) {
    if (error instanceof JevError) throw error;
    if (isTimeoutError(error)) throw new JevError("Jev classification timed out", 504);
    throw new JevError("Jev classification failed", 502);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw invalidResponse();
  }
  return parseResponse(payload, request, config.model);
}
