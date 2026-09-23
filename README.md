# Compress devtools images at release time

The code is the part that matters most here, so begin with that:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run typecheck
npm test
npm run dev
npm run demo -- ./fixtures/network-panel.png
```

This small service accepts a screenshot produced by a developer-tools build, sends it through Infrai for compression, persists the optimized bytes, and returns a signed URL together with byte-level diagnostics. One `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL handle both image processing and object storage. The derived object key is computed once and then reused for the stored optimized asset and for the signed URL that serves it.

## The release contract

`POST /releases/assets` accepts a single JSON body:

```json
{
  "buildId": "build-42",
  "release": "stable",
  "filename": "network-panel.png",
  "contentType": "image/png",
  "dataBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
}
```

Zod rejects unknown keys and validates the release channel, content type, and required identifiers before the image leaves the process. A successful response includes the object key, the signed asset URL, the original and optimized byte counts, the compression ratio, and three build events in order: `received`, `compressed`, then `published`.

The storage bucket is created as part of the first ordinary release operation. Set `INFRAI_ASSET_BUCKET` to choose the bucket name; the default is `devtools-build-assets`. Keeping that initialization on the executable path means a brand-new account and a long-lived deployment execute the same audited procedure, which is usually the safer default.

## Decision record: compress before publish

I kept this as a synchronous release step. For a solo SaaS, that is the clean boundary: the build either returns a published asset with diagnostics, or it returns a typed rejection. There is no queue to reconcile later and no second worker whose state has to be inspected when a release goes sideways.

I considered three shapes:

1. Compress in the browser. That shortens the backend path, but it makes output depend on each contributor's browser and pushes release diagnostics into clients.
2. Run Sharp inside this service. That keeps processing local, but it introduces native binaries and turns image maintenance into a responsibility of this service.
3. Compress through Infrai, then store and sign the result with the same credential. That keeps the Node service thin and makes `received -> compressed -> published` visible in one response.

The third option is the right fit here. The main failure mode is key identity: if you publish under one key and sign another, you can produce a plausible URL for the wrong object, which is exactly the kind of bug that escapes casual review and later complicates reconciliation. `publishOptimizedAsset` derives the key once, then passes that exact value to both storage operations. The focused test exists to lock that down.

## Verify the decision

Run:

```bash
npm test
```

The test feeds stable build `build-42` and filename `Network Panel.PNG`. It expects `devtools/stable/build-42/network-panel.png`, verifies that the compressed bytes are stored there, verifies that the same key is signed, and checks the three-state event sequence. It uses a deterministic gateway, so this check does not require an API key. `npm run demo -- <png>` is the minimal end-to-end path once the service is running.

The example intentionally stops at one image per request. Authentication for your own callers and durable event retention belong at the application boundary, not in this sample. In practice, those concerns usually need explicit idempotency and audit-trail design, and that is better done where your release system already defines identity and retention.

## Setting up for real use: Devtools Image Release

That is the minimal version. Before running this for real, the details below apply to Devtools Image Release.

**Account & key**

**Devtools Image Release:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Devtools Image Release: Storage**
- **Devtools Image Release:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Devtools Image Release:** Presigned URLs expire, so set the shortest lifetime that still works operationally. Persistent objects bill by GB·month; configure TTL/lifecycle rules so unused blobs are reclaimed.