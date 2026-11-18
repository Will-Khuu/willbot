import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { error, findBot, parseBody } from '@/lib/http'
import { RoutineInputSchema, upcoming, type Routine } from '@/lib/routines'
import { ensureScheduler } from '@/lib/scheduler'
import { readRoutines, saveRoutines } from '@/lib/store'

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
  const now = new Date()
  const base: Routine = {
    id: randomUUID(),
    botId: bot.id,
    name: body.name,
    prompt: body.prompt,
    schedule: body.schedule,
    enabled: true,
    createdAt: now.toISOString(),
    lastRunAt: null,
    nextRunAt: null,
    lastOutcome: null,
  }
  const routine = { ...base, nextRunAt: upcoming(base, now) }
  saveRoutines([...readRoutines(), routine])
  return Response.json(routine, { status: 201 })
}
