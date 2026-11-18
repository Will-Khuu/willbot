import { z } from 'zod'
import { MAX_ATTACHMENT_BYTES } from '@/lib/context'
import { error, findBot, parseBody } from '@/lib/http'
import { saveAttachment } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Base64 in JSON, so every write request stays application/json.
const Upload = z.object({
  name: z.string().trim().min(1).max(255),
  data: z.base64().max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4, 'Files can be up to 20 MB.'),
})

export async function POST(req: Request) {
  const bot = findBot(new URL(req.url).searchParams.get('botId') ?? '')
  if (bot instanceof Response) return bot
  const body = await parseBody(req, Upload)
  if (body instanceof Response) return body
  const data = Buffer.from(body.data, 'base64')
  if (data.length > MAX_ATTACHMENT_BYTES) return error(413, 'Files can be up to 20 MB.')
  try {
    return Response.json(saveAttachment(bot, body.name, data), { status: 201 })
  } catch (e) {
    return error(409, e instanceof Error ? e.message : String(e))
  }
}
