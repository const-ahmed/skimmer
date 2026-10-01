export interface SseChannel {
  send(event: string, data: unknown): void
  close(): void
}

const HEARTBEAT_MS = 15_000

// A comment heartbeat keeps long model calls from looking like an idle connection.
export function createSseResponse(onCancel?: () => void): {
  response: Response
  channel: SseChannel
} {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel() {
      closed = true
      clearInterval(heartbeat)
      onCancel?.()
    },
  })
  const write = (chunk: string) => {
    if (closed) return
    try {
      controller.enqueue(encoder.encode(chunk))
    } catch {
      closed = true
    }
  }
  const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS)
  const channel: SseChannel = {
    send(event, data) {
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    close() {
      clearInterval(heartbeat)
      if (closed) return
      closed = true
      controller.close()
    },
  }
  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
  return { response, channel }
}
