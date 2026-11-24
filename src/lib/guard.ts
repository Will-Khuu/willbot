import type { BotId } from './types'

export const REMEMBER = 'mcp__willbot__remember'
export const HIRE = 'mcp__willbot__hire'
export const LIST_TEAMMATES = 'mcp__willbot__list_teammates'
export const MESSAGE_TEAMMATE = 'mcp__willbot__message_teammate'
export const LIST_ROUTINES = 'mcp__willbot__list_routines'
export const CREATE_ROUTINE = 'mcp__willbot__create_routine'
export const UPDATE_ROUTINE = 'mcp__willbot__update_routine'
export const DELETE_ROUTINE = 'mcp__willbot__delete_routine'
export const ROUTINE_TOOLS: ReadonlySet<string> = new Set([LIST_ROUTINES, CREATE_ROUTINE, UPDATE_ROUTINE, DELETE_ROUTINE])

// Claude Code's own schedulers live inside the session, which will-bot closes when idle.
const SESSION_SCHEDULERS: ReadonlySet<string> = new Set(['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'])
export const SESSION_SCHEDULER_REASON =
  'will-bot closes idle sessions, so session schedules are lost. Use will-bot routines instead: mcp__willbot__create_routine / list_routines / update_routine / delete_routine.'

export type Employee = { name: string; paused: boolean; hire: boolean }
export type ToolCall = {
  // The employee whose session this is.
  ownerId: BotId
  // The team employee ids the owner's session was opened with (the Chief's team).
  team: ReadonlySet<BotId>
  // From the PreToolUse input; present only inside a subagent.
  agentId: string | undefined
  agentType: string | undefined
  toolName: string
  input: Record<string, unknown>
}

export function isDelegation(toolName: string): boolean {
  return toolName === 'Agent' || toolName === 'Task'
}

// A team employee's subagent acts as that employee; any other subagent acts
// as the session owner.
export function actorOf(call: Pick<ToolCall, 'ownerId' | 'team' | 'agentId' | 'agentType'>): BotId {
  return call.agentId && call.agentType && call.team.has(call.agentType) ? call.agentType : call.ownerId
}

function unavailable(id: BotId, lookup: (id: BotId) => Employee | null): string | null {
  const e = lookup(id)
  if (!e) return 'That employee was deleted.'
  return e.paused ? `${e.name} is paused: the user took over.` : null
}

// will-bot's only rules on top of Claude Code's own permissions. Returns a
// deny reason, or null to leave the call to Claude Code.
export function guardToolCall(call: ToolCall, lookup: (id: BotId) => Employee | null): string | null {
  const actor = actorOf(call)
  const actorBlocked = unavailable(actor, lookup)
  if (actorBlocked) return actorBlocked
  if (isDelegation(call.toolName)) {
    const target = call.input.subagent_type
    if (typeof target === 'string' && call.team.has(target)) {
      const targetBlocked = unavailable(target, lookup)
      if (targetBlocked) return targetBlocked
    }
  }
  if (SESSION_SCHEDULERS.has(call.toolName)) return SESSION_SCHEDULER_REASON
  // A subagent works from whatever it read, so it may not write memory, hire,
  // message teammates, or set up unattended runs.
  if (call.toolName === REMEMBER && call.agentId) return 'Only the employee the user is talking to can remember, not a subagent.'
  if (call.toolName === MESSAGE_TEAMMATE && call.agentId) {
    return 'Only the employee the user is talking to can message teammates, not a subagent.'
  }
  if (ROUTINE_TOOLS.has(call.toolName) && call.agentId) {
    return 'Only the employee the user is talking to can manage routines, not a subagent.'
  }
  if (call.toolName === HIRE) {
    if (call.agentId) return 'Only the employee the user is talking to can hire, not a subagent.'
    if (!lookup(call.ownerId)?.hire) return 'Hiring is turned off for this employee.'
  }
  return null
}
