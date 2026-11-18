import assert from 'node:assert/strict'
import { test } from 'node:test'

// Fixed zone with DST; node --test runs each file in its own process.
process.env.TZ = 'America/New_York'

const { dayWord, describe, scheduleWords, due, nextLabel, nextRun, outcomeFor, record, scheduledOutcome, soonest, upcoming, ScheduleSchema } =
  await import('./routines.ts')

const HOUR = 3600_000
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)
const parts = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()]
const clear = { billing: false, paused: false, limited: false, busy: false }

function routine(over = {}) {
  return {
    id: 'r1',
    botId: 'research',
    name: 'Evening summary',
    prompt: 'Summarize today.',
    schedule: { kind: 'daily', time: '18:00' },
    enabled: true,
    createdAt: local(2026, 11, 1, 9).toISOString(),
    lastRunAt: null,
    nextRunAt: local(2026, 11, 18, 18).toISOString(),
    lastOutcome: null,
    ...over,
  }
}

test('daily runs later today, or tomorrow once the time has passed', () => {
  const daily = { kind: 'daily', time: '18:00' }
  assert.deepEqual(parts(nextRun(daily, local(2026, 11, 18, 10))), [2026, 11, 18, 18, 0])
  assert.deepEqual(parts(nextRun(daily, local(2026, 11, 18, 18))), [2026, 11, 19, 18, 0])
  assert.deepEqual(parts(nextRun(daily, local(2026, 11, 30, 19))), [2026, 12, 1, 18, 0])
})

test('spring forward keeps the wall-clock time on a 23-hour day', () => {
  const daily = { kind: 'daily', time: '09:00' }
  const before = nextRun(daily, local(2026, 3, 7, 8))
  const after = nextRun(daily, before)
  assert.deepEqual(parts(after), [2026, 3, 8, 9, 0])
  assert.equal(after - before, 23 * HOUR)
})

test('a time inside the spring-forward gap runs at the shifted time, once', () => {
  const daily = { kind: 'daily', time: '02:30' }
  const gap = nextRun(daily, local(2026, 3, 7, 3))
  assert.deepEqual(parts(gap), [2026, 3, 8, 3, 30])
  assert.deepEqual(parts(nextRun(daily, gap)), [2026, 3, 9, 2, 30])
})

test('fall back keeps the wall-clock time on a 25-hour day', () => {
  const daily = { kind: 'daily', time: '09:00' }
  const before = nextRun(daily, local(2026, 10, 31, 8))
  const after = nextRun(daily, before)
  assert.deepEqual(parts(after), [2026, 11, 1, 9, 0])
  assert.equal(after - before, 25 * HOUR)
})

test('a repeated fall-back time runs once, at its first occurrence', () => {
  const daily = { kind: 'daily', time: '01:30' }
  const first = nextRun(daily, local(2026, 11, 1, 0))
  assert.equal(first.toISOString(), '2026-11-01T05:30:00.000Z')
  const second = new Date(first.getTime() + HOUR)
  assert.deepEqual(parts(second), [2026, 11, 1, 1, 30])
  assert.deepEqual(parts(nextRun(daily, first)), [2026, 11, 2, 1, 30])
  assert.deepEqual(parts(nextRun(daily, second)), [2026, 11, 2, 1, 30])
})

test('weekdays skip the weekend', () => {
  const weekdays = { kind: 'weekdays', time: '09:00' }
  assert.deepEqual(parts(nextRun(weekdays, local(2026, 11, 20, 10))), [2026, 11, 23, 9, 0])
  assert.deepEqual(parts(nextRun(weekdays, local(2026, 11, 21, 8))), [2026, 11, 23, 9, 0])
  assert.deepEqual(parts(nextRun(weekdays, local(2026, 11, 23, 8))), [2026, 11, 23, 9, 0])
})

test('weekly wraps to next week and across the year', () => {
  const monday = { kind: 'weekly', day: 1, time: '08:00' }
  assert.deepEqual(parts(nextRun(monday, local(2026, 11, 23, 7))), [2026, 11, 23, 8, 0])
  assert.deepEqual(parts(nextRun(monday, local(2026, 11, 23, 8))), [2026, 11, 30, 8, 0])
  assert.deepEqual(parts(nextRun(monday, local(2026, 11, 28, 12))), [2026, 11, 30, 8, 0])
  const friday = { kind: 'weekly', day: 5, time: '17:00' }
  assert.deepEqual(parts(nextRun(friday, local(2026, 12, 31, 9))), [2027, 1, 1, 17, 0])
})

