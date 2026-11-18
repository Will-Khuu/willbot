import { randomUUID } from 'node:crypto'
import { save, sendMessage } from './agent'
import { billingOverride } from './env'
import { due, outcomeFor, record, scheduledOutcome, type Blockers, type Routine } from './routines'
import { currentUsage, delegatedBy, rt } from './runtime'
import { getBot, listBots, readRoutines, saveRoutines } from './store'
import type { Bot } from './types'
import { limitBlocks } from './usage'

const TICK_MS = 30_000

function blockersOf(bot: Bot, now: Date): Blockers {
  return {
    billing: billingOverride() !== null,
    paused: bot.paused,
    limited: limitBlocks(currentUsage(), now.getTime() / 1000),
    busy: delegatedBy(bot.id) !== null,
  }
}

// The routine line goes in just before the message, like a user sending it.
function deliver(bot: Bot, routine: Routine, now: Date): void {
  save(bot.id, { kind: 'routine', id: randomUUID(), botId: bot.id, routineId: routine.id, name: routine.name, at: now.toISOString() })
  sendMessage(bot, routine.prompt, [], null)
}

// Synchronous from read to save, so no request or second tick interleaves, and
// every due routine's next run is on disk before any message goes out.
export function tick(now: Date = new Date()): void {
  const routines = readRoutines()
  const todo = new Set(due(routines, now))
  if (todo.size === 0) return
  const bots = new Map(listBots().map((b) => [b.id, b]))
  const runs: [Bot, Routine][] = []
  const next = routines.flatMap((r) => {
    if (!todo.has(r)) return [r]
    const bot = bots.get(r.botId)
    if (!bot) return []
    const outcome = scheduledOutcome(r, now, blockersOf(bot, now))
    if (outcome === 'ran') runs.push([bot, r])
    return [record(r, outcome, now)]
  })
  saveRoutines(next)
  for (const [bot, r] of runs) {
    try {
      deliver(bot, r, now)
    } catch (e) {
      console.error(`will-bot: routine ${r.id} failed to send`, e)
    }
  }
}

// "Run now": the scheduled path's checks and message, leaving nextRunAt alone.
export function runNow(id: string, now: Date = new Date()): Routine | null {
  const routines = readRoutines()
  const routine = routines.find((r) => r.id === id)
  const bot = routine && getBot(routine.botId)
  if (!routine || !bot) return null
  const outcome = outcomeFor(blockersOf(bot, now))
  const updated = record(routine, outcome, now, true)
  saveRoutines(routines.map((r) => (r.id === id ? updated : r)))
  if (outcome === 'ran') deliver(bot, routine, now)
  return updated
}

// Idempotent. Next dev re-evaluates this module on HMR, so the one interval
// lives on the runtime singleton and always calls the newest tick.
export function ensureScheduler(): void {
  if (rt.scheduler) {
    rt.scheduler.tick = tick
    return
  }
  const scheduler = {
    tick,
    timer: setInterval(() => {
      try {
        scheduler.tick()
      } catch (e) {
        console.error('will-bot: routine tick failed', e)
      }
    }, TICK_MS),
  }
  scheduler.timer.unref()
  rt.scheduler = scheduler
}
