import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"

// Paths are resolved from this module, so the plugin works from a git checkout
// or from a thin re-export in the OpenCode config directory.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(HERE, "server", "comment-server.mjs")
const SKILL = path.join(HERE, "skill", "SKILL.md")

const DEFAULT_PORT = 4789

function serverURL(port: number) {
  return `http://127.0.0.1:${port}`
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(serverURL(port) + "/health", { signal: AbortSignal.timeout(800) })
    if (!res.ok) return false
    const body: any = await res.json()
    return body?.service === "opencode-artifacts"
  } catch {
    return false
  }
}

// Start the shared comment server if it is not already running. The server is a
// singleton on its port, so a second start exits quietly.
async function ensureServer(port: number, dataDir: string): Promise<boolean> {
  if (await isHealthy(port)) return true
  try {
    const child = spawn(process.execPath, [SERVER], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ARTIFACT_COMMENT_PORT: String(port), ARTIFACT_DATA_DIR: dataDir },
    })
    child.unref()
  } catch {
    return false
  }
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 160))
    if (await isHealthy(port)) return true
  }
  return false
}

function slug(value: string) {
  const cleaned = (value || "artifact").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
  return cleaned || "artifact"
}

function injectClient(html: string, id: string, port: number) {
  if (html.includes("__ARTIFACT__")) return html
  const tag =
    `\n<script>window.__ARTIFACT__={id:${JSON.stringify(id)},server:${JSON.stringify(serverURL(port))}};</script>\n` +
    `<script src="${serverURL(port)}/client.js"></script>\n`
  return html.includes("</body>") ? html.replace(/<\/body>/i, tag + "</body>") : html + tag
}

export default Plugin.define({
  id: "safety-adam.artifacts",
  async setup(ctx) {
    const options: any = (ctx as any).options || {}
    const port = Number(options.port || process.env.ARTIFACT_COMMENT_PORT || DEFAULT_PORT)
    const dataDir = String(options.dataDir || process.env.ARTIFACT_DATA_DIR || path.join(os.homedir(), ".local/share/opencode/artifacts"))

    void ensureServer(port, dataDir).catch(() => {})

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "artifact", description: "Publish and manage commentable HTML artifacts" })

      editor.add({
        name: "publish",
        description:
          "Publish an HTML artifact that readers can comment on. Provide the full HTML, or a file path. The comment client is injected automatically and the artifact is served by the shared comment server. Returns the URL to open and share.",
        input: {
          type: "object",
          properties: {
            html: { type: "string", description: "Full HTML of the artifact" },
            file: { type: "string", description: "Path to an HTML file to publish instead of inline html" },
            title: { type: "string", description: "Human title for the artifact" },
            id: { type: "string", description: "Optional stable id. Publishing the same id again updates the artifact in place" },
          },
          additionalProperties: false,
        },
        async execute(input, context) {
          const args = input as { html?: string; file?: string; title?: string; id?: string }
          const ready = await ensureServer(port, dataDir)
          if (!ready) return { content: "Could not start the comment server on port " + port }

          let html = args.html
          if (!html && args.file) {
            try {
              html = await readFile(args.file, "utf8")
            } catch (err: any) {
              return { content: "Could not read " + args.file + ". " + (err?.message || err) }
            }
          }
          if (!html) return { content: "Provide html or file" }

          const id = args.id ? slug(args.id) : slug(args.title || "artifact") + "-" + Math.random().toString(36).slice(2, 7)
          const dir = path.join(dataDir, id)
          await mkdir(dir, { recursive: true })
          const filePath = path.join(dir, "index.html")
          await writeFile(filePath, injectClient(html, id, port))

          const sessionID = (context as any)?.sessionID || ""
          const res = await fetch(serverURL(port) + "/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, title: args.title || id, file: filePath, session: sessionID }),
          })
          const data: any = await res.json().catch(() => ({}))
          const url = data?.url || serverURL(port) + "/a/" + id
          return { content: "Artifact published: " + url + "\nId: " + id }
        },
      } as any)

      editor.add({
        name: "list",
        description: "List published artifacts from the shared comment server.",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute() {
          const ready = await ensureServer(port, dataDir)
          if (!ready) return { content: "Comment server is not running" }
          const res = await fetch(serverURL(port) + "/artifacts")
          const data: any = await res.json().catch(() => ({ artifacts: [] }))
          const items = (data.artifacts || []).map((a: any) => a.id + "  " + a.title + "  " + serverURL(port) + "/a/" + a.id)
          return { content: items.length ? items.join("\n") : "No artifacts yet" }
        },
      } as any)
    })

    try {
      const content = await readFile(SKILL, "utf8")
      await ctx.skill.transform((editor) => {
        editor.add({
          id: "artifact-comments",
          name: "Commentable artifacts",
          description:
            "Use when creating, publishing or updating an HTML artifact that the user should be able to comment on, when the user asks to comment on an artifact, or when the user wants a rich HTML page delivered with inline comments. Covers the artifact_publish tool, the shared comment server, and how comments return to the session.",
          path: SKILL,
          content,
        })
      })
    } catch {
      /* skill file missing, plugin still works */
    }
  },
})
