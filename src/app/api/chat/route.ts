import { z } from 'zod'
import { billingOverride, runBot } from '@/lib/agent'
import { error, findBot, parseBody } from '@/lib/http'
import { delegatedBy, isBusy } from '@/lib/runtime'
import { getBot } from '@/lib/store'
import type { StreamEvent } from '@/lib/types'

export const dynamic = 'force-dynamic'

const SendMessage = z.object({ botId: z.string(), message: z.string().trim().min(1).max(4000) })

export async function POST(req: Request) {
  const body = await parseBody(req, SendMessage)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  const billingVar = billingOverride()
  if (billingVar) {
    return error(412, `${billingVar} is set, so usage would be billed to the API, not your plan. Unset it and restart the server.`)
  }
  if (bot.paused) return error(409, `${bot.name} is paused. Hand control back first.`)
  if (isBusy(bot.id)) {
    const owner = delegatedBy(bot.id)
    return error(409, owner ? `${bot.name} is working for ${getBot(owner)?.name ?? owner}.` : `${bot.name} is already working.`)
  }

  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      controller = null
    },
  })
  // The run outlives the request: closing the tab must not abort the bot.
  const emit = (event: StreamEvent) => {
    if (!controller) return
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      if (event.type === 'done') {
        controller.close()
        controller = null
      }
    } catch {
      controller = null
    }
  }
  const handle = runBot(bot.id, body.message, emit)
  if (!handle) return error(409, `${bot.name} is already working.`)

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  })
}
