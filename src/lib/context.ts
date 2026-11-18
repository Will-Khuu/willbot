import { z } from 'zod'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 10
const OWN_DIR = '.will-bot'
// Relative to the employee's working folder.
export const ATTACHMENTS_DIR = `${OWN_DIR}/attachments`

const MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
}

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

export function mimeOf(name: string): string {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  return MIMES[ext] ?? 'application/octet-stream'
}

export function isImageMime(mime: string): mime is ImageMime {
  return (IMAGE_MIMES as readonly string[]).includes(mime)
}

// size is absent on attachments sent before it was recorded.
export const AttachmentSchema = z.object({ name: z.string(), path: z.string(), mime: z.string(), size: z.number().optional() })
export type Attachment = z.infer<typeof AttachmentSchema>
// What an upload returns. The id is the file's name in the attachments folder.
export type Upload = Attachment & { id: string; size: number }

const MAX_NAME = 80

// A file name safe on any filesystem and in a URL: no separators, no leading
// dots, only [A-Za-z0-9._-], at most 80 characters with the extension kept.
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+(\.|$)/g, '$1')
  if (!cleaned || /^\.*$/.test(cleaned)) return 'file'
  if (cleaned.length <= MAX_NAME) return cleaned
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? ''
  return cleaned.slice(0, MAX_NAME - ext.length) + ext
}

const pad = (n: number) => String(n).padStart(2, '0')

// <yyyymmdd-hhmmss>-<safe name>, in local time. A non-zero n disambiguates
// two uploads of the same name in the same second.
export function attachmentId(at: Date, name: string, n = 0): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${stamp}-${n ? `${n}-` : ''}${safeName(name)}`
}

const ID = /^\d{8}-\d{6}-(?:\d+-)?(.+)$/

export function isAttachmentId(id: string): boolean {
  const m = ID.exec(id)
  return m !== null && safeName(m[1]!) === m[1]
}

// The name the user sees: the safe name without the time stamp.
export function attachmentName(id: string): string {
  return ID.exec(id)?.[1] ?? id
}

// The text block of a user message. Claude Code reads each attached file by
// path; images also go in as image blocks.
export function promptText(text: string, attachments: readonly Attachment[]): string {
  const lines = attachments.map((a) => `Attached file: ${a.path}`)
  return [text, lines.join('\n')].filter(Boolean).join('\n\n')
}

export const MAX_WALK = 5000
export const MAX_HITS = 20

// A file found under one of the employee's folders. rel uses '/' separators.
export type FileHit = { path: string; rel: string; root: string }

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build'])

// rel is a folder path relative to a root, '/'-separated. Dot-folders are
// skipped, except the way down to will-bot's own attachments folder.
export function skipDir(rel: string): boolean {
  if (rel === OWN_DIR || rel === ATTACHMENTS_DIR || rel.startsWith(`${ATTACHMENTS_DIR}/`)) return false
  if (rel.startsWith(`${OWN_DIR}/`)) return true
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return SKIP.has(name) || name.startsWith('.')
}

// Higher is better; null means no match. Name matches beat path matches,
// which beat a scattered subsequence; shorter paths break ties.
export function fuzzyScore(query: string, rel: string): number | null {
  const q = query.toLowerCase()
  const r = rel.toLowerCase()
  const name = r.slice(r.lastIndexOf('/') + 1)
  let score: number
  if (!q) score = 0
  else if (name.startsWith(q)) score = 300
  else if (name.includes(q)) score = 200
  else if (r.includes(q)) score = 100
  else {
    let at = -1
    let gaps = 0
    for (const ch of q) {
      const next = r.indexOf(ch, at + 1)
      if (next < 0) return null
      if (at >= 0 && next > at + 1) gaps++
      at = next
    }
    score = 50 - gaps
  }
  return score - r.length / 1000
}

export function rankFiles<T extends { rel: string }>(files: readonly T[], query: string, limit = MAX_HITS): T[] {
  return files
    .flatMap((f) => {
      const score = fuzzyScore(query, f.rel)
      return score === null ? [] : [{ f, score }]
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f)
}

// The @-token the caret is in, if any: '@' at the start or after whitespace,
// then no whitespace up to the caret.
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@(\S*)$/.exec(before)
  if (!m) return null
  return { start: caret - m[2]!.length - 1, query: m[2]! }
}

// Claude Code reads a path with spaces when it is quoted.
export function mentionToken(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

export function insertMention(text: string, start: number, caret: number, path: string): { text: string; caret: number } {
  const token = `${mentionToken(path)} `
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length }
}
