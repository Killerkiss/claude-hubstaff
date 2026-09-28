# claude-hubstaff

Hubstaff time tracking inside [Claude Code](https://code.claude.com). Ask Claude to start, stop or
switch your Hubstaff timer by project, task title or tracker key (e.g. a Jira key), or pick a task
from a list with `/hubstaff:track`.

```
> start PROJ-743
Tracking: Website → Fix checkout rounding bug (task id 1654321)

> what am I tracking?
> stop
> /hubstaff:track            # pick project → task
> /hubstaff:track invoice    # start the task whose title matches
```

The timer is driven through the Hubstaff desktop app, so time tracked this way is identical to
clicking Start in the app: screenshots, activity levels and limits all apply as usual.

## Requirements

- The **Hubstaff desktop app** installed, running and signed in (Windows, macOS or Linux).
  The first time a command reaches it, Hubstaff may ask to allow remote control. Choose
  **Always allow**.
- **Node.js 20+** on your `PATH`.
- Optional: a Hubstaff **personal access token**, only needed to look tasks up by key when the
  desktop app hasn't cached them (see [How it finds tasks](#how-it-finds-tasks)).

## Install

In Claude Code (terminal):

```
/plugin marketplace add Killerkiss/claude-hubstaff
/plugin install hubstaff@claude-hubstaff
```

In the Claude desktop app (Code tab): **+ → Plugins → Add plugin**, add the marketplace
`Killerkiss/claude-hubstaff`, then install **hubstaff**.

Claude Code asks for the optional settings when the plugin is enabled. The token is stored in your
system's credential store, never in plain-text settings.

### Personal access token (optional)

1. Open <https://developer.hubstaff.com/personal_access_tokens> and create a token.
2. Paste it into the plugin's **Hubstaff personal access token** setting.

Hubstaff tokens rotate: every exchange returns a new refresh token. The plugin keeps the current one
in its private data directory (`~/.claude/plugins/data/…/auth.json`, mode `600`) and starts over
from your configured token if you change it.

## Tools

The plugin adds an MCP server named `hubstaff`:

| Tool        | What it does                                                               |
| ----------- | -------------------------------------------------------------------------- |
| `status`    | What the timer is tracking now, and time today on that project             |
| `projects`  | Projects you can track                                                     |
| `tasks`     | Trackable tasks of a project, with tracker keys; optional text filter      |
| `find_task` | Find a task by key, Hubstaff id or title words                             |
| `start`     | Start a task (key, id or title words) or a project; switches if one is running |
| `stop`      | Stop the timer                                                             |
| `resume`    | Resume the last project/task                                               |

Plus the `/hubstaff:track [key | words | stop | resume | status]` skill.

## How it finds tasks

| Source                          | Gives                                    | Needs                  |
| ------------------------------- | ---------------------------------------- | ---------------------- |
| Hubstaff desktop CLI            | Start/stop/status, projects, tasks       | Desktop app running    |
| Desktop app's local task cache  | Tracker keys (`PROJ-743`) for your tasks | Nothing                |
| Hubstaff public API v2          | Tracker keys when the cache lacks them   | Personal access token  |

A key is resolved from the local cache first, then the API (if a token is set), then from task
titles that contain the key. Hubstaff's public API has no endpoint to start or stop a timer, which is
why the desktop app is required.

## Configuration

| Setting / env var      | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `hubstaff_token`       | Personal access token (plugin setting → `HUBSTAFF_PAT`)         |
| `hubstaff_cli_path`    | Path to `HubstaffCLI` if installed in a non-standard location   |
| `HUBSTAFF_DATA_DIR`    | Override the desktop app's data directory (task cache)          |
| `HUBSTAFF_LOG_LEVEL`   | `debug`, `info` (default), `warn`, `error`; logs go to stderr   |

Default `HubstaffCLI` locations searched:

- **Linux**: `~/Hubstaff/HubstaffCLI.bin.x86_64` (also `/opt/Hubstaff`)
- **macOS**: `/Applications/Hubstaff.app/Contents/MacOS/HubstaffCLI`
- **Windows**: `%ProgramFiles%\Hubstaff\HubstaffCLI.exe`

## Limitations

- Hubstaff labels desktop scripted control as beta; command output can change between app versions.
- The local task cache format is undocumented. If it changes, key lookup falls back to the API.
- Tested on Linux. macOS and Windows paths follow Hubstaff's documentation; reports welcome.

## Relation to Hubstaff's MCP server

Hubstaff offers its own [MCP server](https://support.hubstaff.com/hubstaff-mcp-server/) for
owners and managers. It is read-only and aimed at reporting. This plugin is for everyone who
tracks time, and controls the timer itself. The two work well side by side.

## Development

```bash
npm ci
npm run check      # typecheck, tests, build
npm run validate   # claude plugin validate (needs the claude CLI)
```

`plugins/hubstaff/dist/server.mjs` is a committed bundle so installs need no `npm install`. Run
`npm run build` and commit it with source changes; CI fails if it is stale.

To try a local checkout: `/plugin marketplace add /path/to/claude-hubstaff`.

Changes to `main` go through pull requests with passing CI.

## License

[MIT](LICENSE)
