import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_TEAMMATE_HOPS, nextHops, teammatePrompt } from './teammates.ts'

test('a message from the user or a routine starts a new chain', () => {
  assert.equal(nextHops(null), 0)
})

test('a teammate message is one hop past its sender, up to the limit', () => {
  assert.equal(nextHops(0), 1)
  assert.equal(nextHops(MAX_TEAMMATE_HOPS - 1), MAX_TEAMMATE_HOPS)
  assert.equal(nextHops(MAX_TEAMMATE_HOPS), null)
})

test('two employees bouncing messages stop after the limit', () => {
  let hops = nextHops(null)
  let sent = 0
  while ((hops = nextHops(hops)) !== null) sent++
  assert.equal(sent, MAX_TEAMMATE_HOPS)
})

test('the prompt names the sender and keeps the text intact', () => {
  const p = teammatePrompt('Research "Bot"', 'research', 'line 1\nline 2')
  assert.match(p, /teammate "Research \\"Bot\\"" \(id research\), not from the user/)
  assert.match(p, /message_teammate/)
  assert.ok(p.endsWith('\n\nline 1\nline 2'))
})
