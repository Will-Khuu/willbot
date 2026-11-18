import assert from 'node:assert/strict'
import { test } from 'node:test'
import { levelOf, markRejected, mergeUsage, parseLimitError, parseRateLimit, reachedWindow } from './usage.ts'

const SEEN = '2026-11-18T10:00:00.000Z'

const REAL = {
  status: 'allowed',
  resetsAt: 1795011600,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  overageDisabledReason: 'org_level_disabled',
  isUsingOverage: false,
  unifiedWindows: {
    five_hour: { utilization: 0.09, resetsAt: 1795011600, status: 'allowed' },
    seven_day: { utilization: 0.01, resetsAt: 1795010400, status: 'allowed' },
  },
}

test('the real payload gives both windows, 5-hour first', () => {
  assert.deepEqual(parseRateLimit(REAL, SEEN), {
    windows: [
      { kind: 'five_hour', utilization: 0.09, resetsAt: 1795011600, status: 'allowed' },
      { kind: 'seven_day', utilization: 0.01, resetsAt: 1795010400, status: 'allowed' },
    ],
    seenAt: SEEN,
  })
})

test('without unifiedWindows the top-level fields make one window', () => {
  const usage = parseRateLimit({ status: 'allowed_warning', resetsAt: 1795010400, rateLimitType: 'seven_day', utilization: 0.8 }, SEEN)
  assert.deepEqual(usage?.windows, [{ kind: 'seven_day', utilization: 0.8, resetsAt: 1795010400, status: 'allowed_warning' }])
})

test('a top-level rejected status marks its window rejected', () => {
  const usage = parseRateLimit({ ...REAL, status: 'rejected' }, SEEN)
  assert.equal(usage?.windows[0].status, 'rejected')
  assert.equal(usage?.windows[1].status, 'allowed')
  assert.equal(levelOf(usage.windows[0], 1795000000), 'reached')
  assert.equal(reachedWindow(usage, 1795000000)?.kind, 'five_hour')
})

test('junk parses to null', () => {
  for (const junk of [null, undefined, 42, 'x', {}, { status: 'nope' }, { status: 'allowed' }, { status: 'allowed', unifiedWindows: {} }]) {
    assert.equal(parseRateLimit(junk, SEEN), null, JSON.stringify(junk))
  }
})

test('junk inside unifiedWindows is dropped, not fatal', () => {
  const usage = parseRateLimit({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 'lots', status: 7 } } }, SEEN)
  assert.deepEqual(usage?.windows, [{ kind: 'five_hour', utilization: null, resetsAt: null, status: 'allowed' }])
})

test('a one-window event keeps the other window', () => {
  const prev = parseRateLimit(REAL, SEEN)
  const next = parseRateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1 }, 'later')
  const merged = mergeUsage(prev, next)
  assert.deepEqual(
    merged.windows.map((w) => [w.kind, w.utilization]),
    [
      ['five_hour', 0.5],
      ['seven_day', 0.01],
    ],
  )
  assert.equal(merged.seenAt, 'later')
})

test('the limit error names the window and the next reset', () => {
  const now = new Date(2026, 10, 18, 3, 0)
  const hit = parseLimitError("You've hit your 5-hour limit · resets 5:40am", now)
  assert.equal(hit?.kind, 'five_hour')
  assert.equal(hit?.resetsAt, new Date(2026, 10, 18, 5, 40).getTime() / 1000)
  const tomorrow = parseLimitError("You've hit your 5-hour limit · resets 2am", now)
  assert.equal(tomorrow?.resetsAt, new Date(2026, 10, 19, 2, 0).getTime() / 1000)
  assert.deepEqual(parseLimitError("You've hit your weekly limit · resets Nov 21, 5am", now), { kind: 'seven_day', resetsAt: null })
  assert.equal(parseLimitError('Something else broke', now), null)
})

test('a limit hit marks the window rejected and keeps a known reset', () => {
  const prev = parseRateLimit(REAL, SEEN)
  const usage = markRejected(prev, { kind: 'five_hour', resetsAt: null }, 'later')
  assert.deepEqual(usage.windows[0], { kind: 'five_hour', utilization: 1, resetsAt: 1795011600, status: 'rejected' })
  assert.equal(usage.windows[1].kind, 'seven_day')
})

test('levels follow utilization, and a passed reset clears a rejection', () => {
  const w = (utilization, status = 'allowed', resetsAt = 2000) => ({ kind: 'five_hour', utilization, resetsAt, status })
  assert.equal(levelOf(w(0.69), 1000), 'ok')
  assert.equal(levelOf(w(0.7), 1000), 'high')
  assert.equal(levelOf(w(0.9), 1000), 'high')
  assert.equal(levelOf(w(0.91), 1000), 'critical')
  assert.equal(levelOf(w(0.2, 'rejected'), 1000), 'reached')
  assert.equal(levelOf(w(1, 'rejected'), 3000), 'ok')
  assert.equal(levelOf(w(null, 'rejected', null), 3000), 'reached')
})
