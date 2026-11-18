import { findBot, type IdParams } from '@/lib/http'
import { subscribe } from '@/lib/runtime'
import type { StreamEvent } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Every item is saved to the chat file before it is sent here, so a client
// that reconnects reloads the chat and loses nothing.
export async function GET(req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
      const unsubscribe = subscribe(bot.id, send)
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25_000)
      cleanup = () => {
        unsubscribe()
        clearInterval(keepAlive)
      }
      req.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  })
}
