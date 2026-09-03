import type { HostToRelay, RemoteCommand } from "@openremote/protocol"
import type { HostSessionManager } from "./host-session-manager.js"

/**
 * Translate a validated RemoteCommand into HostSessionManager / adapter calls.
 * Pure with respect to transport: returns any host→relay messages to send back
 * immediately (e.g. a fresh sessions/projects snapshot). Live agent output
 * arrives asynchronously via the adapter event stream, not from here.
 *
 * This is the entire server-side authorization surface: only these command
 * types do anything, and session.create is validated (approved project +
 * installed harness) inside the manager. There is no arbitrary-path or
 * arbitrary-command escape hatch (CLAUDE.md §3, Beta §13.2).
 */
export async function handleCommand(
  manager: HostSessionManager,
  command: RemoteCommand,
): Promise<HostToRelay[]> {
  const adapter = manager.primary()

  switch (command.type) {
    case "prompt.send": {
      await adapter?.sendPrompt(command.sessionId, command.text)
      return []
    }

    case "session.abort": {
      await adapter?.abortSession(command.sessionId)
      return []
    }

    case "permission.respond": {
      await adapter?.respondToPermission(command.sessionId, command.permissionId, command.response)
      return []
    }

    case "session.create": {
      // Validated inside the manager (approved projectId + installed harness).
      await manager.createSession({
        projectId: command.projectId,
        harnessType: command.harnessType,
        initialPrompt: command.initialPrompt,
      })
      const sessions = await manager.listSessions()
      return [{ kind: "sessions.snapshot", sessions }]
    }

    case "sessions.list": {
      const sessions = await manager.listSessions()
      return [{ kind: "sessions.snapshot", sessions }]
    }

    case "projects.list": {
      const capabilities = await manager.capabilities()
      return [{ kind: "projects.snapshot", capabilities }]
    }
  }
}
