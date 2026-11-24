import { randomUUID } from 'node:crypto'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Alias } from './router'
import { delegatedBots, isWorking, type SessionState } from './session'
import { readUsage, writeUsage } from './store'
import { markRejected, mergeUsage, parseLimitError, parseRateLimit, type Usage } from './usage'
import type { Answers, Bot, BotId, BotStatus, BotView, Capabilities, Effort, Question, StreamEvent } from './types'

export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiting: ((r: IteratorResult<T>) => void) | null = null
  private closed = false

  // False when the queue is closed and the item was dropped.
  push(item: T): boolean {
    if (this.closed) return false
    if (this.waiting) {
      this.waiting({ value: item, done: false })
      this.waiting = null
    } else this.items.push(item)
    return true
  }

  close(): void {
    this.closed = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = null
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const next = this.items.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.closed) return
      const r = await new Promise<IteratorResult<T>>((resolve) => (this.waiting = resolve))
      if (r.done) return
      yield r.value
    }
  }
}

export type LiveSession = {
  botId: BotId
  query: Query
  inbox: AsyncQueue<SDKUserMessage>
  state: SessionState
  // The Chief's team at open time, for the guard and for attributing subagents.
  team: ReadonlySet<BotId>
  idleTimer: NodeJS.Timeout | null
  // The model will-bot last set on this session; null means the employee's configured model.
  model: Alias | null
  // The effort will-bot last set; undefined means never set (Claude Code's default).
  effort?: Effort | null
  // Pushes into the inbox; false if the session already closed.
  push: (message: SDKUserMessage) => boolean
  // The user's Stop: interrupts the turn and drops messages queued behind it.
  // False when nothing was running.
  stop: () => Promise<boolean>
}

export type ApprovalOutcome = 'allowed' | 'denied' | 'expired'
export type QuestionOutcome = { answers: Answers } | 'expired'

// One registry for everything a session waits on the user for.
// botId is the employee asking; ownerId is the session it runs in.
type PendingDecision = { botId: BotId; ownerId: BotId } & (
  | { kind: 'approval'; resolve: (o: ApprovalOutcome) => void }
  | { kind: 'question'; questions: Question[]; resolve: (o: QuestionOutcome) => void }
)
type DecisionKind = PendingDecision['kind']
type OutcomeOf<K extends DecisionKind> = Parameters<Extract<PendingDecision, { kind: K }>['resolve']>[0]

type Runtime = {
  sessions: Map<BotId, LiveSession>
  decisions: Map<string, PendingDecision>
  subscribers: Map<BotId, Set<(e: StreamEvent) => void>>
  // Messages accepted but not yet in the session's inbox (being routed), one controller each.
  sending: Map<BotId, Set<AbortController>>
  // Each employee's sends run in order, so routes and messages never reorder.
  sendTail: Map<BotId, Promise<void>>
  // Teammate messages since the employee's last message from the user or a routine.
  hops: Map<BotId, number>
  capabilities?: { at: number; ttl: number; value: Promise<Capabilities> }
  // Plan usage from the latest rate_limit_event; undefined until read from data/usage.json.
  usage?: Usage | null
  // The routine scheduler's one interval. It calls `tick`, which each HMR'd module replaces.
  scheduler?: { timer: NodeJS.Timeout; tick: () => Promise<void> }
}

export const DECISION_TIMEOUT_MS = 10 * 60 * 1000

// Next dev re-evaluates modules on HMR; live sessions and decisions must survive it.
const g = globalThis as typeof globalThis & { __willbotSessions?: Runtime }
export const rt: Runtime = (g.__willbotSessions ??= {
  sessions: new Map(),
  decisions: new Map(),
  subscribers: new Map(),
  sending: new Map(),
  sendTail: new Map(),
  hops: new Map(),
})
// A runtime kept across an HMR from before these fields existed.
rt.sending ??= new Map()
rt.sendTail ??= new Map()
rt.hops ??= new Map()

const CAPABILITIES_TTL_MS = 10 * 60 * 1000
const CAPABILITIES_FAILURE_TTL_MS = 60 * 1000

// Each probe starts a Claude Code process, so concurrent callers share one,
// and a failure is kept for a minute rather than retried on every request.
export function cachedCapabilities(load: () => Promise<Capabilities>): Promise<Capabilities> {
  const hit = rt.capabilities
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value
  const value = load().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
  const entry = { at: Date.now(), ttl: CAPABILITIES_TTL_MS, value }
  rt.capabilities = entry
  void value.then((v) => {
    // The failure's minute starts when the probe gives up, not when it began.
    if ('error' in v) Object.assign(entry, { at: Date.now(), ttl: CAPABILITIES_FAILURE_TTL_MS })
  })
  return value
}

