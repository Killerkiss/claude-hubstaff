---
name: start
description: Start the Hubstaff timer on a task by tracker key, task id or title words.
argument-hint: "<task key | task id | title words>"
disable-model-invocation: true
---

Task: `$ARGUMENTS`

- If no task was given, ask which one, or suggest `/hubstaff:track` to pick from a list.
- Otherwise call the `start` tool of the `hubstaff` MCP server with `task` set to it.
- If it returns candidates, show them as a short numbered list (`KEY · title`), ask which one,
  then call `start` with that task's key or id.
- If the key isn't found and the `tos-track` skill is available, the key may be a Transformation
  OS key: follow that skill to resolve it.
- On success, reply in one or two lines: what is tracking now and what was stopped, if anything.
