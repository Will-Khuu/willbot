import { useEffect, useRef } from 'react'

const RESTORE = 'will-bot:refit-chat'
const LAST = 'will-bot:refit-at'
// An installed-app window's title bar is about 30px; anything past this means the page is smaller than its window.
const SLACK_PX = 100
const MIN_GAP_MS = 60_000

// Chrome sometimes keeps an installed will-bot window's old page size after the
// window moves between displays or is resized, so the app fills only part of
// the window until a reload. Nothing in the page can draw past that size.
function stale(): boolean {
  return matchMedia('(display-mode: standalone)').matches && outerHeight - innerHeight > SLACK_PX
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {}
}

// Reloads a stale window when you come back to it, unless you are mid-message,
// and reopens the chat you had open.
export function useRefit(selectedId: string, reopen: (id: string) => void): void {
  const selected = useRef(selectedId)
  selected.current = selectedId
  const reopenRef = useRef(reopen)
  reopenRef.current = reopen

  useEffect(() => {
    const id = read(RESTORE)
    write(RESTORE, null)
    if (id) reopenRef.current(id)

    const check = () => {
      if (document.hidden || !stale()) return
      if (document.querySelector('textarea')?.value.trim()) return
      // A window that is still short after a reload is not stale, so do not loop.
      if (Date.now() - Number(read(LAST) ?? 0) < MIN_GAP_MS) return
      write(LAST, String(Date.now()))
      write(RESTORE, selected.current)
      location.reload()
    }
    check()
    window.addEventListener('focus', check)
    window.addEventListener('resize', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      window.removeEventListener('resize', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
}
