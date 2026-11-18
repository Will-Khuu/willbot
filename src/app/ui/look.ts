import type { BotStatus } from '@/lib/types'

const TINTS: Record<string, string> = { chief: '#e9c9b3', research: '#cfdcea', builder: '#cde3d2' }
const EXTRA_TINTS = ['#f0dca8', '#e3d3ea', '#d6e4e0', '#ecd5cf', '#dcdcef']

export function tintOf(id: string): string {
  const fixed = TINTS[id]
  if (fixed) return fixed
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return EXTRA_TINTS[h % EXTRA_TINTS.length]!
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => !/^of$/i.test(w))
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase()
}

export const DOT: Record<BotStatus, string> = {
  working: '#3f8f5b',
  needs_approval: '#c2781a',
  idle: '#9a968a',
  paused: '#1c1b19',
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
