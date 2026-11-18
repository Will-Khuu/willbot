import type { BotId } from './types'

export const REMEMBER = 'mcp__willbot__remember'

export type Employee = { name: string; paused: boolean }
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
  if (call.toolName === REMEMBER && actor !== call.ownerId) return 'Only the employee the user is talking to can remember.'
  return null
}
