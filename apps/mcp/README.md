# @openremote/mcp — roamux MCP server

Exposes roamux's control surface as **MCP tools**, so any MCP client (Claude
Desktop today) can list and drive the agent sessions on your hosts — without
roamux's own web UI. It's **additive**: the MCP server is just another roamux
*client*, speaking the same Zod-validated envelopes over the same per-user Ably
channels the browser uses. No host or protocol changes.

## Status

- **v1 (this package): stdio transport**, authed with the shared Ably key. Works
  with **Claude Desktop** on the same machine. Great for driving your hosts and
  for proving the tool surface end-to-end.
- **Remote / phone access** (Claude mobile, ChatGPT) needs the **HTTP transport +
  OAuth** layer — a follow-up served as a route in `apps/web` (Supabase-delegated
  auth → per-user scoped Ably token). The tools and `RoamuxClient` here are
  transport-agnostic and reused verbatim by that layer.

## Tools

| Tool | What it does |
| --- | --- |
| `roamux_list_sessions` | sessions on a host |
| `roamux_list_projects` | approved projects + installed harnesses (valid `start_session` inputs) |
| `roamux_start_session` | create a session for an approved project + harness |
| `roamux_send_prompt` | send an instruction to a session |
| `roamux_get_activity` | poll a session's recent activity (read-only) |
| `roamux_stop_session` | abort a session |
| `roamux_respond_permission` | allow/deny a permission the agent is waiting on |

There is **no generic "run anything" tool** — the surface mirrors roamux's closed
`RemoteCommand` union, so an MCP client can do only what a browser client can
(CLAUDE.md §3).

`hostId` comes from your machines list in the roamux web UI (v1 has no
host-discovery tool; that's a follow-up).

## Run it

```sh
ABLY_API_KEY=<the roamux Ably key> bun run apps/mcp/src/index.ts
```

Config (env):

- `ABLY_API_KEY` (or `OPENREMOTE_ABLY_KEY`) — **required**. The MCP server is a
  trusted, server-side client.
- `ROAMUX_MCP_USER_ID` — which user namespace to operate in (default: `local`).
- `ROAMUX_MCP_ACTIVITY_WINDOW_MS` — how long each tool gathers streamed events
  before returning (default: `2500`).

## Add to Claude Desktop

In your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "roamux": {
      "command": "bun",
      "args": ["run", "/abs/path/to/roamux/apps/mcp/src/index.ts"],
      "env": { "ABLY_API_KEY": "<the roamux Ably key>" }
    }
  }
}
```

Then ask Claude things like *"list the sessions on host `<id>`"* or *"start a
claude-code session on host `<id>` in project `<id>` and tell it to fix the
failing test."*

## Streaming → polling

Agent runs stream over time, but MCP tools are request/response. So
`send_prompt` returns the activity seen in a short window, and you poll
`get_activity` to follow a long run until you see `agent.completed` /
`agent.waiting`. (Backing `get_activity` with persisted history — issue #109 — is
the clean long-term source.)

## Tests

```sh
bun test apps/mcp/
```

No live Ably or model: a fake Transport captures the command the client sends and
feeds back host replies.
