import type { HarnessAdapter } from "@openremote/agent-adapters"
import type { HostToRelay, RemoteCommand } from "@openremote/protocol"

/**
 * Translate a validated RemoteCommand into HarnessAdapter calls. Pure with
 * respect to transport: it takes an adapter and returns any host→relay messages
 * that should be sent back immediately (e.g. a fresh sessions snapshot). Live
 * agent output arrives asynchronously via adapter.events(), not from here.
 *
 * This is the entire server-side authorization surface: only these command
 * types do anything. Anything else is a no-op (defense in depth on top of the
 * relay's Zod validation).
 */
export async function handleCommand(
  adapter: HarnessAdapter,
  command: RemoteCommand,
): Promise<HostToRelay[]> {
  switch (command.type) {
    case "prompt.send": {
      await adapter.sendPrompt(command.sessionId, command.text)
      return []
    }

    case "session.abort": {
      await adapter.abortSession(command.sessionId)
      return []
    }

    case "permission.respond": {
      await adapter.respondToPermission(command.sessionId, command.permissionId, command.response)
      return []
    }

    case "session.create": {
      await adapter.createSession(command.projectPath)
      const sessions = await adapter.listSessions()
      return [{ kind: "sessions.snapshot", sessions }]
    }

    case "sessions.list": {
      const sessions = await adapter.listSessions()
      return [{ kind: "sessions.snapshot", sessions }]
    }
  }
}
