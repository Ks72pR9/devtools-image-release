import assert from "node:assert/strict";
import test from "node:test";
import { publishOptimizedAsset, type ImageAssetGateway } from "../src/asset_release.js";

test("a stable build stores and signs the optimized bytes under one deterministic asset key", async () => {
  const calls: Array<{ action: string; key?: string; bytes?: string }> = [];
  const gateway: ImageAssetGateway = {
    async ensureBucket() { calls.push({ action: "bucket" }); },
    async compress() {
      calls.push({ action: "compress" });
      return { image: `data:image/png;base64,${Buffer.from("small").toString("base64")}` };
    },
    async put(_bucket, key, bytes) { calls.push({ action: "put", key, bytes }); },
    async signedGet(_bucket, key) {
      calls.push({ action: "sign", key });
      return "https://assets.example/signed";
    },
  };
  const result = await publishOptimizedAsset(gateway, "build-assets", {
    buildId: "build-42",
    release: "stable",
    filename: "Network Panel.PNG",
    contentType: "image/png",
    dataBase64: Buffer.from("a much larger original").toString("base64"),
  }, () => new Date("2026-09-14T10:00:00.000Z"));

  assert.equal(result.assetKey, "devtools/stable/build-42/network-panel.png");
  assert.deepEqual(calls.map(({ action }) => action), ["bucket", "compress", "put", "sign"]);
  assert.equal(calls[2]?.key, result.assetKey);
  assert.equal(calls[3]?.key, result.assetKey);
  assert.equal(Buffer.from(calls[2]?.bytes ?? "", "base64").toString(), "small");
  assert.equal(result.diagnostics.savedBytes, 17);
  assert.deepEqual(result.events.map(({ state }) => state), ["received", "compressed", "published"]);
});
