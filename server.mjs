import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8787;
const HOST = "127.0.0.1";

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

function runUpdate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "update-data.mjs")], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `update failed with code ${code}`));
      }
    });
  });
}

async function serveFile(res, relPath) {
  const safePath = relPath === "/" ? "/index.html" : relPath;
  const filePath = path.join(__dirname, safePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8"
  }[ext] || "text/plain; charset=utf-8";

  try {
    const content = await fs.readFile(filePath);
    send(res, 200, content, type);
  } catch {
    send(res, 404, JSON.stringify({ ok: false, error: "not found" }));
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return send(res, 400, JSON.stringify({ ok: false, error: "missing url" }));

  if (req.method === "POST" && req.url === "/api/manual-update") {
    try {
      const result = await runUpdate();
      return send(res, 200, JSON.stringify({ ok: true, detail: result.stdout.trim() || "updated" }));
    } catch (err) {
      return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === "GET") {
    return serveFile(res, req.url.split("?")[0]);
  }

  return send(res, 405, JSON.stringify({ ok: false, error: "method not allowed" }));
});

server.on("error", (err) => {
  console.error(`Server failed: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard server running at http://${HOST}:${PORT}`);
});
