import { error, findBot } from '@/lib/http'
import { searchFiles } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const bot = findBot(params.get('botId') ?? '')
  if (bot instanceof Response) return bot
  try {
    return Response.json(searchFiles(bot, (params.get('q') ?? '').slice(0, 200)))
  } catch (e) {
    return error(409, e instanceof Error ? e.message : String(e))
  }
}
