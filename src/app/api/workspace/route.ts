import path from 'node:path'
import { findBot } from '@/lib/http'
import { recentFiles } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const bot = findBot(new URL(req.url).searchParams.get('botId') ?? '')
  if (bot instanceof Response) return bot
  const { folder, files } = recentFiles(bot, 5)
  return Response.json({ name: path.basename(folder), folder, files })
}
