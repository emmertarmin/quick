import type { Context } from "hono";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { collections } from "@quick/db";
import type { JsonBlob, QuickDocument } from "@quick/shared";
import {
  collectionParamsSchema,
  documentParamsSchema,
  errorResponseSchema,
  isJsonBlob,
  jsonBlobSchema,
  quickDocumentSchema,
  siteHeaderSchema,
} from "../schemas";

const apiSiteHeaderSchema = siteHeaderSchema.openapi("SiteHeader", {
  description: "Site name, set by the trusted Quick edge proxy from the request host.",
  example: { "X-Quick-Site": "demo" },
});

const apiCollectionParamsSchema = collectionParamsSchema.openapi("CollectionParams", {
  description: "Collection route parameters.",
  example: { collection: "posts" },
});

const apiDocumentParamsSchema = documentParamsSchema.openapi("DocumentParams", {
  description: "Collection document route parameters.",
  example: { collection: "posts", id: "document-1" },
});

const apiJsonBlobSchema = jsonBlobSchema.openapi("JsonBlob", {
  description: "Arbitrary JSON object.",
  example: { title: "Hello Quick DB", status: "draft" },
});

const apiQuickDocumentSchema = quickDocumentSchema.openapi("QuickDocument", {
  description: "Collection document with stable metadata.",
  example: {
    id: "document-1",
    title: "Hello Quick DB",
    status: "draft",
    created_at: "2026-06-14T00:00:00.000Z",
    updated_at: "2026-06-14T00:00:00.000Z",
  },
});

function asQuickDocument(document: JsonBlob) {
  return document as QuickDocument;
}

const jsonBody = {
  content: {
    "application/json": {
      schema: apiJsonBlobSchema,
    },
  },
};

const errorJson = (description: string) => ({
  content: {
    "application/json": {
      schema: errorResponseSchema,
    },
  },
  description,
});

const documentJson = (description: string) => ({
  content: {
    "application/json": {
      schema: apiQuickDocumentSchema,
    },
  },
  description,
});

function siteFromHeader(c: { req: { header(name: string): string | undefined } }) {
  const site = c.req.header("X-Quick-Site")?.trim();
  return site || undefined;
}

async function readJsonObject(request: { json(): Promise<unknown> }) {
  const value = await request.json();
  return isJsonBlob(value) ? value : undefined;
}

const collectionPath = "/db/collections/{collection}/documents";
const documentPath = "/db/collections/{collection}/documents/{id}";

type CollectionRealtimeEvent =
  | { type: "create"; document: QuickDocument }
  | { type: "update"; document: QuickDocument }
  | { type: "delete"; id: string; document: QuickDocument };

type CollectionRealtimeClient = {
  site: string;
  collection: string;
  send(event: CollectionRealtimeEvent): void;
};

const realtimeClients = new Set<CollectionRealtimeClient>();
const sseEncoder = new TextEncoder();

