import { z } from 'zod'
import { sendMessage } from '@/lib/agent'
import { billingOverride } from '@/lib/env'
import { error, findBot, parseBody } from '@/lib/http'
import { delegatedBy } from '@/lib/runtime'
import { getBot } from '@/lib/store'
import { MODELS } from '@/lib/types'

export const dynamic = 'force-dynamic'

const SendMessage = z.object({
  botId: z.string(),
  message: z.string().trim().min(1).max(4000),
  // A one-message model pick from the composer; absent means Auto.
  model: z.enum(MODELS).optional(),
})

// Replies arrive on GET /api/chats/[id]/stream.
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
  const owner = delegatedBy(bot.id)
  if (owner) return error(409, `${bot.name} is working for ${getBot(owner)?.name ?? owner}.`)
  sendMessage(bot, body.message, body.model ?? null)
  return Response.json({ ok: true }, { status: 202 })
}
