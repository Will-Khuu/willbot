import type { ChatItem } from './types'

// A teammate's line names its sender (`from`), since the roster shows who wrote it.
export type LastLine = { who: 'user' | 'assistant'; text: string; at: string } | { who: 'teammate'; from: string; text: string; at: string }

// Messages further apart than this get a time divider between them.
export const DIVIDER_GAP_MS = 30 * 60_000

const DAY_MS = 86_400_000

// A plain one-line preview: link targets, code ticks and emphasis marks dropped.
function oneLine(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function lastLine(items: readonly ChatItem[]): LastLine | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'assistant' && item.text.trim()) return { who: 'assistant', text: oneLine(item.text), at: item.at }
    if (item.kind === 'user') {
      const files = item.attachments?.length ?? 0
      const text = oneLine(item.text) || (files === 1 ? 'Sent a file' : `Sent ${files} files`)
      return item.from ? { who: 'teammate', from: item.from, text, at: item.at } : { who: 'user', text, at: item.at }
    }
  }
  return null
}

export function lastReplyAt(items: readonly ChatItem[]): string | null {
  return items.findLast((i) => i.kind === 'assistant')?.at ?? null
}

function daysBetween(at: Date, now: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((midnight(now) - midnight(at)) / DAY_MS)
}

export function clockTime(at: Date): string {
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// "7:34 PM" today, "Yesterday", the weekday within a week, else "Nov 3".
export function listTime(iso: string, now: Date): string {
  const at = new Date(iso)
  const days = daysBetween(at, now)
  if (days <= 0) return clockTime(at)
  if (days === 1) return 'Yesterday'
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'long' })
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dividerTime(iso: string, now: Date): string {
  const at = new Date(iso)
  const days = daysBetween(at, now)
  if (days <= 0) return clockTime(at)
  const day = listTime(iso, now)
  return days < 7 ? `${day} ${clockTime(at)}` : `${day}, ${clockTime(at)}`
}

export function needsDivider(prevAt: string | null, at: string): boolean {
  return prevAt === null || Date.parse(at) - Date.parse(prevAt) > DIVIDER_GAP_MS
}

export function chatMarkdown(title: string, items: readonly ChatItem[], nameOf: (botId: string) => string): string {
  const blocks = [`# ${title}`]
  for (const item of items) {
    const when = new Date(item.at).toLocaleString('en-US')
    if (item.kind === 'user') {
      const files = (item.attachments ?? []).map((a) => `- ${a.name}`).join('\n')
      blocks.push(`**${item.from ? nameOf(item.from) : 'You'}** · ${when}\n\n${[item.text, files].filter(Boolean).join('\n\n')}`)
    } else if (item.kind === 'assistant') {
      blocks.push(`**${nameOf(item.botId)}** · ${when}\n\n${item.text}`)
    } else if (item.kind === 'approval') {
      blocks.push(`> ${nameOf(item.botId)} asked: ${item.action} (${item.state})`)
    } else if (item.kind === 'question') {
      const answered = item.answers ? Object.entries(item.answers).map(([q, a]) => `> ${q} ${a}`) : []
      blocks.push([`> ${nameOf(item.botId)} asked ${item.questions.map((q) => q.question).join(' ')}`, ...answered].join('\n'))
    } else if (item.kind === 'routine') {
      blocks.push(`---\n\n*Routine: ${item.name}*`)
    } else if (item.kind === 'error') {
      blocks.push(`> Error: ${item.text}`)
    }
  }
  return blocks.join('\n\n') + '\n'
}
