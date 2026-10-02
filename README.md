# opencode-artifacts

An OpenCode plugin that publishes commentable HTML artifacts. It ships three
things.

- A tool namespace `artifact` with `artifact_publish` and `artifact_list`.
- A shared comment server. One instance serves every artifact. Readers highlight
  text, leave a comment, and the comment is dispatched into the OpenCode session
  that published the artifact.
- A skill, `artifact-comments`, that tells the agent how to build and publish
  commentable artifacts.

## How it works

The plugin injects a small client script into each artifact it publishes. The
client adds the highlight and comment layer. When a comment is sent, the client
posts it to the shared comment server, which appends it to the artifact's comment
log and calls `opencode api post /api/session/<id>/prompt` to send the comment and
the selected text into the session.

One server, many artifacts. Each artifact records the session that published it,
so comments route back to the right session. The server is a singleton on its
port. If a second instance starts, it sees the first on the health check and
exits.

## Install

Clone the repo, then add it to `~/.config/opencode/opencode.jsonc`.

```jsonc
{
  "plugins": [
    { "package": "opencode-artifacts", "options": { "port": 4789 } }
  ]
}
```

For a local checkout, either point at the package directory or add a thin
re-export, the pattern used by `opencode-jump-sidebar`.

```jsonc
{ "plugins": ["file:///Users/me/repos/opencode-artifacts/src/index.ts"] }
```

```ts
// ~/.config/opencode/artifacts/index.ts
export { default } from "/Users/me/repos/opencode-artifacts/src/index.ts"
```

## Tools

### artifact_publish

Publish an HTML page as a commentable artifact.

- `html` full HTML as a string.
- `file` path to an HTML file instead of inline html.
- `title` human title.
- `id` optional stable id. Publishing the same id again updates the artifact.

Returns the URL, for example `http://127.0.0.1:4789/a/q3-delivery-tracker`.

### artifact_list

List published artifacts and their URLs.

## Configuration

- `port` comment server port. Default 4789.
- `dataDir` where artifacts and comments are stored. Default
  `~/.local/share/opencode/artifacts`.

Environment overrides are `ARTIFACT_COMMENT_PORT`, `ARTIFACT_DATA_DIR` and
`OPENCODE_BIN`.

## Run the server on its own

```
node src/server/comment-server.mjs
```

The plugin starts it automatically when needed. Run it directly only when you want
it up before the first publish, or to debug.

## Layout

```
src/index.ts                  plugin, tools and skill registration
src/server/comment-server.mjs singleton comment server
src/server/client.js          comment client injected into artifacts
src/skill/SKILL.md            how to build commentable artifacts
```
