import { z } from 'zod'
import { markChiefStale } from '@/lib/agent'
import { error, parseBody } from '@/lib/http'
import { createBot } from '@/lib/store'
import { botViews } from '@/lib/views'

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(botViews())
}

const CreateBot = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(40),
  job: z.string().trim().min(1, 'Job is required.').max(500),
})

export async function POST(req: Request) {
  const body = await parseBody(req, CreateBot)
  if (body instanceof Response) return body
  if (botViews().length >= 12) return error(400, 'That is plenty of bots for v1.')
  const bot = createBot(body.name, body.job)
  markChiefStale()
  return Response.json(bot, { status: 201 })
}
