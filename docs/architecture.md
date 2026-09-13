# roamux — Architecture (V0, as-built)

This document explains how roamux is put together **today**: the components,
the trust boundaries, the message protocol, and the data flows for the core
actions (pairing, prompting, streaming events, stopping, and permissions).

> Looking for where the product is headed — multi-host, Ably transport,
> accounts, daemon-owned sessions, multiple agent harnesses? That is the
> **design of record** in [`beta-architecture.md`](beta-architecture.md). This
> file stays the faithful record of the **V0 code that actually runs**.

If you only read one thing, read **§2 Trust boundaries** — the whole design
exists to keep those lines intact.

---

## 1. System overview

roamux is a **remote control plane for local AI coding agents**. Your
machine stays the execution host; a phone or remote browser watches and steers
the local agent through a relay. The agent runtime for V0 is
[OpenCode](https://opencode.ai) — roamux does **not** implement its own agent.

```mermaid
flowchart TD
  subgraph remote["📱 Remote (untrusted network)"]
    B["Browser / Phone PWA<br/>(apps/web)"]
  end

  subgraph cloud["☁️ Relay (dumb router — no secrets, no FS)"]
    R["Relay<br/>(apps/relay · Bun.serve)"]
  end

  subgraph local["💻 Your machine (trusted host)"]
    H["Host daemon<br/>(apps/host)"]
    OC["OpenCode server<br/>(127.0.0.1 only)"]
    M["Model / provider<br/>(your key or local Ollama)"]
    FS["Repo · shell · git · creds"]
  end

  B <-->|"WebSocket<br/>(client protocol)"| R
  R <-->|"WebSocket<br/>(host protocol)"| H
  H <-->|"localhost HTTP + SSE<br/>(@opencode-ai/sdk)"| OC
  OC --> M
  OC --- FS

  classDef trusted fill:#0b3d2e,stroke:#34d399,color:#e6fff5
  classDef untrusted fill:#3d0b0b,stroke:#f87171,color:#ffe6e6
  classDef neutral fill:#1e293b,stroke:#64748b,color:#e2e8f0
  class H,OC,M,FS trusted
  class B untrusted
  class R neutral
```

**Direction of trust:** the host is fully trusted (it's your machine), the
browser is untrusted (anyone on any network), and the relay is *semi-trusted* —
it routes bytes but is deliberately given nothing worth stealing.

---

## 2. Trust boundaries (the rules that never bend)

These are enforced in code and asserted in tests. Violating any of them is a
release blocker (see [`CLAUDE.md`](../CLAUDE.md) §3).

1. **OpenCode binds to `127.0.0.1` only.** The host spawns `opencode serve
   --hostname 127.0.0.1`, and an externally supplied `OPENCODE_URL` is rejected
   unless it is localhost.
2. **The host dials out.** The host initiates the WebSocket to the relay; the
   relay can never dial into the host. No local port is exposed publicly.
3. **The relay only routes authenticated pairs.** A host registers a pairing
   token; a client must present the *same* token before anything is routed to or
   from it.
4. **No secrets cross to the relay.** Shell env, credentials, model keys, and
   filesystem contents never leave the host.
5. **No arbitrary remote execution.** Only the explicit `RemoteCommand` variants
   do anything — validated twice (Zod at the relay, a closed `switch` at the
   host). There is no "run this shell string" command by design.

```mermaid
flowchart LR
  B["Browser"] -->|"only RemoteCommand<br/>(Zod-validated)"| R["Relay"]
  R -->|"only if paired"| H["Host"]
  H -->|"only normalized<br/>AgentEvent"| R
  R --> B

  X1["❌ filesystem access"] -.-> R
  X2["❌ credentials / env"] -.-> R
  X3["❌ inbound dial to host"] -.-> H
  X4["❌ arbitrary shell exec"] -.-> H

  classDef bad fill:#3d0b0b,stroke:#f87171,color:#ffe6e6,stroke-dasharray: 4 3
  class X1,X2,X3,X4 bad
```

---

## 3. The one abstraction boundary

roamux should eventually drive *any* agent runtime, so exactly one seam is
designed up front and kept pristine:

```
roamux protocol   ⇕   AgentAdapter   ⇕   OpenCode
```

- Everything above the adapter (host, relay, web) speaks only the **normalized
  protocol** — a small vocabulary of commands and events.
- Everything OpenCode-specific lives **only** inside `OpenCodeAdapter`.
  `@opencode-ai/sdk` is imported in that one file and nowhere else.
- Swapping in `OpenHandsAdapter` or `AiderAdapter` later touches nothing else.

> This single V0 seam becomes **three** in Beta (`Transport` ⇔ protocol ⇔
> `HarnessAdapter`, with `HostSessionManager` owning lifecycle). See
> [`beta-architecture.md`](beta-architecture.md) §3.

```mermaid
classDiagram
  class AgentAdapter {
    <<interface>>
    +name: string
    +start() Promise
    +listSessions() Promise~AgentSession[]~
    +createSession(projectPath) Promise~AgentSession~
    +sendPrompt(sessionId, text) Promise
    +abortSession(sessionId) Promise
    +respondToPermission(sessionId, permissionId, response) Promise
    +events() AsyncIterable~SessionEvent~
    +stop() Promise
  }
  class MockAgentAdapter {
    scripts a deterministic run
    no model, no network
  }
  class OpenCodeAdapter {
    wraps @opencode-ai/sdk
    normalizes SSE → AgentEvent
  }
  AgentAdapter <|.. MockAgentAdapter
  AgentAdapter <|.. OpenCodeAdapter
```

---

## 4. Components

| Component | Package | Responsibility |
|---|---|---|
| **Web** | `apps/web` | Mobile-first Next.js PWA. One WebSocket to the relay; renders machines, sessions, live event stream, prompt box, Stop, and Allow/Deny cards. |
| **Relay** | `apps/relay` | Stateless-ish `Bun.serve` router. Pure `RelayCore` does pairing + routing; no agent logic, no filesystem. |
| **Host** | `apps/host` | Long-running daemon. Dials the relay (with reconnect), drives an `AgentAdapter`, tags events with per-session sequence numbers, persists identity + sequences in SQLite, manages the OpenCode process. |
| **Protocol** | `packages/protocol` | Versioned `Envelope<T>`, the command/event unions, and Zod schemas validated at every socket boundary. |
| **Adapters** | `packages/agent-adapters` | The `AgentAdapter` interface + `MockAgentAdapter` + `OpenCodeAdapter`. |

```mermaid
flowchart TB
  subgraph web["apps/web"]
    RC["RelayClient<br/>(useSyncExternalStore)"]
    UI["Pages: machines · session detail<br/>PermissionCard · EventLine"]
    UI --- RC
  end

  subgraph relay["apps/relay"]
    RCORE["RelayCore<br/>(pairing + routing, pure)"]
    RSRV["server.ts (Bun.serve)"]
    RSRV --- RCORE
  end

  subgraph host["apps/host"]
    CONN["RelayConnection<br/>(reconnect + 2 pumps)"]
    CMD["command-handler<br/>(closed switch)"]
    STORE["HostStore (SQLite)<br/>identity + sequences"]
    OCP["opencode-process<br/>(spawn on 127.0.0.1)"]
    CONN --- CMD
    CONN --- STORE
  end

  subgraph pkgs["packages"]
    PROTO["protocol (Zod)"]
    ADP["agent-adapters<br/>Mock · OpenCode"]
  end

  RC -->|protocol| RSRV
  RSRV -->|protocol| CONN
  CMD --> ADP
  CONN -->|"events()"| ADP
  OCP -.spawns.-> ADP
  web -.uses.-> PROTO
  relay -.uses.-> PROTO
  host -.uses.-> PROTO
  host -.uses.-> ADP
```

---

## 5. The protocol

Every message on every socket is wrapped in an **Envelope** and validated with
Zod on receipt. Nothing raw ever crosses a socket.

```ts
type Envelope<T> = {
  protocolVersion: 1        // bump = explicit breaking change
  messageId: string         // idempotency / tracing
  deviceId: string          // who sent it
  sessionId?: string        // which agent session (for events/commands)
  sequence?: number         // per-session monotonic (resume-ready, M3)
  timestamp: number
  message: T                // the actual command / event / control frame
}
```

There are three **directional** message unions, each its own Zod schema:

- **Client → Relay:** `client.hello` (pair with a token), `command` (a `RemoteCommand`).
- **Host → Relay:** `host.hello` (register token + info), `event`, `sessions.snapshot`, `host.state`.
- **Relay → Client:** `ack`, `hosts.list`, plus the host-originated `event` / `sessions.snapshot` / `host.state` fanned out.

### Commands (the entire remote-control surface)

```ts
type RemoteCommand =
  | { type: "prompt.send";       sessionId; text }
  | { type: "session.abort";     sessionId }
  | { type: "permission.respond"; sessionId; permissionId; response: "allow" | "deny" }
  | { type: "session.create";    projectPath }
  | { type: "sessions.list" }
```

### Events (normalized agent behavior — runtime-agnostic)

```ts
type AgentEvent =
  | { type: "session.started";     sessionId }
  | { type: "assistant.delta";     text }              // streaming token chunk
  | { type: "assistant.message";   text }              // finalized message
  | { type: "tool.started";        tool; input? }
  | { type: "tool.completed";      tool; output? }
  | { type: "terminal.output";     text }
  | { type: "file.changed";        path }
  | { type: "permission.requested"; permissionId; description; tool?; input? }
  | { type: "permission.resolved"; permissionId; response }
  | { type: "agent.waiting" }
  | { type: "agent.completed" }
  | { type: "agent.failed";        error }
```

The web UI only ever renders these — it has no knowledge that OpenCode exists.

---

## 6. Key flows

### 6.1 Pairing

The host prints a one-time token; the browser presents it; the relay binds them.

```mermaid
sequenceDiagram
  participant H as Host
  participant R as Relay
  participant B as Browser

  H->>R: host.hello { token, info }
  R->>R: hostsByToken[token] = host
  Note over B: user pastes token<br/>(or opens /pair?token=…)
  B->>R: client.hello { token }
  R->>R: associate client ↔ token
  R-->>B: ack { ok: true }
  R-->>B: hosts.list [ { name, online } ]
```

### 6.2 Prompt → live event stream → completion

The headline path: an instruction from the phone reaches the local model and its
work streams back live.

```mermaid
sequenceDiagram
  participant B as Browser
  participant R as Relay
  participant H as Host
  participant A as OpenCodeAdapter
  participant OC as OpenCode
  participant M as Model

  B->>R: command prompt.send { sessionId, text }
  R->>H: (forward, only if paired)
  H->>A: sendPrompt(sessionId, text)
  A->>OC: POST /session/{id}/prompt_async
  OC->>M: run with tools
  loop streaming (OpenCode SSE)
    OC-->>A: message.part.updated / tool / permission …
    A-->>H: normalized AgentEvent (session-tagged)
    H->>H: seq = store.nextSequence(sessionId)
    H-->>R: event { …, sequence: seq }
    R-->>B: event (fan-out to paired clients)
    B->>B: render (fold deltas, append lines)
  end
  OC-->>A: session.idle
  A-->>H: agent.completed
  H-->>R: event agent.completed
  R-->>B: event agent.completed
```

### 6.3 Stop (remote abort)

```mermaid
sequenceDiagram
  participant B as Browser
  participant R as Relay
  participant H as Host
  participant OC as OpenCode
  B->>R: command session.abort { sessionId }
  R->>H: forward
  H->>OC: POST /session/{id}/abort
  OC-->>H: session.idle
  H-->>R: event agent.completed
  R-->>B: event agent.completed
```

### 6.4 Permission (the main product feature)

The agent pauses; the phone decides; the agent resumes.

```mermaid
sequenceDiagram
  participant OC as OpenCode
  participant H as Host
  participant R as Relay
  participant B as Browser

  OC-->>H: permission.updated (agent blocked)
  H-->>R: event permission.requested { permissionId, description }
  R-->>B: event permission.requested
  Note over B: ⚠ "Run: bun test"  [Deny] [Allow]
  B->>R: command permission.respond { permissionId, "allow" }
  R->>H: forward
  H->>OC: POST /session/{id}/permissions/{permId} { response: "once" }
  OC-->>H: (agent resumes) → tool output, message, idle
  H-->>R: events … agent.completed
  R-->>B: events … (stream resumes)
```

`allow → "once"` and `deny → "reject"` in OpenCode's vocabulary.

---

## 7. Sequencing & reconnection

- Every event a host forwards carries a **per-session, monotonically increasing
  `sequence`**, allocated atomically in SQLite (`HostStore.nextSequence`).
- The host reconnects to the relay with exponential backoff; the browser client
  does the same to the relay.
- **Today** delivery is *at-most-once*: if the host↔relay link is down when an
  event fires, that event is dropped. Sequence numbers are already recorded, so
  **M3 resume** is a routing change (client sends last-seen `sequence`, host
  replays the gap) — not a protocol change. This is the whole reason sequencing
  exists from day one.

```mermaid
flowchart LR
  E["AgentEvent"] --> S["store.nextSequence(sessionId)"]
  S --> F["Envelope{ sequence }"]
  F --> W{"socket open?"}
  W -->|yes| SEND["send to relay"]
  W -->|no| DROP["dropped (M3: buffer + replay)"]
```

---

## 8. Persistence

The host keeps a tiny SQLite database (`HOST_DB_PATH`, default
`.roamux/host.sqlite`):

- **`identity`** — a stable `deviceId`, the current `pairingToken`, and the
  machine `name`, so a host keeps its identity across restarts.
- **`sequences`** — the last sequence number per session.

Session *content* is intentionally **not** persisted in V0 (session history is an
M3 item). Postgres is deliberately avoided; SQLite keeps the host self-contained.

---

## 9. Technology choices & why

| Area | Choice | Why |
|---|---|---|
| Runtime / PM | **Bun** | Fast, built-in WebSocket server/client, SQLite, and test runner — fewer moving parts. |
| Language | **TypeScript (strict)** | One language across host/relay/web + shared protocol types. |
| Validation | **Zod** | Parse at every trust boundary; schema *is* the source of truth. |
| Web | **Next.js + React + Tailwind** | Mobile-first PWA quickly; `useSyncExternalStore` binds cleanly to a vanilla WS client. |
| Relay transport | **WebSockets** | Bidirectional, ordered, low-latency; ordering matters for event streams. |
| Persistence | **SQLite** | Zero-config, host-local, survives restarts. Postgres deferred. |
| Agent runtime | **OpenCode** | Mature OSS agent with an HTTP + SSE API and a typed SDK — bring-your-own-model. |

Explicitly **not** used in V0: Kubernetes, Kafka, NATS, Temporal, Redis,
microservices, native mobile apps, custom inference, or a custom agent — all
would add weight without earning it at this stage.

---

## 10. Where to look in the code

| To understand… | Read… |
|---|---|
| The wire format | `packages/protocol/src/{envelope,commands,events}.ts` |
| The adapter seam | `packages/agent-adapters/src/types.ts` |
| OpenCode mapping | `packages/agent-adapters/src/opencode-adapter.ts` |
| Pairing + routing | `apps/relay/src/core.ts` |
| Reconnect + event pump | `apps/host/src/relay-connection.ts` |
| Command dispatch | `apps/host/src/command-handler.ts` |
| The end-to-end proof | `apps/host/src/e2e.test.ts` |
| The client store | `apps/web/src/lib/relay-client.ts` |

See also [`../README.md`](../README.md) for how to run everything and
[`../CLAUDE.md`](../CLAUDE.md) for the contributor working agreement.
