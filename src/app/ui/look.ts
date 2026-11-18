// Eight hues dark enough for white initials at 4.5:1.
export const AVATAR_HUES = ['#7c3aed', '#2563eb', '#15803d', '#c2410c', '#db2777', '#0f766e', '#dc2626', '#4f46e5'] as const

const FIXED_HUES: Record<string, string> = { chief: AVATAR_HUES[0], research: AVATAR_HUES[1], builder: AVATAR_HUES[2] }

export function hueOf(id: string): string {
  const fixed = FIXED_HUES[id]
  if (fixed) return fixed
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_HUES[h % AVATAR_HUES.length]!
}

// "Chief of Staff" → "CS", "Research Bot" → "R", "Dr Egg" → "DE".
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(of|the|bot)$/i.test(w))
  if (words.length === 0) return name.slice(0, 1).toUpperCase()
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]![0]!).toUpperCase()
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function agoOf(iso: string, now: number): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
