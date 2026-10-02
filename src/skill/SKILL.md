---
name: Commentable artifacts
description: Use when creating, publishing or updating an HTML artifact that the user should be able to comment on, when the user asks to comment on an artifact, or when the user wants a rich HTML page delivered with inline comments.
---

# Commentable artifacts

An artifact is an HTML page delivered to the user. A commentable artifact adds a
highlight and comment layer. The user selects text, writes a comment, and the
comment returns to this session as a prompt that includes the selected text.

Use this skill whenever you produce an HTML page for the user, such as a report,
a tracker, a dashboard or a one off visual. Publish it with the tool below so the
user can comment on it.

## Publish

Call `artifact_publish` with the page.

- `html` is the full HTML as a string. Use this for short pages.
- `file` is a path to an HTML file. Use this for long pages, or when you already
  wrote the file to disk.
- `title` is a short human title.
- `id` is optional. Reuse an id to update an artifact in place. Omit it and the
  tool makes a new one.

The tool returns a URL. Give the URL to the user. Open it in the browser to read
and comment.

Example.

```
artifact_publish({
  title: "Q3 delivery tracker",
  file: "/path/to/tracker.html"
})
```

Then list existing artifacts with `artifact_list` if you need the URLs again.

## Rules for the HTML

1. Write one self contained file. Inline the CSS and any small scripts.
2. Do not add a comment button or comment UI. The comment client is injected
   automatically when you publish, and it adds the highlight, the popover and the
   count badge.
3. Do not add external scripts or trackers. A remote font or image is fine.
4. Keep it responsive. The user may open it on a narrow window.

## How comments come back

When the user sends a comment, the shared comment server dispatches it into this
session as a prompt. The prompt names the artifact and the file, quotes the
selected text, gives a short context line, and then the comment. It ends with an
instruction to update the artifact if the comment asks for a change.

When you receive one of these prompts.

1. Read the selected text and the comment.
2. Find the matching part of the artifact source.
3. Make the change.
4. Publish again with the same `id` so the URL stays the same, or edit the source
   file and publish again.

## The shared server

One comment server instance serves every artifact. The plugin starts it on first
use and keeps it running. It listens on port 4789 by default. Many artifacts, from
many sessions, share the one instance. Each artifact records the session that
published it, so comments route back to the right session.

The server stores artifacts and comments under
`~/.local/share/opencode/artifacts/`. Do not edit those files by hand.

## Troubleshooting

- If the page shows a relay offline badge, the comment server is not running. It
  starts on the next publish, or run `node src/server/comment-server.mjs` from the
  plugin checkout.
- If comments arrive without a selected text, the user commented on a whole
  region. Use the context line to find the right place.
