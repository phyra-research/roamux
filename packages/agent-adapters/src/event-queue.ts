/**
 * A minimal push→pull bridge: producers `push()` values, consumers `for await`
 * over the queue. Backed by an unbounded buffer + waiter promise. Single
 * consumer is assumed (the host's forwarding loop).
 */
export class EventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private resolveNext: ((r: IteratorResult<T>) => void) | null = null
  private closed = false

  push(value: T): void {
    if (this.closed) return
    if (this.resolveNext) {
      const resolve = this.resolveNext
      this.resolveNext = null
      resolve({ value, done: false })
    } else {
      this.buffer.push(value)
    }
  }

  close(): void {
    this.closed = true
    if (this.resolveNext) {
      const resolve = this.resolveNext
      this.resolveNext = null
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const buffered = this.buffer.shift()
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolveNext = resolve
        })
      },
    }
  }
}
