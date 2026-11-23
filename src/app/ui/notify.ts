import { useEffect, useRef } from 'react'
import type { BotView } from '@/lib/types'

type Seen = { reply: string | null; waiting: boolean }

function away(): boolean {
  return document.hidden || !document.hasFocus()
}

// Browsers only show the permission prompt after a click, so ask on the first one.
function askOnFirstClick(): () => void {
  if (!('Notification' in window) || Notification.permission !== 'default') return () => {}
  const ask = () => void Notification.requestPermission().catch(() => {})
  window.addEventListener('pointerdown', ask, { once: true })
  return () => window.removeEventListener('pointerdown', ask)
}

// A desktop notification when an employee replies or needs your answer while
// will-bot is in a background tab or another window. Clicking it opens that chat.
export function useNotifications(bots: BotView[], onOpen: (id: string) => void): void {
  const seen = useRef<Map<string, Seen> | null>(null)
  const open = useRef(onOpen)
  open.current = onOpen

  useEffect(askOnFirstClick, [])

  useEffect(() => {
    if (bots.length === 0) return
    const before = seen.current
    seen.current = new Map(bots.map((b) => [b.id, { reply: b.lastReplyAt, waiting: b.status === 'needs_approval' }]))
    // The first list is only a baseline: nothing in it is news.
    if (!before || !('Notification' in window) || Notification.permission !== 'granted' || !away()) return
    for (const b of bots) {
      const was = before.get(b.id)
      if (!was) continue
      let body: string | null = null
      if (b.status === 'needs_approval' && !was.waiting) body = 'Needs your answer'
      else if (b.lastReplyAt && b.lastReplyAt !== was.reply && b.last?.who === 'assistant') body = b.last.text
      if (!body) continue
      const note = new Notification(b.name, { body: body.slice(0, 200), tag: `will-bot:${b.id}`, icon: '/icon-192.png' })
      note.onclick = () => {
        window.focus()
        open.current(b.id)
        note.close()
      }
    }
  }, [bots])
}
