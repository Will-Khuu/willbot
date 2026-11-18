import fs from 'node:fs'
import { error, findBot } from '@/lib/http'
import { attachmentImage } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Thumbnails only: images inside the employee's attachments folder.
export function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const bot = findBot(params.get('botId') ?? '')
  if (bot instanceof Response) return bot
  const image = attachmentImage(bot, params.get('path') ?? '')
  if (!image) return error(404, 'No such attachment.')
  return new Response(fs.readFileSync(image.path), {
    headers: { 'content-type': image.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' },
  })
}
