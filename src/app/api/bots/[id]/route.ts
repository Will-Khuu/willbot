import { z } from 'zod'
import { error, findBot, parseBody, type IdParams } from '@/lib/http'
import { stopRun } from '@/lib/runtime'
import { deleteBot, updateBot } from '@/lib/store'

const PatchBot = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    job: z.string().trim().min(1).max(500).optional(),
    paused: z.boolean().optional(),
  })
  .strict()

export async function PATCH(req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  const body = await parseBody(req, PatchBot)
  if (body instanceof Response) return body
  if (body.paused) stopRun(bot.id)
  return Response.json(updateBot(bot.id, body))
}

export async function DELETE(_req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  if (bot.builtin === 'chief') return error(400, 'The Chief of Staff cannot be deleted.')
  stopRun(bot.id)
  deleteBot(bot.id)
  return new Response(null, { status: 204 })
}
