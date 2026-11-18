import fs from 'node:fs'
import path from 'node:path'
import {
  ATTACHMENTS_DIR,
  attachmentId,
  attachmentName,
  isAttachmentId,
  isImageMime,
  MAX_WALK,
  mimeOf,
  rankFiles,
  skipDir,
  type Attachment,
  type FileHit,
  type ImageMime,
  type Upload,
} from './context'
import { isInside } from './folders'
import { ensureFolder } from './store'
import type { Bot } from './types'

function attachmentsDir(bot: Bot): string {
  return path.join(ensureFolder(bot), ATTACHMENTS_DIR)
}

export function saveAttachment(bot: Bot, name: string, data: Buffer): Upload {
  const dir = attachmentsDir(bot)
  fs.mkdirSync(dir, { recursive: true })
  const at = new Date()
  for (let n = 0; ; n++) {
    const id = attachmentId(at, name, n)
    const file = path.join(dir, id)
    try {
      fs.writeFileSync(file, data, { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw e
    }
    return { id, name: attachmentName(id), path: file, mime: mimeOf(id), size: data.length }
  }
}

// The attachments named by upload ids, or the reason one cannot be sent.
export function findAttachments(bot: Bot, ids: readonly string[]): Attachment[] | string {
  const dir = attachmentsDir(bot)
  const found: Attachment[] = []
  for (const id of ids) {
    const file = path.join(dir, id)
    const stat = isAttachmentId(id) ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
    if (stat?.isFile() !== true) return `The attachment ${attachmentName(id)} is gone. Attach it again.`
    found.push({ name: attachmentName(id), path: file, mime: mimeOf(id), size: stat.size })
  }
  return found
}

// An image inside the employee's attachments folder, after resolving symlinks.
export function attachmentImage(bot: Bot, file: string): { path: string; mime: ImageMime } | null {
  try {
    const dir = fs.realpathSync(attachmentsDir(bot))
    const real = fs.realpathSync(file)
    const mime = mimeOf(real)
    if (!isInside(dir, real) || !isImageMime(mime) || !fs.statSync(real).isFile()) return null
    return { path: real, mime }
  } catch {
    return null
  }
}

// The working folder first, then the extra folders that still exist.
export function botFolders(bot: Bot): [string, ...string[]] {
  const cwd = ensureFolder(bot)
  const extra = bot.extraFolders.flatMap((f) => {
    try {
      return [fs.realpathSync(f)]
    } catch {
      return []
    }
  })
  return [cwd, ...new Set(extra.filter((f) => f !== cwd))]
}

// Breadth-first over every root at once, so shallow files are found before
// the walk budget runs out in one deep tree.
export function searchFiles(bot: Bot, query: string): FileHit[] {
  const queue = botFolders(bot).map((root) => ({ root, rel: '' }))
  const files: FileHit[] = []
  const seen = new Set<string>()
  let walked = 0
  while (queue.length && walked < MAX_WALK) {
    const { root, rel } = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (++walked > MAX_WALK) break
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!skipDir(childRel)) queue.push({ root, rel: childRel })
      } else if (entry.isFile()) {
        const file = path.join(root, childRel)
        if (seen.has(file)) continue
        seen.add(file)
        files.push({ path: file, rel: childRel, root })
      }
    }
  }
  return rankFiles(files, query)
}

// The newest PNG the Playwright MCP server wrote for this employee.
export function latestScreenshot(bot: Bot): string | null {
  try {
    const dir = fs.realpathSync(path.join(ensureFolder(bot), '.playwright'))
    let best: { file: string; at: number } | null = null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue
      const file = fs.realpathSync(path.join(dir, entry.name))
      if (!isInside(dir, file)) continue
      const at = fs.statSync(file).mtimeMs
      if (!best || at > best.at) best = { file, at }
    }
    return best?.file ?? null
  } catch {
    return null
  }
}

export type RecentFile = { rel: string; modifiedAt: string }

// The most recently changed files in the working folder, skipping
// node_modules and every dot-folder (.git included).
export function recentFiles(bot: Bot, count: number): { folder: string; files: RecentFile[] } {
  const root = ensureFolder(bot)
  const found: { rel: string; at: number }[] = []
  const queue = ['']
  let walked = 0
  while (queue.length && walked < MAX_WALK) {
    const rel = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (++walked > MAX_WALK || entry.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') queue.push(childRel)
      } else if (entry.isFile()) {
        const at = fs.statSync(path.join(root, childRel), { throwIfNoEntry: false })?.mtimeMs
        if (at !== undefined) found.push({ rel: childRel, at })
      }
    }
  }
  const files = found
    .toSorted((a, b) => b.at - a.at)
    .slice(0, count)
    .map((f) => ({ rel: f.rel, modifiedAt: new Date(f.at).toISOString() }))
  return { folder: root, files }
}
