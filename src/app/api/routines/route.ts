import { z } from 'zod'
import { error, findBot, parseBody } from '@/lib/http'
import { RoutineInputSchema } from '@/lib/routines'
import { ensureScheduler } from '@/lib/scheduler'
import { createRoutine, readRoutines } from '@/lib/store'

export const dynamic = 'force-dynamic'

const CreateRoutine = RoutineInputSchema.extend({ botId: z.string() }).strict()

export function GET(req: Request) {
  ensureScheduler()
  const botId = new URL(req.url).searchParams.get('botId')
  if (!botId) return error(400, 'botId is required.')
  const bot = findBot(botId)
  if (bot instanceof Response) return bot
  return Response.json(readRoutines().filter((r) => r.botId === bot.id))
}

export async function POST(req: Request) {
  ensureScheduler()
  const body = await parseBody(req, CreateRoutine)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  return Response.json(createRoutine(bot.id, body), { status: 201 })
}
