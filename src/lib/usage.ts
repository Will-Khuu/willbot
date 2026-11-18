import { z } from 'zod'

export const WINDOW_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const
const StatusSchema = z.enum(WINDOW_STATUSES)

// kind is Claude Code's rateLimitType: five_hour, seven_day, seven_day_opus and so on.
// resetsAt is epoch seconds; utilization runs from 0 to 1.
export const UsageWindowSchema = z.object({
  kind: z.string(),
  utilization: z.number().nullable(),
  resetsAt: z.number().nullable(),
  status: StatusSchema,
})
export type UsageWindow = z.infer<typeof UsageWindowSchema>

export const UsageSchema = z.object({ windows: z.array(UsageWindowSchema), seenAt: z.string() })
export type Usage = z.infer<typeof UsageSchema>

const num = z.number().finite().optional().catch(undefined)

// unifiedWindows is not in the SDK's published type, so every field is optional here.
const RateLimitInfoSchema = z.object({
  status: StatusSchema,
  resetsAt: num,
  utilization: num,
  rateLimitType: z.string().optional().catch(undefined),
  unifiedWindows: z
    .record(z.string(), z.object({ utilization: num, resetsAt: num, status: StatusSchema.optional().catch(undefined) }).catch({}))
    .optional()
    .catch(undefined),
})

const ORDER = ['five_hour', 'seven_day']
const rank = (kind: string) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length)
const sorted = (windows: UsageWindow[]) => windows.toSorted((a, b) => rank(a.kind) - rank(b.kind))

export function parseRateLimit(info: unknown, seenAt: string = new Date().toISOString()): Usage | null {
  const parsed = RateLimitInfoSchema.safeParse(info)
  if (!parsed.success) return null
  const { status, resetsAt, utilization, rateLimitType, unifiedWindows } = parsed.data
  const windows: UsageWindow[] = Object.entries(unifiedWindows ?? {}).map(([kind, w]) => ({
    kind,
    utilization: w.utilization ?? null,
    resetsAt: w.resetsAt ?? null,
    status: w.status ?? 'allowed',
  }))
  // The top-level fields describe the window that decided this call, so they win for it.
  if (rateLimitType) {
    const top: UsageWindow = { kind: rateLimitType, utilization: utilization ?? null, resetsAt: resetsAt ?? null, status }
    const i = windows.findIndex((w) => w.kind === rateLimitType)
    if (i < 0) windows.push(top)
    else {
      const w = windows[i]!
      windows[i] = {
        kind: w.kind,
        utilization: w.utilization ?? top.utilization,
        resetsAt: w.resetsAt ?? top.resetsAt,
        status: status === 'rejected' ? 'rejected' : w.status,
      }
    }
  }
  return windows.length ? { windows: sorted(windows), seenAt } : null
}

// An event without unifiedWindows names one window; the others keep their last known state.
export function mergeUsage(prev: Usage | null, next: Usage): Usage {
  const kinds = new Set(next.windows.map((w) => w.kind))
  return { windows: sorted([...(prev?.windows ?? []).filter((w) => !kinds.has(w.kind)), ...next.windows]), seenAt: next.seenAt }
}

export type LimitHit = { kind: string; resetsAt: number | null }

const HIT_KINDS: [RegExp, string][] = [
  [/5-hour|five.hour/i, 'five_hour'],
  [/opus/i, 'seven_day_opus'],
  [/sonnet/i, 'seven_day_sonnet'],
  [/weekly|7-day|seven.day/i, 'seven_day'],
]

// Reads Claude Code's "You've hit your 5-hour limit · resets 5:40am". The reset
// is read only when it is a bare time, the next one after now in local time.
export function parseLimitError(text: string, now: Date): LimitHit | null {
  const m = /hit your (.{1,40}?) limit/i.exec(text)
  const kind = m && HIT_KINDS.find(([re]) => re.test(m[1]!))?.[1]
  if (!kind) return null
  const t = /resets (\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text)
  if (!t) return { kind, resetsAt: null }
  const hour = (Number(t[1]) % 12) + (t[3]!.toLowerCase() === 'pm' ? 12 : 0)
  const at = new Date(now)
  at.setHours(hour, Number(t[2] ?? 0), 0, 0)
  if (at <= now) at.setDate(at.getDate() + 1)
  return { kind, resetsAt: Math.floor(at.getTime() / 1000) }
}

export function markRejected(prev: Usage | null, hit: LimitHit, seenAt: string): Usage {
  const old = prev?.windows.find((w) => w.kind === hit.kind)
  const window: UsageWindow = { kind: hit.kind, utilization: 1, resetsAt: hit.resetsAt ?? old?.resetsAt ?? null, status: 'rejected' }
  return mergeUsage(prev, { windows: [window], seenAt })
}

export type Level = 'ok' | 'high' | 'critical' | 'reached'

// A rejected window whose reset time has passed no longer blocks; only a new call can say more.
export function levelOf(w: UsageWindow, nowSec: number): Level {
  const expired = w.resetsAt !== null && w.resetsAt <= nowSec
  if (w.status === 'rejected' && !expired) return 'reached'
  const u = expired ? 0 : (w.utilization ?? 0)
  return u > 0.9 ? 'critical' : u >= 0.7 ? 'high' : 'ok'
}

export function reachedWindow(usage: Usage | null, nowSec: number): UsageWindow | null {
  return usage?.windows.find((w) => levelOf(w, nowSec) === 'reached') ?? null
}
