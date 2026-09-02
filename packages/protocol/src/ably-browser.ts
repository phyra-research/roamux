import type { RealtimeCtor } from "./ably-transport.js"

/**
 * Browser `Realtime` constructor composed from `ably/modular` — the ESM,
 * bundler-friendly Ably build. The default "ably" package ships a UMD bundle
 * that webpack cannot parse ("super outside method"), so web code must build the
 * client from modular plugins instead. We include only what AblyTransport needs:
 * FetchRequest (HTTP) + WebSocketTransport (realtime).
 *
 * DYNAMICALLY imported: keeping `ably/modular` out of the synchronous import
 * graph means it only lands in a separate async chunk loaded when Ably mode is
 * actually used — so the default (WS) build never bundles Ably at all.
 */
export async function loadBrowserRealtimeCtor(): Promise<RealtimeCtor> {
  const { BaseRealtime, FetchRequest, WebSocketTransport } = await import("ably/modular")
  // why: BaseRealtime needs its plugins injected; wrap it so callers get the
  // same `new (ClientOptions) => Realtime` shape as the Node ctor.
  return class extends BaseRealtime {
    constructor(options: ConstructorParameters<typeof BaseRealtime>[0]) {
      super({ ...options, plugins: { FetchRequest, WebSocketTransport } })
    }
  } as unknown as RealtimeCtor
}
