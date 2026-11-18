import { randomUUID } from 'node:crypto'
import { save, sendMessage } from './agent'
import { billingOverride } from './env'
import { due, lateBy, outcomeFor, record, scheduledOutcome, type Blockers, type Routine } from './routines'
import { currentUsage, delegatedBy, rt } from './runtime'
import { getBot, holdSchedulerLock, listBots, readRoutines, saveRoutines } from './store'
import type { Bot, BotId } from './types'
import { limitBlocks } from './usage'

const TICK_MS = 30_000

// Billing reads settings files, so it is checked before the synchronous part.
async function billedBots(bots: Bot[]): Promise<Set<BotId>> {
  const billed = await Promise.all(bots.map(async (b) => ((await billingOverride(b.folder)) ? [b.id] : [])))
  return new Set(billed.flat())
}

function blockersOf(bot: Bot, now: Date, billed: ReadonlySet<BotId>): Blockers {
  return {
    billing: billed.has(bot.id),
    paused: bot.paused,
    limited: limitBlocks(currentUsage(), now.getTime() / 1000),
    busy: delegatedBy(bot.id) !== null,
  }
}

// The routine line goes in just before the message, like a user sending it.
function deliver(bot: Bot, routine: Routine, now: Date, late: number | null = null): void {
  save(bot.id, { kind: 'routine', id: randomUUID(), botId: bot.id, routineId: routine.id, name: routine.name, at: now.toISOString() })
  const due = routine.nextRunAt ? new Date(routine.nextRunAt).toLocaleString() : ''
  const note = late === null ? '' : `(This scheduled run was due ${due}; will-bot was closed or the Mac was asleep, so it is running late. Cover the time since then.)\n\n`
  sendMessage(bot, note + routine.prompt, [], null)
}

export async function tick(now: Date = new Date()): Promise<void> {
  if (!holdSchedulerLock()) return
  const owners = new Set(due(readRoutines(), now).map((r) => r.botId))
  if (owners.size === 0) return
  runDue(now, await billedBots(listBots().filter((b) => owners.has(b.id))))
}

// Synchronous from read to save, so no request or second tick interleaves, and
// every due routine's next run is on disk before any message goes out.
function runDue(now: Date, billed: ReadonlySet<BotId>): void {
  const routines = readRoutines()
  const todo = new Set(due(routines, now))
  if (todo.size === 0) return
  const bots = new Map(listBots().map((b) => [b.id, b]))
  const runs: [Bot, Routine, number | null][] = []
  const next = routines.flatMap((r) => {
    if (!todo.has(r)) return [r]
    const bot = bots.get(r.botId)
    if (!bot) return []
    const outcome = scheduledOutcome(r, now, blockersOf(bot, now, billed))
    if (outcome === 'ran') runs.push([bot, r, lateBy(r, now)])
    return [record(r, outcome, now)]
  })
  saveRoutines(next)
  for (const [bot, r, late] of runs) {
    try {
      deliver(bot, r, now, late)
    } catch (e) {
      console.error(`will-bot: routine ${r.id} failed to send`, e)
    }
  }
}

// "Run now": the scheduled path's checks and message, leaving nextRunAt alone.
export async function runNow(id: string, now: Date = new Date()): Promise<Routine | null> {
  const first = readRoutines().find((r) => r.id === id)
  const firstBot = first && getBot(first.botId)
  if (!firstBot) return null
  const billed = await billedBots([firstBot])
  const routines = readRoutines()
  const routine = routines.find((r) => r.id === id)
  const bot = routine && getBot(routine.botId)
  if (!routine || !bot) return null
  const outcome = outcomeFor(blockersOf(bot, now, billed))
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
  const scheduler: { tick: () => Promise<void>; timer: NodeJS.Timeout } = {
    tick,
    timer: setInterval(() => {
      scheduler.tick().catch((e: unknown) => console.error('will-bot: routine tick failed', e))
    }, TICK_MS),
  }
  scheduler.timer.unref()
  rt.scheduler = scheduler
}