test('every N hours counts elapsed time, DST included', () => {
  assert.equal(nextRun({ kind: 'every', hours: 2 }, local(2026, 11, 18, 10)) - local(2026, 11, 18, 10), 2 * HOUR)
  const across = nextRun({ kind: 'every', hours: 1 }, local(2026, 3, 8, 1, 30))
  assert.deepEqual(parts(across), [2026, 3, 8, 3, 30])
})

test('invalid input throws, and the schema rejects it', () => {
  const from = local(2026, 11, 18, 10)
  for (const time of ['24:00', '9:00', '12:60', 'noon', '']) {
    assert.throws(() => nextRun({ kind: 'daily', time }, from), RangeError, time)
    assert.equal(ScheduleSchema.safeParse({ kind: 'daily', time }).success, false, time)
  }
  assert.throws(() => nextRun({ kind: 'every', hours: 5 }, from), RangeError)
  assert.throws(() => nextRun({ kind: 'weekly', day: 7, time: '08:00' }, from), RangeError)
  assert.throws(() => nextRun({ kind: 'daily', time: '08:00' }, new Date('nope')), RangeError)
  assert.equal(ScheduleSchema.safeParse({ kind: 'every', hours: 5 }).success, false)
  assert.equal(ScheduleSchema.safeParse({ kind: 'weekly', day: 7, time: '08:00' }).success, false)
  assert.equal(ScheduleSchema.safeParse({ kind: 'weekly', day: 0, time: '23:59' }).success, true)
  assert.equal(ScheduleSchema.safeParse({ kind: 'daily', time: '00:00' }).success, true)
})

test('scheduleWords spells the schedule out', () => {
  assert.equal(scheduleWords({ kind: 'daily', time: '08:00' }), 'Every day at 8:00 AM')
  assert.equal(scheduleWords({ kind: 'weekdays', time: '18:00' }), 'Weekdays at 6:00 PM')
  assert.equal(scheduleWords({ kind: 'weekly', day: 1, time: '00:30' }), 'Mondays at 12:30 AM')
  assert.equal(scheduleWords({ kind: 'every', hours: 2 }), 'Every 2 hours')
})

test('describe uses the mockup wording', () => {
  assert.equal(describe({ kind: 'daily', time: '18:00' }), 'Daily 6 PM')
  assert.equal(describe({ kind: 'weekdays', time: '09:00' }), 'Weekdays 9 AM')
  assert.equal(describe({ kind: 'weekly', day: 1, time: '08:00' }), 'Mon 8 AM')
  assert.equal(describe({ kind: 'every', hours: 2 }), 'Every 2 hours')
  assert.equal(describe({ kind: 'every', hours: 1 }), 'Every hour')
  assert.equal(describe({ kind: 'daily', time: '18:30' }), 'Daily 6:30 PM')
  assert.equal(describe({ kind: 'daily', time: '00:00' }), 'Daily 12 AM')
  assert.equal(describe({ kind: 'weekly', day: 0, time: '12:05' }), 'Sun 12:05 PM')
})

test('due picks enabled routines whose time has come', () => {
  const now = local(2026, 11, 18, 18)
  const list = [
    routine({ id: 'now' }),
    routine({ id: 'past', nextRunAt: local(2026, 11, 18, 12).toISOString() }),
    routine({ id: 'future', nextRunAt: local(2026, 11, 18, 18, 1).toISOString() }),
    routine({ id: 'off', enabled: false, nextRunAt: null }),
    routine({ id: 'offStale', enabled: false }),
  ]
  assert.deepEqual(
    due(list, now).map((r) => r.id),
    ['now', 'past'],
  )
})

test('a run under 2 hours late still runs; 2 hours or more is missed', () => {
  const r = routine()
  const at = Date.parse(r.nextRunAt)
  assert.equal(scheduledOutcome(r, new Date(at + 2 * HOUR - 1), clear), 'ran')
  assert.equal(scheduledOutcome(r, new Date(at + 2 * HOUR), clear), 'missed')
  assert.equal(scheduledOutcome(r, new Date(at + 3 * HOUR), { ...clear, paused: true }), 'missed')
})

