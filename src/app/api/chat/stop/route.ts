import { z } from 'zod'
import { findBot, parseBody } from '@/lib/http'
import { stopRun } from '@/lib/runtime'

const StopRun = z.object({ botId: z.string() })

export async function POST(req: Request) {
  const body = await parseBody(req, StopRun)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  return Response.json({ stopped: stopRun(bot.id) })
}
