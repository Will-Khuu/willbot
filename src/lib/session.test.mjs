import assert from 'node:assert/strict'
import { test } from 'node:test'
import { delegatedBots, initialSession, isQuiet, isWorking, reduce, shouldRecycle } from './session.ts'

const run = (...events) => events.reduce(reduce, initialSession)

test('a new session is working while it starts, and stays starting until opened', () => {
  const s = run({ type: 'pushed' })
  assert.equal(s.phase, 'starting')
  assert.ok(isWorking(s))
  assert.equal(run({ type: 'cli_state', state: 'idle' }).phase, 'starting')
})

test('opening runs the queued message; the CLI says when the turn is over', () => {
  const s = run({ type: 'opened' })
  assert.equal(s.phase, 'running')
  const idle = reduce(s, { type: 'cli_state', state: 'idle' })
  assert.equal(idle.phase, 'idle')
  assert.ok(!isWorking(idle))
  assert.ok(isQuiet(idle))
  assert.equal(reduce(idle, { type: 'pushed' }).phase, 'running')
  assert.equal(reduce(idle, { type: 'cli_state', state: 'requires_action' }).phase, 'running')
})

test('background tasks keep an idle session working, and are replaced wholesale', () => {
  let s = run({ type: 'opened' }, { type: 'background', taskIds: ['t1', 't2'] }, { type: 'cli_state', state: 'idle' })
  assert.ok(isWorking(s))
  assert.ok(!isQuiet(s))
  s = reduce(s, { type: 'background', taskIds: [] })
  assert.ok(!isWorking(s))
  assert.ok(isQuiet(s))
})

test('an edit marks the session stale; it recycles only once quiet', () => {
  let s = run({ type: 'opened' }, { type: 'edited' })
  assert.ok(!shouldRecycle(s))
  s = reduce(s, { type: 'background', taskIds: ['t1'] })
  s = reduce(s, { type: 'cli_state', state: 'idle' })
  assert.ok(!shouldRecycle(s))
  s = reduce(s, { type: 'background', taskIds: [] })
  assert.ok(shouldRecycle(s))
})

test('delegations track the employees working inside the session', () => {
  let s = run({ type: 'opened' }, { type: 'delegated', toolUseId: 'u1', botId: 'research' }, { type: 'delegated', toolUseId: 'u2', botId: 'builder' })
  assert.deepEqual([...delegatedBots(s)].sort(), ['builder', 'research'])
  s = reduce(s, { type: 'delegation_ended', toolUseId: 'u1' })
  assert.deepEqual([...delegatedBots(s)], ['builder'])
  assert.equal(reduce(s, { type: 'delegation_ended', toolUseId: 'nope' }), s)
})

test('going idle with no background work clears missed delegation ends', () => {
  const s = run({ type: 'opened' }, { type: 'delegated', toolUseId: 'u1', botId: 'research' })
  assert.equal(delegatedBots(reduce(s, { type: 'cli_state', state: 'idle' })).size, 0)
  const bg = reduce(s, { type: 'background', taskIds: ['t1'] })
  assert.equal(delegatedBots(reduce(bg, { type: 'cli_state', state: 'idle' })).size, 1)
})

test('closing is terminal and drops delegations', () => {
  const s = run({ type: 'opened' }, { type: 'delegated', toolUseId: 'u1', botId: 'research' }, { type: 'closing' })
  assert.equal(s.phase, 'closing')
  assert.ok(!isWorking(s))
  assert.equal(delegatedBots(s).size, 0)
  assert.equal(reduce(s, { type: 'pushed' }), s)
  assert.equal(reduce(s, { type: 'opened' }), s)
})
