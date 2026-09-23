import { createHash } from "node:crypto";

export type ReleaseInput = {
  buildId: string;
  release: "preview" | "stable";
  filename: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  dataBase64: string;
};

export type BuildEvent = {
  state: "received" | "compressed" | "published";
  at: string;
  detail: string;
};

export interface ImageAssetGateway {
  ensureBucket(name: string, operationId: string): Promise<void>;
  compress(image: string): Promise<{ image: string }>;
  put(bucket: string, key: string, dataBase64: string, contentType: string, operationId: string): Promise<void>;
  signedGet(bucket: string, key: string, expiresSeconds: number): Promise<string>;
}

export type ReleaseResult = {
  buildId: string;
  release: ReleaseInput["release"];
  assetKey: string;
  assetUrl: string;
  diagnostics: {
    originalBytes: number;
    optimizedBytes: number;
    savedBytes: number;
    ratio: number;
  };
  events: BuildEvent[];
};

const bytesInBase64 = (value: string) => Buffer.from(value, "base64").byteLength;

export function decideAssetKey(input: Pick<ReleaseInput, "buildId" | "release" | "filename">): string {
  const safeName = input.filename.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `devtools/${input.release}/${input.buildId}/${safeName}`;
}

export async function publishOptimizedAsset(
  gateway: ImageAssetGateway,
  bucket: string,
  input: ReleaseInput,
  now: () => Date = () => new Date(),
): Promise<ReleaseResult> {
  const assetKey = decideAssetKey(input);
  const operationId = createHash("sha256")
    .update(`${bucket}:${assetKey}:${input.dataBase64}`)
    .digest("hex");
  const events: BuildEvent[] = [{ state: "received", at: now().toISOString(), detail: assetKey }];

  await gateway.ensureBucket(bucket, `bucket:${bucket}`);
  const optimized = await gateway.compress(`data:${input.contentType};base64,${input.dataBase64}`);
  const optimizedBase64 = optimized.image.replace(/^data:[^;]+;base64,/, "");
  events.push({ state: "compressed", at: now().toISOString(), detail: assetKey });

  await gateway.put(bucket, assetKey, optimizedBase64, input.contentType, operationId);
  const assetUrl = await gateway.signedGet(bucket, assetKey, 900);
  events.push({ state: "published", at: now().toISOString(), detail: assetKey });

  const originalBytes = bytesInBase64(input.dataBase64);
  const optimizedBytes = bytesInBase64(optimizedBase64);
  return {
    buildId: input.buildId,
    release: input.release,
    assetKey,
    assetUrl,
    diagnostics: {
      originalBytes,
      optimizedBytes,
      savedBytes: originalBytes - optimizedBytes,
      ratio: originalBytes === 0 ? 1 : Number((optimizedBytes / originalBytes).toFixed(4)),
    },
    events,
  };
}