function sseEvent(name: string, data: unknown) {
  return sseEncoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastCollectionEvent(site: string, collection: string, event: CollectionRealtimeEvent) {
  for (const client of realtimeClients) {
    if (client.site === site && client.collection === collection) {
      client.send(event);
    }
  }
}

function collectionSubscriptionResponse(c: Context) {
  const site = siteFromHeader(c);

  if (!site) {
    return c.json({ error: "Missing trusted X-Quick-Site header" }, 400);
  }

  const collection = c.req.param("collection");

  if (!collection) {
    return c.json({ error: "Missing collection route parameter" }, 400);
  }

  const signal = c.req.raw.signal;
  let heartbeat: Timer | undefined;
  let client: CollectionRealtimeClient | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }

        if (client) {
          realtimeClients.delete(client);
          client = undefined;
        }
      };

      client = {
        site,
        collection,
        send(event) {
          try {
            controller.enqueue(sseEvent(event.type, event));
          } catch {
            cleanup();
          }
        },
      };

      realtimeClients.add(client);
      controller.enqueue(sseEvent("ready", { collection, site }));

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseEncoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);

      signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
      }

      if (client) {
        realtimeClients.delete(client);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

type DocumentMutation =
  | {
      site: string;
      collection: string;
      id: string;
      body: JsonBlob;
    }
  | {
      error: string;
    };

async function readDocumentMutation(c: Context): Promise<DocumentMutation> {
  const site = siteFromHeader(c);

  if (!site) {
    return { error: "Missing trusted X-Quick-Site header" };
  }

  const body = await readJsonObject(c.req);

  if (!body) {
    return { error: "Expected a JSON object" };
  }

  const collection = c.req.param("collection");
  const id = c.req.param("id");

  if (!collection || !id) {
    return { error: "Missing collection or document id route parameter" };
  }

  return { site, collection, id, body };
}

export function registerCollectionRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/db/collections/{collection}/subscribe",
      request: {
        headers: apiSiteHeaderSchema,
        params: apiCollectionParamsSchema,
      },
      responses: {
        200: {
          content: {
            "text/event-stream": {
              schema: z.string().openapi({ description: "Server-sent collection mutation events." }),
            },
          },
          description: "Collection change subscription stream.",
        },
        400: errorJson("Missing or invalid request data."),
      },
    }),
    collectionSubscriptionResponse,
  );

  app.openapi(
    createRoute({
      method: "get",
      path: collectionPath,
      request: {
        headers: apiSiteHeaderSchema,
        params: apiCollectionParamsSchema,
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.array(apiQuickDocumentSchema),
            },
          },
          description: "Collection documents.",
        },
        400: errorJson("Missing or invalid request data."),
      },
    }),
    (c) => {
      const site = siteFromHeader(c);

      if (!site) {
        return c.json({ error: "Missing trusted X-Quick-Site header" }, 400);
      }

      return c.json(collections.all(site, c.req.param("collection")).map(asQuickDocument), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: collectionPath,
      request: {
        headers: apiSiteHeaderSchema,
        params: apiCollectionParamsSchema,
        body: {
          ...jsonBody,
          description: "Document data to create. If id is omitted, one is generated.",
          required: true,
        },
      },
      responses: {
        201: documentJson("Created document."),
        400: errorJson("Missing site header or non-object JSON body."),
        409: errorJson("A document with the requested id already exists."),
      },
    }),
    async (c) => {
      const site = siteFromHeader(c);

      if (!site) {
        return c.json({ error: "Missing trusted X-Quick-Site header" }, 400);
      }

      const body = await readJsonObject(c.req);

      if (!body) {
        return c.json({ error: "Expected a JSON object" }, 400);
      }

      const document = collections.create(site, c.req.param("collection"), body);

      if (!document) {
        return c.json({ error: "Document already exists" }, 409);
      }

      const quickDocument = asQuickDocument(document);
      broadcastCollectionEvent(site, c.req.param("collection"), { type: "create", document: quickDocument });

      return c.json(quickDocument, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: documentPath,
      request: {
        headers: apiSiteHeaderSchema,
        params: apiDocumentParamsSchema,
      },
      responses: {
        200: documentJson("Requested document."),
        400: errorJson("Missing or invalid request data."),
        404: errorJson("Document not found."),
      },
    }),
    (c) => {
      const site = siteFromHeader(c);

      if (!site) {
        return c.json({ error: "Missing trusted X-Quick-Site header" }, 400);
      }

      const document = collections.get(site, c.req.param("collection"), c.req.param("id"));

      if (!document) {
        return c.json({ error: "Document not found" }, 404);
      }

      return c.json(asQuickDocument(document), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: documentPath,
      request: {
        headers: apiSiteHeaderSchema,
        params: apiDocumentParamsSchema,
        body: {
          ...jsonBody,
          description: "Full replacement document data. Metadata remains server-authoritative.",
          required: true,
        },
      },
      responses: {
        200: documentJson("Replaced document."),
        400: errorJson("Missing site header, route parameter, or non-object JSON body."),
        404: errorJson("Document not found."),
      },
    }),
    async (c) => {
      const mutation = await readDocumentMutation(c);

      if ("error" in mutation) {
        return c.json({ error: mutation.error }, 400);
      }

      const document = collections.replace(mutation.site, mutation.collection, mutation.id, mutation.body);

      if (!document) {
        return c.json({ error: "Document not found" }, 404);
      }

      const quickDocument = asQuickDocument(document);
      broadcastCollectionEvent(mutation.site, mutation.collection, { type: "update", document: quickDocument });

      return c.json(quickDocument, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: documentPath,
      request: {
        headers: apiSiteHeaderSchema,
        params: apiDocumentParamsSchema,
        body: {
          ...jsonBody,
          description: "Partial document data to shallow-merge into the existing document.",
          required: true,
        },
      },
      responses: {
        200: documentJson("Updated document."),
        400: errorJson("Missing site header, route parameter, or non-object JSON body."),
        404: errorJson("Document not found."),
      },
    }),
    async (c) => {
      const mutation = await readDocumentMutation(c);

      if ("error" in mutation) {
        return c.json({ error: mutation.error }, 400);
      }

      const document = collections.update(mutation.site, mutation.collection, mutation.id, mutation.body);

      if (!document) {
        return c.json({ error: "Document not found" }, 404);
      }

      const quickDocument = asQuickDocument(document);
      broadcastCollectionEvent(mutation.site, mutation.collection, { type: "update", document: quickDocument });

      return c.json(quickDocument, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: documentPath,
      request: {
        headers: apiSiteHeaderSchema,
        params: apiDocumentParamsSchema,
      },
      responses: {
        200: documentJson("Deleted document."),
        400: errorJson("Missing or invalid request data."),
        404: errorJson("Document not found."),
      },
    }),
    (c) => {
      const site = siteFromHeader(c);

      if (!site) {
        return c.json({ error: "Missing trusted X-Quick-Site header" }, 400);
      }

      const document = collections.delete(site, c.req.param("collection"), c.req.param("id"));

      if (!document) {
        return c.json({ error: "Document not found" }, 404);
      }

      const quickDocument = asQuickDocument(document);
      broadcastCollectionEvent(site, c.req.param("collection"), {
        type: "delete",
        id: quickDocument.id,
        document: quickDocument,
      });

      return c.json(quickDocument, 200);
    },
  );
}
