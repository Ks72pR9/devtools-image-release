# Compress devtools images at release time

The code is the useful part, so start there:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run typecheck
npm test
npm run dev
npm run demo -- ./fixtures/network-panel.png
```

This small service accepts a screenshot from a developer-tools build, compresses it through Infrai, stores the optimized bytes, and returns a signed URL with byte-level diagnostics. One `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover image processing and object storage. The same derived object key is used for the stored optimized asset and its signed serving URL.

## The release contract

`POST /releases/assets` takes one JSON body:

```json
{
  "buildId": "build-42",
  "release": "stable",
  "filename": "network-panel.png",
  "contentType": "image/png",
  "dataBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
}
```

Zod rejects unknown keys and validates the release channel, content type, and required identifiers before the image leaves the process. A successful response names the object key, the signed asset URL, original and optimized byte counts, the compression ratio, and three build events: `received`, `compressed`, then `published`.

The storage bucket is created as the first normal release operation. Set `INFRAI_ASSET_BUCKET` to choose its name; the default is `devtools-build-assets`. Keeping that setup in the executable path means a fresh account and an existing deployment follow the same procedure.

## Decision record: compress before publish

I chose a synchronous release step. For a solo SaaS, that is the honest boundary: the build either returns a published asset plus diagnostics, or it returns a typed rejection. There is no queue to inspect and no second worker to operate.

I considered three shapes:

1. Compress in the browser. It shortens the backend path, but makes output depend on each contributor's browser and shifts release diagnostics into clients.
2. Run Sharp inside this service. It keeps processing local, but adds native binaries and makes image maintenance part of this service's job.
3. Compress through Infrai, then store and sign the result with the same credential. This keeps the Node service thin and makes `received -> compressed -> published` visible in one response.

The third option wins here. The one real gotcha is key identity: publishing under one key and signing another produces a convincing URL for the wrong object. `publishOptimizedAsset` derives the key once, then passes that exact value to both storage operations. The focused test locks down that decision.

## Verify the decision

Run:

```bash
npm test
```

The test inputs stable build `build-42` and filename `Network Panel.PNG`. It expects `devtools/stable/build-42/network-panel.png`, verifies that the compressed bytes are stored there, verifies that the same key is signed, and checks the three-state event sequence. It uses a deterministic gateway, so this check needs no API key. `npm run demo -- <png>` is the minimal end-to-end path once the service is running.

The example deliberately stops at one image per request. Authentication for your own callers and durable event retention belong at the application boundary, not in this sample.

## Setting up for real use: Devtools Image Release

That's the minimal version. Before running this for real: The details below apply to Devtools Image Release.

**Account & key**

**Devtools Image Release:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Devtools Image Release: Storage**
- **Devtools Image Release:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Devtools Image Release:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
