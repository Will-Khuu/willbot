import { z } from 'zod'
import { applyModel, changeFolder, closeSession, markChiefStale, markStale } from '@/lib/agent'
import { ExtraFoldersSchema, FolderPathSchema } from '@/lib/folders'
import { error, findBot, parseBody, type IdParams } from '@/lib/http'
import { deleteBot, updateBot } from '@/lib/store'
import { ModelSchema } from '@/lib/types'

const PatchBot = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    job: z.string().trim().min(1).max(500).optional(),
    paused: z.boolean().optional(),
    folder: FolderPathSchema.optional(),
    extraFolders: ExtraFoldersSchema.optional(),
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
  const updated = updateBot(bot.id, body)
  // Take over: the guard sees paused from here on, then the session closes.
  if (body.paused) await closeSession(bot.id)
  if (body.folder !== undefined && body.folder !== bot.folder) await changeFolder(bot.id)
  if (body.model !== undefined) await applyModel(bot.id, body.model)
  // Router off: back to the configured model at once. Router on takes effect with the next message.
  else if (body.router === false && bot.router && updated) await applyModel(bot.id, updated.model)
  // Extra folders keep the session's project, so the conversation resumes.
  const reopen = [body.name, body.job, body.browser, body.hire, body.extraFolders].some((v) => v !== undefined)
  if (reopen) markStale(bot.id)
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
