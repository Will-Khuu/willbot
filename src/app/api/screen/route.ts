import fs from 'node:fs'
import { error, findBot } from '@/lib/http'
import { latestScreenshot } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Only the newest PNG inside the employee's <working folder>/.playwright.
export function GET(req: Request) {
  const bot = findBot(new URL(req.url).searchParams.get('botId') ?? '')
  if (bot instanceof Response) return bot
  const file = bot.browser ? latestScreenshot(bot) : null
  if (!file) return error(404, 'No screenshot yet.')
  return new Response(fs.readFileSync(file), {
    headers: { 'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' },
  })
}
