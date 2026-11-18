import type { MemoryEntry } from './types'

const LINE = /^- (\d{4}-\d{2}-\d{2}): (.*)$/

export function parseMemory(markdown: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = LINE.exec(line)
    if (m) entries.push({ date: m[1]!, text: m[2]!.trim() })
    else if (line.startsWith('- ')) entries.push({ date: today(), text: line.slice(2).trim() })
  }
  return entries.filter((e) => e.text.length > 0)
}

export function serializeMemory(entries: MemoryEntry[]): string {
  return entries.map((e) => `- ${e.date}: ${oneLine(e.text)}`).join('\n') + (entries.length ? '\n' : '')
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}
