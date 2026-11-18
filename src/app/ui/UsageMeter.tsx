'use client'

import { levelOf, reachedWindow, type Level, type Usage, type UsageWindow } from '@/lib/usage'

const ROWS: [kind: string, label: string][] = [
  ['five_hour', '5-hour'],
  ['seven_day', 'Weekly'],
]

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'weekly',
  seven_day_opus: 'weekly Opus',
  seven_day_sonnet: 'weekly Sonnet',
}

const LEVEL_LABELS: Record<Level, string | null> = {
  ok: null,
  high: 'Getting close',
  critical: 'Almost out',
  reached: 'Limit reached',
}

function resetTime(w: UsageWindow): string | null {
  if (w.resetsAt === null) return null
  const at = new Date(w.resetsAt * 1000)
  return w.kind === 'five_hour'
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function percentOf(w: UsageWindow, now: number): number | null {
  if (w.resetsAt !== null && w.resetsAt * 1000 <= now) return 0
  return w.utilization === null ? null : Math.round(Math.min(Math.max(w.utilization, 0), 1) * 100)
}

function ago(iso: string, now: number): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000)
  if (min < 1) return 'Updated just now'
  if (min < 60) return `Updated ${min} min ago`
  const h = Math.floor(min / 60)
  return h < 24 ? `Updated ${h} h ago` : `Updated ${new Date(iso).toLocaleDateString()}`
}

type Row = { label: string; level: Level; percent: number | null; reset: string }

function rowsOf(usage: Usage, now: number): Row[] {
  return ROWS.flatMap(([kind, label]) => {
    const w = usage.windows.find((x) => x.kind === kind)
    if (!w) return []
    const time = resetTime(w)
    const passed = w.resetsAt !== null && w.resetsAt * 1000 <= now
    const reset = time ? `${passed ? 'reset' : 'resets'} ${time}` : ''
    return [{ label, level: levelOf(w, now / 1000), percent: percentOf(w, now), reset }]
  })
}

function sentence(r: Row): string {
  const parts = [`${r.label} ${r.percent === null ? 'unknown' : `${r.percent}%`}`, LEVEL_LABELS[r.level], r.reset]
  return parts.filter(Boolean).join(', ')
}

export function UsageMeter({ usage, now }: { usage: Usage | null; now: number }) {
  const rows = usage ? rowsOf(usage, now) : []
  const updated = usage ? ago(usage.seenAt, now) : null
  const worst = rows.find((r) => r.level === 'reached') ?? rows.toSorted((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]
  const summary = rows.length
    ? `Plan usage: ${rows.map(sentence).join('; ')}. ${updated}.`
    : 'Plan usage shows after the first message.'

  return (
    <>
      <section className="usage" aria-label="Plan usage">
        <div className="sectionLabel">Plan usage</div>
        {rows.length === 0 ? (
          <p className="usageNote">Usage shows after the first message.</p>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.label} className={`usageRow ${r.level}`}>
                <div className="usageTop">
                  <span className="usageName">{r.label}</span>
                  <span className="usagePercent">{r.percent === null ? '–' : `${r.percent}%`}</span>
                </div>
                <div className="usageBar" aria-hidden="true">
                  <div className="usageFill" style={{ width: `${r.level === 'reached' ? 100 : (r.percent ?? 0)}%` }} />
                </div>
                <div className="usageNote">
                  {LEVEL_LABELS[r.level] && <span className="usageLevel">{LEVEL_LABELS[r.level]}</span>}
                  {LEVEL_LABELS[r.level] && r.reset && ' · '}
                  {r.reset}
                </div>
              </div>
            ))}
            <p className="usageNote">{updated}</p>
          </>
        )}
      </section>
      <div className={`usageRing ${worst?.level ?? 'ok'}`} role="img" aria-label={summary} title={summary}>
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle className="usageRingTrack" cx="18" cy="18" r="15" />
          {worst && (
            <circle
              className="usageRingFill"
              cx="18"
              cy="18"
              r="15"
              pathLength="100"
              strokeDasharray={`${worst.level === 'reached' ? 100 : (worst.percent ?? 0)} 100`}
            />
          )}
        </svg>
      </div>
    </>
  )
}

// The chat banner and Send's title while a window is at its limit. Send stays
// on when the reset time is unknown, since only a new call could clear it.
export function limitNotice(usage: Usage | null, now: number): { text: string; blocks: boolean } | null {
  const w = reachedWindow(usage, now / 1000)
  if (!w) return null
  const name = LIMIT_NAMES[w.kind] ?? w.kind.replace(/_/g, ' ')
  const time = resetTime(w)
  const when = time ? `${w.kind === 'five_hour' ? 'at' : 'on'} ${time}` : 'when it resets'
  return { text: `Your plan's ${name} limit is reached. Employees can work again ${when}.`, blocks: time !== null }
}
