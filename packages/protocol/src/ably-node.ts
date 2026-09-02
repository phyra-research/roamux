import { Realtime } from "ably"
import type { RealtimeCtor } from "./ably-transport.js"

/**
 * Node/Bun `Realtime` constructor for the host daemon. Importing "ably" here
 * pulls the Node build — fine on the host, but this file must NEVER be imported
 * from browser code (use `browserRealtimeCtor` there instead).
 */
export function nodeRealtimeCtor(): RealtimeCtor {
  return Realtime as unknown as RealtimeCtor
}
