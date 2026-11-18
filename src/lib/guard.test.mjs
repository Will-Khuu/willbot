import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guardToolCall, REMEMBER } from './guard.ts'

const employees = {
  chief: { name: 'Chief of Staff', paused: false },
  research: { name: 'Research Bot', paused: false },
  builder: { name: 'Builder Bot', paused: true },
}
const lookup = (id) => employees[id] ?? null
const team = new Set(['research', 'builder', 'gone'])
const call = (over) => ({ ownerId: 'chief', team, agentId: undefined, agentType: undefined, toolName: 'Bash', input: {}, ...over })

test('the owner may use any tool; Claude Code decides', () => {
  assert.equal(guardToolCall(call({}), lookup), null)
  assert.equal(guardToolCall(call({ toolName: 'mcp__claude_ai_Gmail__send' }), lookup), null)
})

test('a paused owner is denied', () => {
  assert.match(guardToolCall(call({ ownerId: 'builder', team: new Set() }), lookup), /paused/)
})

test('a deleted owner is denied', () => {
  assert.match(guardToolCall(call({ ownerId: 'nobody', team: new Set() }), lookup), /deleted/)
})

test("a paused team employee's own calls inside the Chief's session are denied", () => {
  assert.match(guardToolCall(call({ agentId: 'a1', agentType: 'builder' }), lookup), /Builder Bot is paused/)
  assert.equal(guardToolCall(call({ agentId: 'a1', agentType: 'research' }), lookup), null)
})

test('a generic subagent acts as the owner', () => {
  assert.equal(guardToolCall(call({ agentId: 'a1', agentType: 'general-purpose' }), lookup), null)
  assert.match(guardToolCall(call({ ownerId: 'builder', team: new Set(), agentId: 'a1', agentType: 'Explore' }), lookup), /paused/)
})

test("the Chief's delegation into a paused or deleted employee is denied", () => {
  for (const toolName of ['Agent', 'Task']) {
    assert.match(guardToolCall(call({ toolName, input: { subagent_type: 'builder' } }), lookup), /paused/)
    assert.match(guardToolCall(call({ toolName, input: { subagent_type: 'gone' } }), lookup), /deleted/)
    assert.equal(guardToolCall(call({ toolName, input: { subagent_type: 'research' } }), lookup), null)
  }
})

test('delegation to a non-employee subagent is left to Claude Code', () => {
  assert.equal(guardToolCall(call({ toolName: 'Agent', input: { subagent_type: 'general-purpose' } }), lookup), null)
})

test('remember is only for the session owner', () => {
  assert.equal(guardToolCall(call({ toolName: REMEMBER }), lookup), null)
  assert.equal(guardToolCall(call({ toolName: REMEMBER, agentId: 'a1', agentType: 'Explore' }), lookup), null)
  assert.match(guardToolCall(call({ toolName: REMEMBER, agentId: 'a1', agentType: 'research' }), lookup), /Only the employee/)
})
