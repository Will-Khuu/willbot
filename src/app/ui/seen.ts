import { useEffect, useState } from 'react'
import type { BotView } from '@/lib/types'

const KEY = 'will-bot:last-seen'

type Seen = Record<string, string>

function load(): Seen {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Seen) : {}
  } catch {
    return {}
  }
}

function save(seen: Seen): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {}
}

// The last reply time you saw per employee. An employee seen for the first
// time starts as read, so a fresh browser does not light every row.
export function useUnread(bots: BotView[], viewingId: string | null): (bot: BotView) => boolean {
  const [seen, setSeen] = useState<Seen | null>(null)

  useEffect(() => setSeen(load()), [])

  useEffect(() => {
    if (!seen || bots.length === 0) return
    let next = seen
    for (const b of bots) {
      const reply = b.lastReplyAt ?? ''
      const stale = b.id === viewingId ? reply > (seen[b.id] ?? '') : !(b.id in seen)
      if (stale) next = { ...next, [b.id]: reply }
    }
    if (next === seen) return
    setSeen(next)
    save(next)
  }, [bots, viewingId, seen])

  return (b) => seen !== null && b.id !== viewingId && b.id in seen && (b.lastReplyAt ?? '') > seen[b.id]!
}
