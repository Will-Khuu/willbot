import { z } from 'zod'
import { findBot, parseBody, type IdParams } from '@/lib/http'
import { readMemory, writeMemory } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  return Response.json(readMemory(bot.id))
}

const Entries = z.object({
  entries: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .max(200),
})

export async function PUT(req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  const body = await parseBody(req, Entries)
  if (body instanceof Response) return body
  writeMemory(bot.id, body.entries)
  return Response.json(readMemory(bot.id))
}
