import { listBots, readRoutines } from './store'
import { viewBot } from './runtime'
import { nextLabel, soonest } from './routines'
import type { BotView } from './types'

export function botViews(): BotView[] {
  const bots = listBots()
  const routines = readRoutines()
  const names = new Map(bots.map((b) => [b.id, b.name]))
  const now = new Date()
  return bots.map((b) => {
    const next = soonest(routines.filter((r) => r.botId === b.id))
    return viewBot(b, names, next && nextLabel(next, now))
  })
}
