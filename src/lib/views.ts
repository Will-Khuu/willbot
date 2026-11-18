import { listBots } from './store'
import { viewBot } from './runtime'
import type { BotView } from './types'

export function botViews(): BotView[] {
  const bots = listBots()
  const names = new Map(bots.map((b) => [b.id, b.name]))
  return bots.map((b) => viewBot(b, names))
}
