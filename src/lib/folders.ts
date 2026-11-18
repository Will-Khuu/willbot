import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

export const MAX_EXTRA_FOLDERS = 20

export const FolderPathSchema = z
  .string()
  .trim()
  .refine((p) => path.isAbsolute(p), { message: 'The folder must be an absolute path.', abort: true })
  .refine((p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true, 'That folder does not exist.')
  .transform((p) => path.resolve(p))

export const ExtraFoldersSchema = z
  .array(FolderPathSchema)
  .max(MAX_EXTRA_FOLDERS, `At most ${MAX_EXTRA_FOLDERS} extra folders.`)
  .transform((folders) => [...new Set(folders)])

// Both paths absolute and already resolved (realpath for symlink safety).
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)
}

export function plansDir(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plans')
}

// The file's text if, after symlinks, it is a file inside dir and under maxBytes.
export function readFileInside(dir: string, file: string, maxBytes: number): string | null {
  try {
    const real = fs.realpathSync(file)
    if (!isInside(fs.realpathSync(dir), real)) return null
    const stat = fs.statSync(real)
    if (!stat.isFile() || stat.size >= maxBytes) return null
    return fs.readFileSync(real, 'utf8')
  } catch {
    return null
  }
}
