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
  // Messages pushed since the CLI last reported a running turn or a result.
  // While any are out, an idle report is from before them and is ignored.
  unacknowledged: number
  // The user stopped the running turn, so its error result reads as "Stopped.".
  interrupted: boolean
}

export type SessionEvent =
  | { type: 'pushed' }
  | { type: 'opened' }
  | { type: 'result' }
  | { type: 'interrupted' }
  | { type: 'cli_state'; state: 'idle' | 'running' | 'requires_action' }
  | { type: 'background'; taskIds: readonly string[] }
  | { type: 'delegated'; toolUseId: string; botId: BotId }
  | { type: 'delegation_ended'; toolUseId: string }
  | { type: 'edited' }
  | { type: 'closing' }

export const initialSession: SessionState = {
  phase: 'starting',
  stale: false,
  background: [],
  delegated: new Map(),
  unacknowledged: 0,
  interrupted: false,
}

export function reduce(s: SessionState, e: SessionEvent): SessionState {
  if (s.phase === 'closing') return s
  switch (e.type) {
    case 'pushed': {
      const next = { ...s, unacknowledged: s.unacknowledged + 1, interrupted: false }
      return s.phase === 'starting' ? next : { ...next, phase: 'running' }
    }
    case 'opened':
      // A session opens only to carry a message, so it starts running.
      return s.phase === 'starting' ? { ...s, phase: 'running' } : s
    case 'cli_state': {
      if (s.phase === 'starting') return s
      if (e.state !== 'idle') return { ...s, phase: 'running', unacknowledged: 0 }
      if (s.unacknowledged > 0) return s
      // A delegation whose end we missed must not keep its employee busy forever.
      const delegated = s.background.length === 0 ? new Map<string, BotId>() : s.delegated
      return { ...s, phase: 'idle', delegated }
    }
    case 'result':
      return { ...s, unacknowledged: 0, interrupted: false }
    case 'interrupted': {
      // A session still starting has a turn only if a message waits for it.
      const turn = s.phase === 'running' || (s.phase === 'starting' && s.unacknowledged > 0)
      return turn ? { ...s, interrupted: true } : s
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
