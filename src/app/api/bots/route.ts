import { z } from 'zod'
import { markChiefStale } from '@/lib/agent'
import { error, parseBody } from '@/lib/http'
import { BotNameSchema } from '@/lib/names'
import { createBot } from '@/lib/store'
import { ensureScheduler } from '@/lib/scheduler'
import { botViews } from '@/lib/views'

export const dynamic = 'force-dynamic'

export function GET() {
  ensureScheduler()
  return Response.json(botViews())
}

const CreateBot = z.object({
  name: BotNameSchema,
  job: z.string().trim().min(1, 'Job is required.').max(500),
})

export async function POST(req: Request) {
  const body = await parseBody(req, CreateBot)
  if (body instanceof Response) return body
  const bot = createBot(body.name, body.job)
  if (!bot) return error(400, 'That is plenty of bots for v1.')
  markChiefStale()
  return Response.json(bot, { status: 201 })
}
