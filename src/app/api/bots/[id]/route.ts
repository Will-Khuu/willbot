import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { applyModel, changeFolder, closeSession, markChiefStale, markStale } from '@/lib/agent'
import { error, findBot, parseBody, type IdParams } from '@/lib/http'
import { deleteBot, updateBot } from '@/lib/store'
import { ModelSchema } from '@/lib/types'

const PatchBot = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    job: z.string().trim().min(1).max(500).optional(),
    paused: z.boolean().optional(),
    folder: z
      .string()
      .trim()
      .refine((p) => path.isAbsolute(p), 'The folder must be an absolute path.')
      .refine((p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true, 'That folder does not exist.')
      .optional(),
    model: ModelSchema.optional(),
    browser: z.boolean().optional(),
    router: z.boolean().optional(),
    hire: z.boolean().optional(),
  })
  .strict()

export async function PATCH(req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  const body = await parseBody(req, PatchBot)
  if (body instanceof Response) return body
  const folder = body.folder === undefined ? undefined : path.resolve(body.folder)
  const updated = updateBot(bot.id, { ...body, folder })
  // Take over: the guard sees paused from here on, then the session closes.
  if (body.paused) await closeSession(bot.id)
  if (folder !== undefined && folder !== bot.folder) await changeFolder(bot.id)
  if (body.model !== undefined) await applyModel(bot.id, body.model)
  // Router off: back to the configured model at once. Router on takes effect with the next message.
  else if (body.router === false && bot.router && updated) await applyModel(bot.id, updated.model)
  if (body.name !== undefined || body.job !== undefined || body.browser !== undefined || body.hire !== undefined) markStale(bot.id)
  if (bot.builtin !== 'chief') markChiefStale()
  return Response.json(updated)
}

export async function DELETE(_req: Request, { params }: IdParams) {
  const bot = findBot((await params).id)
  if (bot instanceof Response) return bot
  if (bot.builtin === 'chief') return error(400, 'The Chief of Staff cannot be deleted.')
  await closeSession(bot.id)
  deleteBot(bot.id)
  markChiefStale()
  return new Response(null, { status: 204 })
}
