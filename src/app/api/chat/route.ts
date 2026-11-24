import { z } from 'zod'
import { sendMessage } from '@/lib/agent'
import { MAX_ATTACHMENTS } from '@/lib/context'
import { billingOverride } from '@/lib/env'
import { error, findBot, parseBody } from '@/lib/http'
import { delegatedBy } from '@/lib/runtime'
import { getBot } from '@/lib/store'
import { EFFORTS, MODELS } from '@/lib/types'
import { findAttachments } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const SendMessage = z
  .object({
    botId: z.string(),
    message: z.string().trim().max(100_000),
    // Upload ids from POST /api/attachments.
    attachments: z.array(z.string()).max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} attachments per message.`).default([]),
    // A one-message model pick from the composer; absent means Auto.
    model: z.enum(MODELS).optional(),
    // The composer's effort level; null is the model's default, absent leaves it as is.
    effort: z.enum(EFFORTS).nullable().optional(),
  })
  .refine((b) => b.message || b.attachments.length, 'Type a message or attach a file.')

// Replies arrive on GET /api/chats/[id]/stream.
export async function POST(req: Request) {
  const body = await parseBody(req, SendMessage)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  const billingVar = await billingOverride(bot.folder)
  if (billingVar) {
    return error(
      412,
      `${billingVar} is set in your environment or Claude Code settings, so usage would be billed to the API, not your plan. Remove it and try again.`,
    )
  }
  if (bot.paused) return error(409, `${bot.name} is paused. Hand control back first.`)
  const owner = delegatedBy(bot.id)
  if (owner) return error(409, `${bot.name} is working for ${getBot(owner)?.name ?? owner}.`)
  let attachments
  try {
    attachments = findAttachments(bot, body.attachments)
  } catch (e) {
    return error(409, e instanceof Error ? e.message : String(e))
  }
  if (typeof attachments === 'string') return error(409, attachments)
  sendMessage(bot, body.message, attachments, body.model ?? null, body.effort)
  return Response.json({ ok: true }, { status: 202 })
}
