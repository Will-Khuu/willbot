import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CREATE_ROUTINE, DELETE_ROUTINE, guardToolCall, HIRE, LIST_ROUTINES, LIST_TEAMMATES, MESSAGE_TEAMMATE, REMEMBER, SESSION_SCHEDULER_REASON, UPDATE_ROUTINE } from './guard.ts'

const employees = {
  chief: { name: 'Chief of Staff', paused: false, hire: true },
  research: { name: 'Research Bot', paused: false, hire: false },
  builder: { name: 'Builder Bot', paused: true, hire: false },
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

test('remember is only for the session owner, never a subagent', () => {
  assert.equal(guardToolCall(call({ toolName: REMEMBER }), lookup), null)
  assert.match(guardToolCall(call({ toolName: REMEMBER, agentId: 'a1', agentType: 'Explore' }), lookup), /not a subagent/)
  assert.match(guardToolCall(call({ toolName: REMEMBER, agentId: 'a1', agentType: 'research' }), lookup), /not a subagent/)
})

test('only the session owner may message a teammate, never a subagent', () => {
  assert.equal(guardToolCall(call({ toolName: MESSAGE_TEAMMATE }), lookup), null)
  assert.equal(guardToolCall(call({ ownerId: 'research', team: new Set(), toolName: MESSAGE_TEAMMATE }), lookup), null)
  assert.match(guardToolCall(call({ toolName: MESSAGE_TEAMMATE, agentId: 'a1', agentType: 'Explore' }), lookup), /not a subagent/)
  // A teammate running inside the Chief's session is a subagent too.
  assert.match(guardToolCall(call({ toolName: MESSAGE_TEAMMATE, agentId: 'a1', agentType: 'research' }), lookup), /not a subagent/)
  assert.equal(guardToolCall(call({ toolName: LIST_TEAMMATES, agentId: 'a1', agentType: 'research' }), lookup), null)
})

test('only the session owner may hire, never a subagent', () => {
  assert.equal(guardToolCall(call({ toolName: HIRE }), lookup), null)
  assert.match(guardToolCall(call({ toolName: HIRE, agentId: 'a1', agentType: 'general-purpose' }), lookup), /not a subagent/)
  assert.match(guardToolCall(call({ toolName: HIRE, agentId: 'a1', agentType: 'research' }), lookup), /not a subagent/)
})

test('hire reads the switch on every call', () => {
  const live = { ...employees, chief: { ...employees.chief } }
  const liveLookup = (id) => live[id] ?? null
  assert.equal(guardToolCall(call({ toolName: HIRE }), liveLookup), null)
  live.chief.hire = false
  assert.match(guardToolCall(call({ toolName: HIRE }), liveLookup), /turned off/)
})

test("Claude Code's session schedulers are redirected to routines for every employee", () => {
  for (const toolName of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup']) {
    assert.equal(guardToolCall(call({ toolName }), lookup), SESSION_SCHEDULER_REASON, toolName)
    assert.equal(guardToolCall(call({ ownerId: 'research', team: new Set(), toolName }), lookup), SESSION_SCHEDULER_REASON, toolName)
    assert.equal(guardToolCall(call({ toolName, agentId: 'a1', agentType: 'research' }), lookup), SESSION_SCHEDULER_REASON, toolName)
  }
  assert.match(SESSION_SCHEDULER_REASON, /mcp__willbot__create_routine/)
  assert.equal(guardToolCall(call({ toolName: 'RemoteTrigger' }), lookup), null)
})

test('routine tools are for the session owner, never a subagent', () => {
  for (const toolName of [LIST_ROUTINES, CREATE_ROUTINE, UPDATE_ROUTINE, DELETE_ROUTINE]) {
    assert.equal(guardToolCall(call({ toolName }), lookup), null, toolName)
    assert.equal(guardToolCall(call({ ownerId: 'research', team: new Set(), toolName }), lookup), null, toolName)
    assert.match(guardToolCall(call({ toolName, agentId: 'a1', agentType: 'general-purpose' }), lookup), /not a subagent/, toolName)
    assert.match(guardToolCall(call({ toolName, agentId: 'a1', agentType: 'research' }), lookup), /not a subagent/, toolName)
  }
})

test('a paused or deleted employee cannot manage routines', () => {
  assert.match(guardToolCall(call({ ownerId: 'builder', team: new Set(), toolName: CREATE_ROUTINE }), lookup), /paused/)
  assert.match(guardToolCall(call({ ownerId: 'nobody', team: new Set(), toolName: CREATE_ROUTINE }), lookup), /deleted/)
})
