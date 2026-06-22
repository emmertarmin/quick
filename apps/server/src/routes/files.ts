import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { collections } from "@quick/db";
import type { JsonBlob, QuickDocument } from "@quick/shared";
import { filesRoot, maxUploadBytes } from "../config";

const filesCollection = "_quick_files";
const siteNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const fileIdPattern = /^[0-9a-f-]{36}$/i;

type QuickFileDocument = QuickDocument & {
  content_type: string;
  name: string;
  size: number;
  url: string;
};

function siteFromHeader(c: { req: { header(name: string): string | undefined } }) {
  const site = c.req.header("X-Quick-Site")?.trim();
  return site && siteNamePattern.test(site) ? site : undefined;
}

function fileError(message: string) {
  return { error: message };
}

function filePath(site: string, id: string) {
  return join(filesRoot, site, id);
}

function fileUrl(id: string) {
  return `/api/files/${encodeURIComponent(id)}/content`;
}

async function assertInsideFilesRoot(path: string) {
  const root = resolve(filesRoot);
  const target = resolve(path);
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;

  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new Error("Resolved file path escaped files root");
  }
}

function asQuickFileDocument(document: JsonBlob | undefined) {
  if (!document) {
    return undefined;
  }

  if (
    typeof document.id !== "string" ||
    typeof document.name !== "string" ||
    typeof document.content_type !== "string" ||
    typeof document.size !== "number" ||
    typeof document.url !== "string"
  ) {
    return undefined;
  }

  return document as QuickFileDocument;
}

async function uploadedFile(c: Context) {
  const body = await c.req.parseBody();
  const value = body.file;

  if (value instanceof File) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((entry) => entry instanceof File);
  }

  return undefined;
}

export function registerFileRoutes(app: OpenAPIHono) {
  app.get("/files", (c) => {
    const site = siteFromHeader(c);

    if (!site) {
      return c.json(fileError("Missing or invalid trusted X-Quick-Site header"), 400);
    }

    const files = collections.all(site, filesCollection).map(asQuickFileDocument).filter((file) => file !== undefined);
    return c.json(files, 200);
  });

  app.post("/files", async (c) => {
    const site = siteFromHeader(c);

    if (!site) {
      return c.json(fileError("Missing or invalid trusted X-Quick-Site header"), 400);
    }

    const file = await uploadedFile(c);

    if (!file) {
      return c.json(fileError("Expected multipart form data with a file field named 'file'"), 400);
    }

    if (file.size > maxUploadBytes) {
      return c.json(fileError(`File exceeds ${maxUploadBytes} byte limit`), 413);
    }

    const id = crypto.randomUUID();
    const path = filePath(site, id);
    await assertInsideFilesRoot(path);

    try {
      await mkdir(join(filesRoot, site), { recursive: true });
      await writeFile(path, Buffer.from(await file.arrayBuffer()), { flag: "wx" });

      const document = collections.create(site, filesCollection, {
        id,
        name: file.name || id,
        content_type: file.type || "application/octet-stream",
        size: file.size,
        url: fileUrl(id),
      });

      if (!document) {
        await rm(path, { force: true });
        return c.json(fileError("File metadata already exists"), 409);
      }

      return c.json(asQuickFileDocument(document), 201);
    } catch (error) {
      await rm(path, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      return c.json(fileError(message), 400);
    }
  });

  app.get("/files/:id/content", async (c) => {
    const site = siteFromHeader(c);
    const id = c.req.param("id");

    if (!site) {
      return c.json(fileError("Missing or invalid trusted X-Quick-Site header"), 400);
    }

    if (!fileIdPattern.test(id)) {
      return c.json(fileError("Invalid file id"), 400);
    }

    const metadata = asQuickFileDocument(collections.get(site, filesCollection, id));

    if (!metadata) {
      return c.json(fileError("File not found"), 404);
    }

    const path = filePath(site, id);
    await assertInsideFilesRoot(path);

    const existing = await stat(path).catch(() => undefined);
    if (!existing?.isFile()) {
      return c.json(fileError("File content not found"), 404);
    }

    return new Response(Bun.file(path), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename=${JSON.stringify(metadata.name)}`,
        "Content-Length": String(metadata.size),
        "Content-Type": metadata.content_type,
      },
    });
  });

  app.delete("/files/:id", async (c) => {
    const site = siteFromHeader(c);
    const id = c.req.param("id");

    if (!site) {
      return c.json(fileError("Missing or invalid trusted X-Quick-Site header"), 400);
    }

    if (!fileIdPattern.test(id)) {
      return c.json(fileError("Invalid file id"), 400);
    }

    const metadata = asQuickFileDocument(collections.get(site, filesCollection, id));

    if (!metadata) {
      return c.json(fileError("File not found"), 404);
    }

    const path = filePath(site, id);
    await assertInsideFilesRoot(path);

    try {
      const existing = await stat(path);
      if (!existing.isFile()) {
        return c.json(fileError("File content not found"), 404);
      }

      await rm(path);
      const deleted = collections.delete(site, filesCollection, id);
      return c.json(asQuickFileDocument(deleted) ?? metadata, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(fileError(message), 500);
    }
  });
}
