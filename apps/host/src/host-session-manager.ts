import type { HarnessAdapter } from "@openremote/agent-adapters"
import type { AgentSession, HostCapabilities } from "@openremote/protocol"
import type { HostStore } from "./store.js"

/**
 * HostSessionManager — owns daemon-side session creation for the host (Beta §6).
 *
 * It is the guardrail between a remote `session.create` and actually launching a
 * harness:
 *   1. validate the harnessType is INSTALLED on this host,
 *   2. resolve the client-supplied projectId → a locally APPROVED absolute path
 *      (clients never send paths, Beta §13.2),
 *   3. only then ask the adapter to create the session.
 *
 * V0 has a single adapter per host; the manager keys adapters by harness id so
 * multiple harnesses (OpenCode / Claude Code / …) can coexist later without
 * changing callers. It also reports the host's capabilities (approved projects +
 * installed harnesses) for the New Session picker.
 */
export class HostSessionManager {
  private readonly adapters = new Map<string, HarnessAdapter>()

  constructor(private readonly store: HostStore) {}

  /** Register a harness adapter under its id (e.g. "opencode"). */
  register(adapter: HarnessAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  /** The primary adapter (first registered) — used for legacy single-adapter paths. */
  primary(): HarnessAdapter | undefined {
    return this.adapters.values().next().value
  }

  adapterFor(harnessType: string): HarnessAdapter | undefined {
    return this.adapters.get(harnessType)
  }

  /** All sessions across all registered harnesses. */
  async listSessions(): Promise<AgentSession[]> {
    const all: AgentSession[] = []
    for (const adapter of this.adapters.values()) {
      all.push(...(await adapter.listSessions()))
    }
    return all
  }

  /** Approved projects + installed harnesses, for `projects.snapshot`. */
  async capabilities(): Promise<HostCapabilities> {
    const projects = this.store.listApprovedProjects().map((p) => ({ id: p.id, label: p.label }))
    const harnesses: HostCapabilities["harnesses"] = []
    for (const adapter of this.adapters.values()) {
      if (await adapter.isInstalled()) {
        harnesses.push({ id: adapter.id, displayName: adapter.displayName })
      }
    }
    return { projects, harnesses }
  }

  /**
   * Create a daemon-owned session from a validated request. Throws a clear error
   * (surfaced to the client as a failure) if the harness isn't installed or the
   * project isn't approved — the two guardrails that keep this from becoming an
   * arbitrary-code-execution surface.
   */
  async createSession(input: {
    projectId: string
    harnessType: string
    initialPrompt?: string
  }): Promise<AgentSession> {
    const adapter = this.adapters.get(input.harnessType)
    if (!adapter) throw new Error(`harness "${input.harnessType}" is not available on this host`)
    if (!(await adapter.isInstalled())) {
      throw new Error(`harness "${input.harnessType}" is not installed`)
    }
    const absPath = this.store.resolveProjectPath(input.projectId)
    if (!absPath) throw new Error(`project "${input.projectId}" is not approved on this host`)

    const session = await adapter.createSession(absPath)
    if (input.initialPrompt && input.initialPrompt.trim().length > 0) {
      await adapter.sendPrompt(session.id, input.initialPrompt)
    }
    return session
  }
}