export function subscribe(botId: BotId, fn: (e: StreamEvent) => void): () => void {
  let set = rt.subscribers.get(botId)
  if (!set) rt.subscribers.set(botId, (set = new Set()))
  set.add(fn)
  return () => {
    set.delete(fn)
    if (set.size === 0 && rt.subscribers.get(botId) === set) rt.subscribers.delete(botId)
  }
}

export function publish(botId: BotId, e: StreamEvent): void {
  for (const fn of rt.subscribers.get(botId) ?? []) {
    try {
      fn(e)
    } catch {}
  }
}

type DecisionInit<K extends DecisionKind> = Omit<Extract<PendingDecision, { kind: K }>, 'resolve'>

export function awaitDecision<K extends DecisionKind>(
  init: DecisionInit<K>,
  signal: AbortSignal,
): { id: string; outcome: Promise<OutcomeOf<K>> } {
  const id = randomUUID()
  const expired = 'expired' as OutcomeOf<K>
  if (signal.aborted) return { id, outcome: Promise.resolve(expired) }
  const outcome = new Promise<OutcomeOf<K>>((resolve) => {
    const finish = (o: OutcomeOf<K>) => {
      if (!rt.decisions.delete(id)) return
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(o)
    }
    const timer = setTimeout(() => finish(expired), DECISION_TIMEOUT_MS)
    const onAbort = () => finish(expired)
    signal.addEventListener('abort', onAbort, { once: true })
    rt.decisions.set(id, { ...init, resolve: finish } as PendingDecision)
  })
  return { id, outcome }
}

export function decideApproval(id: string, allow: boolean): boolean {
  const d = rt.decisions.get(id)
  if (d?.kind !== 'approval') return false
  d.resolve(allow ? 'allowed' : 'denied')
  return true
}

export function pendingQuestions(id: string): Question[] | null {
  const d = rt.decisions.get(id)
  return d?.kind === 'question' ? d.questions : null
}

export function answerQuestion(id: string, answers: Answers): boolean {
  const d = rt.decisions.get(id)
  if (d?.kind !== 'question') return false
  d.resolve({ answers })
  return true
}

export function isDecisionPending(id: string): boolean {
  return rt.decisions.has(id)
}

export function expireDecisions(ownerId: BotId): void {
  for (const d of [...rt.decisions.values()]) if (d.ownerId === ownerId) d.resolve('expired')
}

export function pendingDecisions(): { id: string; kind: DecisionKind; botId: BotId; ownerId: BotId }[] {
  return [...rt.decisions].map(([id, d]) => ({ id, kind: d.kind, botId: d.botId, ownerId: d.ownerId }))
}

// The employee is mid-turn in its own chat, or has messages about to start one.
export function busyInOwnChat(botId: BotId): boolean {
  const phase = rt.sessions.get(botId)?.state.phase
  return phase === 'starting' || phase === 'running' || (rt.sending.get(botId)?.size ?? 0) > 0
}

export function delegatedBy(botId: BotId): BotId | null {
  for (const [owner, live] of rt.sessions) if (delegatedBots(live.state).has(botId)) return owner
  return null
}

export function viewBot(
  bot: Bot,
  names: Map<BotId, string>,
  nextRoutine: string | null,
  chat: Pick<BotView, 'last' | 'lastReplyAt'>,
): BotView {
  const waiting = [...rt.decisions.values()].some((d) => d.botId === bot.id || d.ownerId === bot.id)
  const live = rt.sessions.get(bot.id)
  const delegator = delegatedBy(bot.id)
  const status: BotStatus = bot.paused
    ? 'paused'
    : waiting
      ? 'needs_approval'
      : (live && isWorking(live.state)) || delegator || rt.sending.get(bot.id)?.size
        ? 'working'
        : 'idle'
  const statusLine = {
    paused: 'Paused · you are driving',
    needs_approval: 'Needs your answer',
    working: delegator ? `Working for ${names.get(delegator) ?? delegator}` : 'Working',
    idle: nextRoutine ? `Idle · next: ${nextRoutine}` : 'Idle',
  }[status]
  return { ...bot, status, statusLine, delegatedBy: delegator, ...chat }
}

export function currentUsage(): Usage | null {
  if (rt.usage === undefined) rt.usage = readUsage()
  return rt.usage
}

function setUsage(usage: Usage): void {
  rt.usage = usage
  writeUsage(usage)
}

// Every model call reports the plan's rate limits; there is no other way to ask.
export function noteRateLimit(info: unknown): void {
  const next = parseRateLimit(info)
  if (next) setUsage(mergeUsage(currentUsage(), next))
}

export function noteLimitError(text: string): void {
  const hit = parseLimitError(text, new Date())
  if (hit) setUsage(markRejected(currentUsage(), hit, new Date().toISOString()))
}
