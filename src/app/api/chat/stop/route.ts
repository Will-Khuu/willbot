import { z } from 'zod'
import { stopBot } from '@/lib/agent'
import { findBot, parseBody } from '@/lib/http'

const StopTurn = z.object({ botId: z.string() })

export async function POST(req: Request) {
  const body = await parseBody(req, StopTurn)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  return Response.json({ stopped: await stopBot(bot.id) })
}
