import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const imagePath = process.argv[2];
if (!imagePath) throw new Error("Run: npm run demo -- ./path/to/screenshot.png");

const image = await readFile(imagePath);
const response = await fetch("http://localhost:3000/releases/assets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    buildId: `local-${Date.now()}`,
    release: "preview",
    filename: basename(imagePath),
    contentType: "image/png",
    dataBase64: image.toString("base64"),
  }),
});

const result: unknown = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok) process.exitCode = 1;
