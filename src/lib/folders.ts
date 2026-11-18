import fs from 'node:fs'
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
