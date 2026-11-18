import { randomUUID } from 'node:crypto'
import type { Bot, BotId, BotStatus, BotView, Capabilities } from './types'

export type ApprovalOutcome = 'allowed' | 'denied' | 'expired'

type ActiveRun = { abort: AbortController; delegated: Set<BotId> }
type PendingApproval = {
  botId: BotId
  ownerId: BotId
  action: string
  resolve: (outcome: ApprovalOutcome) => void
}

type Runtime = {
  runs: Map<BotId, ActiveRun>
  approvals: Map<string, PendingApproval>
  capabilities?: { at: number; value: Promise<Capabilities> }
}

export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

// Next dev re-evaluates modules on HMR; the live runs and approvals must survive it.
const g = globalThis as typeof globalThis & { __willbot?: Runtime }
const rt: Runtime = (g.__willbot ??= { runs: new Map(), approvals: new Map() })

const CAPABILITIES_TTL_MS = 10 * 60 * 1000

// Concurrent callers share one probe. A failed probe is not kept, so the next
// call tries again.
export function cachedCapabilities(load: () => Promise<Capabilities>): Promise<Capabilities> {
  const hit = rt.capabilities
  if (hit && Date.now() - hit.at < CAPABILITIES_TTL_MS) return hit.value
  const value = load().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
  const entry = { at: Date.now(), value }
  rt.capabilities = entry
  void value.then((v) => {
    if ('error' in v && rt.capabilities === entry) rt.capabilities = undefined
  })
  return value
}

export function startRun(botId: BotId): ActiveRun | null {
  if (rt.runs.has(botId)) return null
  const run = { abort: new AbortController(), delegated: new Set<BotId>() }
  rt.runs.set(botId, run)
  return run
}

export function endRun(botId: BotId, run: ActiveRun): void {
  if (rt.runs.get(botId) === run) rt.runs.delete(botId)
}

// A bot working as a subagent lives inside its delegator's run, so stopping it
// means aborting that run too.
export function stopRun(botId: BotId): boolean {
  const runs = [...rt.runs].filter(([owner, run]) => owner === botId || run.delegated.has(botId))
  for (const [, run] of runs) run.abort.abort()
  return runs.length > 0
}

export function isBusy(botId: BotId): boolean {
  return rt.runs.has(botId) || delegatedBy(botId) !== null
}

export function requestApproval(
  botId: BotId,
  ownerId: BotId,
  action: string,
  signal: AbortSignal,
): { id: string; outcome: Promise<ApprovalOutcome> } {
  const id = randomUUID()
  if (signal.aborted) return { id, outcome: Promise.resolve('expired') }
  const outcome = new Promise<ApprovalOutcome>((resolve) => {
    const finish = (o: ApprovalOutcome) => {
      if (!rt.approvals.delete(id)) return
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(o)
    }
    const timer = setTimeout(() => finish('expired'), APPROVAL_TIMEOUT_MS)
    const onAbort = () => finish('expired')
    signal.addEventListener('abort', onAbort, { once: true })
    rt.approvals.set(id, { botId, ownerId, action, resolve: finish })
  })
  return { id, outcome }
}

export function decideApproval(id: string, allow: boolean): boolean {
  const pending = rt.approvals.get(id)
  if (!pending) return false
  pending.resolve(allow ? 'allowed' : 'denied')
  return true
}

export function isApprovalPending(id: string): boolean {
  return rt.approvals.has(id)
}

export function pendingApprovals(): { id: string; botId: BotId; ownerId: BotId; action: string }[] {
  return [...rt.approvals].map(([id, a]) => ({ id, botId: a.botId, ownerId: a.ownerId, action: a.action }))
}

export function delegatedBy(botId: BotId): BotId | null {
  for (const [owner, run] of rt.runs) if (run.delegated.has(botId)) return owner
  return null
}

export function viewBot(bot: Bot, names: Map<BotId, string>): BotView {
  const waiting = [...rt.approvals.values()].some((a) => a.botId === bot.id || a.ownerId === bot.id)
  const delegator = delegatedBy(bot.id)
  const status: BotStatus = bot.paused
    ? 'paused'
    : waiting
      ? 'needs_approval'
      : rt.runs.has(bot.id) || delegator
        ? 'working'
        : 'idle'
  const statusLine = {
    paused: 'Paused · you are driving',
    needs_approval: 'Needs your approval',
    working: delegator ? `Working for ${names.get(delegator) ?? delegator}` : 'Working',
    idle: 'Idle',
  }[status]
  return { ...bot, status, statusLine }
}
