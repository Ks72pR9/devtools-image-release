import { createServer } from "node:http";
import { z } from "zod";
import { publishOptimizedAsset, type ImageAssetGateway } from "./asset_release.js";
import { InfraiError, InfraiImageStore } from "./infrai_image_store.js";

const requestSchema = z.object({
  buildId: z.string().min(1).max(120),
  release: z.enum(["preview", "stable"]),
  filename: z.string().min(1).max(180),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(1),
}).strict();

function gatewayFor(store: InfraiImageStore): ImageAssetGateway {
  return {
    async ensureBucket(name, operationId) {
      await store.infrai.storage.bucket.create({ name, idempotency_key: operationId });
    },
    compress: (image) => store.infrai.image.compress({ image }),
    async put(bucket, key, data_base64, content_type, idempotency_key) {
      await store.infrai.storage.object.put(bucket, key, { data_base64, content_type, idempotency_key });
    },
    async signedGet(bucket, key, expires_seconds) {
      const result = await store.infrai.storage.object.presign(bucket, key, { op: "get", expires_seconds });
      return result.url;
    },
  };
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 12 * 1024 * 1024) throw new Error("Request body exceeds 12 MiB");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const bucket = process.env.INFRAI_ASSET_BUCKET ?? "devtools-build-assets";
const gateway = gatewayFor(new InfraiImageStore(apiKey));

createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method !== "POST" || request.url !== "/releases/assets") {
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const input = requestSchema.parse(await readJson(request));
    const result = await publishOptimizedAsset(gateway, bucket, input);
    response.writeHead(201).end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request", issues: error.issues }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.code, detail: error.detail }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "asset_release_failed" }));
  }
}).listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Devtools image release service listening on http://localhost:${process.env.PORT ?? 3000}`);
});
