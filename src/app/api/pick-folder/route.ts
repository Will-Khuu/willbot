import fs from 'node:fs'
import { z } from 'zod'
import { error, findBot, parseBody } from '@/lib/http'
import { pickFolder } from '@/lib/picker'

export const dynamic = 'force-dynamic'

const Pick = z.object({ botId: z.string() }).strict()

export async function POST(req: Request) {
  const body = await parseBody(req, Pick)
  if (body instanceof Response) return body
  const bot = findBot(body.botId)
  if (bot instanceof Response) return bot
  const start = fs.statSync(bot.folder, { throwIfNoEntry: false })?.isDirectory() ? bot.folder : null
  const picking = pickFolder(bot.name, start)
  if (!picking) return error(409, 'A folder picker is already open.')
  try {
    return Response.json(await picking)
  } catch (e) {
    return error(500, `The folder picker failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
