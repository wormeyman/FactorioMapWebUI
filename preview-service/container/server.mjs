import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { renderPreview, RenderError } from "./render.mjs";

const PORT = 8080;
const FACTORIO_BIN = process.env.FACTORIO_BIN ?? "/opt/factorio/bin/x64/factorio";
const PLANETS = new Set(["nauvis", "vulcanus", "gleba", "fulgora", "aquilo"]);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 262144) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method === "POST" && req.url === "/render") {
    try {
      const body = await readJson(req);
      if (!PLANETS.has(body.planet) || typeof body.seed !== "number") {
        res.writeHead(400).end("bad request");
        return;
      }
      const png = await renderPreview(
        { mapGenSettings: body.mapGenSettings, planet: body.planet, seed: body.seed, size: body.size ?? 1024 },
        { tmpDir: tmpdir(), factorioBin: FACTORIO_BIN },
      );
      res.writeHead(200, { "content-type": "image/png" }).end(png);
    } catch (err) {
      const tail = err instanceof RenderError ? err.stderrTail : String(err);
      console.error("render failed:", tail);
      res.writeHead(500).end("render failed");
    }
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`preview container listening on ${PORT}`));
