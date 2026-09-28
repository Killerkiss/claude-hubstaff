---
name: track
description: Start, stop, switch or check the Hubstaff timer, or pick a Hubstaff project and task to track. Use when the user asks to start/stop/resume time tracking, switch tasks, track time on a task key (e.g. "start PROJ-743"), or asks what Hubstaff is tracking.
argument-hint: "[task key | task words | stop | resume | status]"
---

# Hubstaff time tracking

Use the tools of the `hubstaff` MCP server from this plugin: `status`, `projects`, `tasks`,
`find_task`, `start`, `stop`, `resume`. They drive the Hubstaff desktop app, so tracking behaves
exactly as if the user clicked Start in it.

Arguments: `$ARGUMENTS`

## What to do

- **`stop`** → call `stop`. **`resume`** → call `resume`. **`status`** → call `status`.
- **A tracker key** (like `PROJ-743`), a Hubstaff task id, or distinctive title words → call
  `start` with `task` set to it. If it returns candidates instead of starting, show them as a short
  numbered list and ask which one; then call `start` with that task's key or id.
- **No arguments** → run the picker:
  1. Call `status` and show one line with what is tracking now.
  2. Call `projects`; show a short numbered list (name only, mark the one being tracked).
  3. When the user picks a project, call `tasks` with its `project_id`; show a numbered list as
     `KEY · title` (omit the key when a task has none). For long lists, ask for a filter word and
     pass it as `query`.
  4. When the user picks a task, call `start` with its key (or id when it has no key).
  If this session has a tool that renders an interactive widget inline, you may render the lists
  as clickable buttons instead, where each button sends a message like `start PROJ-743`.

## Rules

- Starting a task switches away from the current one; say what was stopped and what is tracking now.
- Never start or stop the timer unless the user asked for it in this conversation.
- Keep replies to one or two lines once the action succeeds.
- If a tool reports that the Hubstaff CLI or app isn't available, relay its message: the desktop
  app must be installed, running and signed in, and on first use Hubstaff may ask to
  "Always allow" remote control.
