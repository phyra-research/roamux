/**
 * Bounded cache of processed command messageIds so a redelivered command never
 * executes a destructive action twice (Beta §5.5, §13.1). On a flaky phone
 * network the transport WILL redeliver; this makes command handling at-most-once
 * in effect even when delivery is at-least-once.
 *
 * Deliberately tiny: an insertion-ordered set with a max size. When full, the
 * oldest ids are evicted. That's fine — redeliveries arrive close in time, so a
 * modest window catches them; very old ids being forgotten is harmless.
 */
export class IdempotencyCache {
  private readonly seen = new Set<string>()
  private readonly maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  /**
   * Record a messageId as processed. Returns `true` if it was NEW (caller should
   * process it), `false` if it was already seen (caller should skip).
   */
  markProcessed(messageId: string): boolean {
    if (this.seen.has(messageId)) return false
    this.seen.add(messageId)
    if (this.seen.size > this.maxSize) {
      // Evict the oldest entry (Set preserves insertion order).
      const oldest = this.seen.values().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    return true
  }

  /** Whether a messageId has already been processed (without recording it). */
  has(messageId: string): boolean {
    return this.seen.has(messageId)
  }

  get size(): number {
    return this.seen.size
  }
}