test('blockers decide the outcome', () => {
  assert.equal(outcomeFor(clear), 'ran')
  assert.equal(outcomeFor({ ...clear, paused: true }), 'skipped_paused')
  assert.equal(outcomeFor({ ...clear, limited: true }), 'skipped_limit')
  assert.equal(outcomeFor({ ...clear, busy: true }), 'skipped_busy')
  assert.equal(outcomeFor({ ...clear, billing: true }), 'skipped_billing')
  assert.equal(outcomeFor({ billing: false, paused: true, limited: true, busy: true }), 'skipped_paused')
})

test('a ran routine records the run and moves to the next day', () => {
  const now = new Date(Date.parse(routine().nextRunAt) + 20_000)
  const next = record(routine(), 'ran', now)
  assert.equal(next.lastOutcome, 'ran')
  assert.equal(next.lastRunAt, now.toISOString())
  assert.deepEqual(parts(new Date(next.nextRunAt)), [2026, 11, 19, 18, 0])
})

test('a skip advances without touching lastRunAt', () => {
  const r = routine({ lastRunAt: local(2026, 11, 17, 18).toISOString() })
  const next = record(r, 'skipped_busy', local(2026, 11, 18, 18))
  assert.equal(next.lastOutcome, 'skipped_busy')
  assert.equal(next.lastRunAt, r.lastRunAt)
  assert.deepEqual(parts(new Date(next.nextRunAt)), [2026, 11, 19, 18, 0])
})

test('a backlog of days is recorded missed once and never runs', () => {
  let list = [routine({ nextRunAt: local(2026, 11, 15, 18).toISOString() })]
  const now = local(2026, 11, 18, 20)
  const first = due(list, now)
  assert.equal(first.length, 1)
  assert.equal(scheduledOutcome(first[0], now, clear), 'missed')
  list = [record(first[0], 'missed', now)]
  assert.equal(list[0].lastRunAt, null)
  assert.deepEqual(parts(new Date(list[0].nextRunAt)), [2026, 11, 19, 18, 0])
  assert.equal(due(list, now).length, 0)
  assert.equal(due(list, new Date(now.getTime() + 30_000)).length, 0)
})

test('a manual run keeps the schedule', () => {
  const r = routine()
  const next = record(r, 'ran', local(2026, 11, 18, 11), true)
  assert.equal(next.nextRunAt, r.nextRunAt)
  assert.equal(next.lastOutcome, 'ran')
})

test('every N hours counts from the last run, or from creation', () => {
  const every = { kind: 'every', hours: 2 }
  const created = routine({ schedule: every, createdAt: local(2026, 11, 18, 9).toISOString() })
  assert.deepEqual(parts(new Date(upcoming(created, local(2026, 11, 18, 10)))), [2026, 11, 18, 11, 0])
  const ran = { ...created, lastRunAt: local(2026, 11, 18, 10, 30).toISOString() }
  assert.deepEqual(parts(new Date(upcoming(ran, local(2026, 11, 18, 11)))), [2026, 11, 18, 12, 30])
  const stale = { ...created, lastRunAt: local(2026, 11, 17, 10).toISOString() }
  assert.deepEqual(parts(new Date(upcoming(stale, local(2026, 11, 18, 11)))), [2026, 11, 18, 13, 0])
  assert.equal(upcoming({ ...created, enabled: false }, local(2026, 11, 18, 10)), null)
})

test('labels name the day only when it is not today', () => {
  const now = local(2026, 11, 18, 10)
  assert.equal(dayWord(local(2026, 11, 18, 23), now), 'today')
  assert.equal(dayWord(local(2026, 11, 19, 1), now), 'tomorrow')
  assert.equal(dayWord(local(2026, 11, 23, 8), now), 'Mon')
  assert.equal(nextLabel(routine(), now), 'Evening summary 6 PM')
  assert.equal(nextLabel(routine({ name: 'Weekly plan', nextRunAt: local(2026, 11, 23, 8).toISOString() }), now), 'Weekly plan Mon 8 AM')
  assert.equal(nextLabel(routine({ nextRunAt: null }), now), null)
})

test('soonest ignores routines that are off', () => {
  const a = routine({ id: 'a', nextRunAt: local(2026, 11, 19, 8).toISOString() })
  const b = routine({ id: 'b' })
  const off = routine({ id: 'off', enabled: false, nextRunAt: null })
  assert.equal(soonest([a, off, b]).id, 'b')
  assert.equal(soonest([off]), null)
})
