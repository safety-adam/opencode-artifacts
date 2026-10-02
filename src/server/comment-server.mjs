// Shared comment server for OpenCode artifacts.
//
// One instance serves every artifact. Each artifact registers with a session id
// and a file path. When a reader highlights text on an artifact and leaves a
// comment, the server appends the comment and dispatches it into the session as
// a prompt.
//
// Singleton behaviour. The server binds a fixed port. If the port is already
// served by another instance of this server it exits quietly, so many plugins
// and many artifacts share the one running instance.
//
// Run directly with `node comment-server.mjs`, or let the plugin start it.
//
// Environment:
//   ARTIFACT_COMMENT_PORT  port to listen on (default 4789)
//   ARTIFACT_DATA_DIR      where artifacts and comments live (default under ~/.local/share/opencode/artifacts)
//   OPENCODE_BIN           path to the opencode binary (default "opencode")

import http from "node:http";
import { readFile, writeFile, appendFile, mkdir, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_FILE = path.join(HERE, "client.js");
const SERVICE = "opencode-artifacts";
const VERSION = "0.1.0";

const PORT = Number(process.env.ARTIFACT_COMMENT_PORT || 4789);
const DATA_DIR = process.env.ARTIFACT_DATA_DIR || path.join(os.homedir(), ".local/share/opencode/artifacts");
const REGISTRY = path.join(DATA_DIR, "registry.json");
const LOCK = path.join(DATA_DIR, "server.pid");
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";
const FALLBACK_SESSION = process.env.OPENCODE_SESSION || "";

const registry = new Map();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function loadRegistry() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(REGISTRY, "utf8");
    for (const item of JSON.parse(raw)) registry.set(item.id, item);
  } catch { /* first run */ }
}
async function saveRegistry() {
  await writeFile(REGISTRY, JSON.stringify([...registry.values()], null, 2));
}
function commentsFile(id) { return path.join(DATA_DIR, id + ".comments.jsonl"); }

async function readComments(id) {
  try {
    const raw = await readFile(commentsFile(id), "utf8");
    return raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function dispatchToSession(session, entry) {
  const lines = [
    "A comment was left on an artifact.",
    "Artifact: " + entry.artifact + (entry.title ? " (" + entry.title + ")" : ""),
    entry.file ? "File: " + entry.file : null,
    entry.selection ? "Selected text: \"" + entry.selection + "\"" : null,
    entry.context ? "Context: " + entry.context : null,
    "Comment: " + entry.comment,
    "",
    "Process this comment. Update the artifact if the comment asks for a change."
  ].filter(Boolean).join("\n");
  const payload = JSON.stringify({ text: lines, delivery: "queue" });
  return new Promise((resolve) => {
    execFile(OPENCODE_BIN, ["api", "post", "/api/session/" + session + "/prompt", "--data", payload], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: String(err.message || err), stderr: stderr && stderr.slice(0, 400) });
      else resolve({ ok: true, response: (stdout || "").slice(0, 300) });
    });
  });
}

async function isServedElsewhere() {
  try {
    const r = await fetch("http://127.0.0.1:" + PORT + "/health", { signal: AbortSignal.timeout(700) });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.service === SERVICE;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, service: SERVICE, version: VERSION, pid: process.pid, port: PORT, artifacts: registry.size });
    return;
  }

  if (req.method === "GET" && url.pathname === "/client.js") {
    try {
      const js = await readFile(CLIENT_FILE);
      cors(res);
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(js);
    } catch (e) { json(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  if (req.method === "GET" && url.pathname === "/artifacts") {
    json(res, 200, { ok: true, artifacts: [...registry.values()] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/register") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, 400, { ok: false, error: "invalid JSON" }); return; }
    if (!body.id) { json(res, 400, { ok: false, error: "id is required" }); return; }
    const item = {
      id: String(body.id),
      title: String(body.title || body.id),
      file: body.file ? String(body.file) : null,
      session: body.session ? String(body.session) : (registry.get(String(body.id))?.session || FALLBACK_SESSION),
      updated: new Date().toISOString()
    };
    registry.set(item.id, item);
    await saveRegistry();
    json(res, 200, { ok: true, artifact: item, url: "http://127.0.0.1:" + PORT + "/a/" + item.id });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/a/")) {
    const id = decodeURIComponent(url.pathname.slice(3));
    const item = registry.get(id);
    if (!item || !item.file) { json(res, 404, { ok: false, error: "unknown artifact" }); return; }
    try {
      await stat(item.file);
      cors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      createReadStream(item.file).pipe(res);
    } catch { json(res, 404, { ok: false, error: "artifact file missing" }); }
    return;
  }

  if (req.method === "GET" && url.pathname === "/comments") {
    const id = url.searchParams.get("artifact");
    if (!id) { json(res, 400, { ok: false, error: "artifact is required" }); return; }
    json(res, 200, { ok: true, comments: await readComments(id) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/comment") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, 400, { ok: false, error: "invalid JSON" }); return; }
    const artifact = String(body.artifact || "");
    const comment = String(body.comment || "").trim();
    if (!artifact) { json(res, 400, { ok: false, error: "artifact is required" }); return; }
    if (!comment) { json(res, 400, { ok: false, error: "comment is required" }); return; }

    const item = registry.get(artifact) || { id: artifact, title: artifact, file: null, session: FALLBACK_SESSION };
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: new Date().toISOString(),
      artifact,
      title: item.title,
      file: item.file,
      session: item.session,
      selection: String(body.selection || "").trim(),
      context: String(body.context || "").trim(),
      comment
    };
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(commentsFile(artifact), JSON.stringify(entry) + "\n");

    if (body.dry) { json(res, 200, { ok: true, dry: true, entry }); return; }
    if (!item.session) { json(res, 202, { ok: true, dispatched: false, entry, error: "no session registered for this artifact" }); return; }

    const result = await dispatchToSession(item.session, entry);
    json(res, result.ok ? 200 : 502, { ok: result.ok, entry, dispatch: result });
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
});

async function main() {
  await loadRegistry();

  if (await isServedElsewhere()) {
    console.log(SERVICE + " already running on port " + PORT + ", this instance will exit.");
    process.exit(0);
  }

  server.on("error", async (err) => {
    if (err && err.code === "EADDRINUSE") {
      if (await isServedElsewhere()) {
        console.log(SERVICE + " already running on port " + PORT + ", this instance will exit.");
        process.exit(0);
      }
      console.error("Port " + PORT + " is in use by another process.");
      process.exit(1);
    }
    console.error("Server error", err);
    process.exit(1);
  });

  server.listen(PORT, "127.0.0.1", async () => {
    try { await writeFile(LOCK, String(process.pid)); } catch {}
    console.log(SERVICE + " listening on http://127.0.0.1:" + PORT);
    console.log("Artifacts: " + registry.size + ". Data: " + DATA_DIR);
  });

  const shutdown = async () => {
    try { await unlink(LOCK); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
