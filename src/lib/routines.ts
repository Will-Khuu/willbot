import { z } from 'zod'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12] as const
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const TimeSchema = z.string().regex(TIME, 'Use a time from 00:00 to 23:59.')

// time is 'HH:MM' in the server's local time; day 0 is Sunday.
export const ScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time: TimeSchema }),
  z.object({ kind: z.literal('weekdays'), time: TimeSchema }),
  z.object({ kind: z.literal('weekly'), day: z.literal([0, 1, 2, 3, 4, 5, 6]), time: TimeSchema }),
  z.object({ kind: z.literal('every'), hours: z.literal(EVERY_HOURS) }),
])
export type Schedule = z.infer<typeof ScheduleSchema>

// What the user sets; the rest of a Routine is bookkeeping.
export const RoutineInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(60, 'Keep the name under 60 characters.'),
  prompt: z.string().trim().min(1, 'Say what it should do.').max(4000, 'Keep it under 4,000 characters.'),
  schedule: ScheduleSchema,
})

export const OUTCOMES = ['ran', 'skipped_paused', 'skipped_limit', 'skipped_busy', 'skipped_billing', 'missed'] as const
export type Outcome = (typeof OUTCOMES)[number]

export const RoutineSchema = z.object({
  id: z.string(),
  botId: z.string(),
  name: z.string(),
  prompt: z.string(),
  schedule: ScheduleSchema,
  enabled: z.boolean(),
  createdAt: z.string(),
  lastRunAt: z.string().nullable(),
  // null exactly when the routine is off.
  nextRunAt: z.string().nullable(),
  lastOutcome: z.enum(OUTCOMES).nullable(),
})
export type Routine = z.infer<typeof RoutineSchema>
export const RoutinesFileSchema = z.array(RoutineSchema)

function clock(time: string): [hour: number, minute: number] {
  if (!TIME.test(time)) throw new RangeError(`Invalid time "${time}"; expected HH:MM from 00:00 to 23:59.`)
  return [Number(time.slice(0, 2)), Number(time.slice(3))]
}

function runsOn(schedule: Exclude<Schedule, { kind: 'every' }>, weekday: number): boolean {
  if (schedule.kind === 'daily') return true
  if (schedule.kind === 'weekdays') return weekday >= 1 && weekday <= 5
  return weekday === schedule.day
}

// The first run strictly after `from`. Days are stepped by calendar date, not
// by 24 hours, so a run keeps its wall-clock time across DST changes. A time
// the spring-forward gap skips runs at the shifted time (2:30 becomes 3:30).
export function nextRun(schedule: Schedule, from: Date): Date {
  if (Number.isNaN(from.getTime())) throw new RangeError('Invalid start date.')
  if (schedule.kind === 'every') {
    if (!(EVERY_HOURS as readonly number[]).includes(schedule.hours)) throw new RangeError(`Invalid interval ${schedule.hours}.`)
    return new Date(from.getTime() + schedule.hours * HOUR_MS)
  }
  if (schedule.kind === 'weekly' && !(Number.isInteger(schedule.day) && schedule.day >= 0 && schedule.day <= 6)) {
    throw new RangeError(`Invalid weekday ${schedule.day}.`)
  }
  const [hour, minute] = clock(schedule.time)
  for (let k = 0; k <= 7; k++) {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k, hour, minute)
    if (at > from && runsOn(schedule, at.getDay())) return at
  }
  throw new RangeError('No run within a week.')
}

export function clockLabel(hour: number, minute: number): string {
  const h = hour % 12 || 12
  const suffix = hour < 12 ? 'AM' : 'PM'
  return minute ? `${h}:${String(minute).padStart(2, '0')} ${suffix}` : `${h} ${suffix}`
}

export function describe(schedule: Schedule): string {
  if (schedule.kind === 'every') return schedule.hours === 1 ? 'Every hour' : `Every ${schedule.hours} hours`
  const at = clockLabel(...clock(schedule.time))
  if (schedule.kind === 'daily') return `Daily ${at}`
  if (schedule.kind === 'weekdays') return `Weekdays ${at}`
  return `${DAY_NAMES[schedule.day]} ${at}`
}

// 'today', 'tomorrow', or the short weekday within a week, else the date.
export function dayWord(at: Date, now: Date): string {
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      DAY_MS,
  )
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1 && days < 7) return DAY_NAMES[at.getDay()]!
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// "Evening summary 6 PM", or "Weekly plan Mon 8 AM" when not today.
export function nextLabel(routine: Routine, now: Date): string | null {
  if (!routine.nextRunAt) return null
  const at = new Date(routine.nextRunAt)
  const day = dayWord(at, now)
  const time = clockLabel(at.getHours(), at.getMinutes())
  return `${routine.name} ${day === 'today' ? '' : `${day} `}${time}`
}

// The enabled routine that runs first.
export function soonest(routines: Routine[]): Routine | null {
  let best: Routine | null = null
  for (const r of routines) if (r.nextRunAt && (!best || r.nextRunAt < best.nextRunAt!)) best = r
  return best
}

export function due(routines: Routine[], now: Date): Routine[] {
  return routines.filter((r) => r.enabled && r.nextRunAt !== null && Date.parse(r.nextRunAt) <= now.getTime())
}

export const MISSED_AFTER_MS = 2 * HOUR_MS

export type Blockers = { billing: boolean; paused: boolean; limited: boolean; busy: boolean }

export function outcomeFor(b: Blockers): Outcome {
  if (b.billing) return 'skipped_billing'
  if (b.paused) return 'skipped_paused'
  if (b.limited) return 'skipped_limit'
  if (b.busy) return 'skipped_busy'
  return 'ran'
}

// A run the server slept through still happens if it is under 2 hours late.
export function scheduledOutcome(routine: Routine, now: Date, blockers: Blockers): Outcome {
  const late = routine.nextRunAt === null ? 0 : now.getTime() - Date.parse(routine.nextRunAt)
  return late >= MISSED_AFTER_MS ? 'missed' : outcomeFor(blockers)
}

// 'every' counts from the last run, or from creation. Whatever the anchor, the
// result is after now, so a backlog never builds up.
export function upcoming(routine: Routine, now: Date): string | null {
  if (!routine.enabled) return null
  const anchor = routine.schedule.kind === 'every' ? new Date(routine.lastRunAt ?? routine.createdAt) : now
  let next = nextRun(routine.schedule, anchor)
  if (next <= now) next = nextRun(routine.schedule, now)
  return next.toISOString()
}

// A manual run keeps nextRunAt as it was.
export function record(routine: Routine, outcome: Outcome, now: Date, manual = false): Routine {
  const next: Routine = {
    ...routine,
    lastOutcome: outcome,
    lastRunAt: outcome === 'ran' ? now.toISOString() : routine.lastRunAt,
  }
  return manual ? next : { ...next, nextRunAt: upcoming(next, now) }
}

export const OUTCOME_TEXT: Record<Exclude<Outcome, 'ran'>, string> = {
  skipped_paused: 'Skipped: you had taken over',
  skipped_limit: 'Skipped: plan limit reached',
  skipped_busy: 'Skipped: it was working for the Chief',
  skipped_billing: 'Skipped: an API key was set',
  missed: 'Missed while will-bot was closed',
}
