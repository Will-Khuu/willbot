import type { BotId } from './types'

// The lifecycle of one employee's live Claude Code session. Pure, so the
// rules for "working", "quiet" and "recycle" live in one tested place.
export type Phase = 'starting' | 'idle' | 'running' | 'closing'

export type SessionState = {
  phase: Phase
  // Job, memory, folder or team changed; the appended prompt is out of date.
  stale: boolean
  // Live background task ids that count as activity, replaced wholesale.
  background: readonly string[]
  // Agent tool_use id -> the team employee it runs (the Chief's delegations).
  delegated: ReadonlyMap<string, BotId>
}

export type SessionEvent =
  | { type: 'pushed' }
  | { type: 'opened' }
  | { type: 'cli_state'; state: 'idle' | 'running' | 'requires_action' }
  | { type: 'background'; taskIds: readonly string[] }
  | { type: 'delegated'; toolUseId: string; botId: BotId }
  | { type: 'delegation_ended'; toolUseId: string }
  | { type: 'edited' }
  | { type: 'closing' }

export const initialSession: SessionState = { phase: 'starting', stale: false, background: [], delegated: new Map() }

export function reduce(s: SessionState, e: SessionEvent): SessionState {
  if (s.phase === 'closing') return s
  switch (e.type) {
    case 'pushed':
      return s.phase === 'starting' ? s : { ...s, phase: 'running' }
    case 'opened':
      // A session opens only to carry a message, so it starts running.
      return s.phase === 'starting' ? { ...s, phase: 'running' } : s
    case 'cli_state': {
      if (s.phase === 'starting') return s
      if (e.state !== 'idle') return { ...s, phase: 'running' }
      // A delegation whose end we missed must not keep its employee busy forever.
      const delegated = s.background.length === 0 ? new Map<string, BotId>() : s.delegated
      return { ...s, phase: 'idle', delegated }
    }
    case 'background':
      return { ...s, background: [...e.taskIds] }
    case 'delegated':
      return { ...s, delegated: new Map(s.delegated).set(e.toolUseId, e.botId) }
    case 'delegation_ended': {
      if (!s.delegated.has(e.toolUseId)) return s
      const delegated = new Map(s.delegated)
      delegated.delete(e.toolUseId)
      return { ...s, delegated }
    }
    case 'edited':
      return { ...s, stale: true }
    case 'closing':
      return { ...s, phase: 'closing', delegated: new Map() }
  }
}

export function isWorking(s: SessionState): boolean {
  return s.phase === 'starting' || s.phase === 'running' || s.background.length > 0
}

// Nothing in flight: safe to close without cutting off work.
export function isQuiet(s: SessionState): boolean {
  return s.phase === 'idle' && s.background.length === 0
}

export function shouldRecycle(s: SessionState): boolean {
  return s.stale && isQuiet(s)
}

export function delegatedBots(s: SessionState): ReadonlySet<BotId> {
  return new Set(s.delegated.values())
}
