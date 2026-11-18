import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ExtraFoldersSchema, FolderPathSchema, isInside, plansDir, readFileInside } from './folders.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-folders-'))
const a = path.join(tmp, 'a')
const b = path.join(tmp, 'b')
fs.mkdirSync(a)
fs.mkdirSync(b)
fs.writeFileSync(path.join(tmp, 'file.txt'), 'x')

test('extra folders must be absolute, existing folders', () => {
  assert.deepEqual(ExtraFoldersSchema.parse([a, ` ${b}/ `]), [a, b])
  assert.deepEqual(ExtraFoldersSchema.parse([]), [])
  assert.ok(!ExtraFoldersSchema.safeParse(['relative/dir']).success)
  assert.ok(!ExtraFoldersSchema.safeParse([path.join(tmp, 'missing')]).success)
  assert.ok(!ExtraFoldersSchema.safeParse([path.join(tmp, 'file.txt')]).success)
  assert.ok(!ExtraFoldersSchema.safeParse('not-an-array').success)
})

test('extra folders are resolved and deduplicated, up to 20', () => {
  assert.deepEqual(ExtraFoldersSchema.parse([a, path.join(a, '..', 'a'), a]), [a])
  assert.ok(!ExtraFoldersSchema.safeParse(Array.from({ length: 21 }, () => a)).success)
})

test('the working folder uses the same rule', () => {
  assert.equal(FolderPathSchema.parse(`${a}/`), a)
  assert.ok(!FolderPathSchema.safeParse('~/x').success)
})

test('isInside accepts only strict descendants', () => {
  assert.ok(isInside('/w/att', '/w/att/x.png'))
  assert.ok(isInside('/w/att', '/w/att/sub/x.png'))
  assert.ok(!isInside('/w/att', '/w/att'))
  assert.ok(!isInside('/w/att', '/w/att/../secret'))
  assert.ok(!isInside('/w/att', '/w/attic/x.png'))
  assert.ok(!isInside('/w/att', '/etc/passwd'))
  assert.ok(isInside('/w/att', '/w/att/..x.png'))
})

test('a relative path gets one message', () => {
  const r = ExtraFoldersSchema.safeParse(['rel/dir'])
  assert.deepEqual(r.error.issues.map((i) => i.message), ['The folder must be an absolute path.'])
})

test('a plan file is read only from inside the plans folder, and only when small', () => {
  const plans = path.join(tmp, 'plans')
  fs.mkdirSync(plans)
  fs.writeFileSync(path.join(plans, 'p.md'), '# plan')
  fs.writeFileSync(path.join(plans, 'big.md'), 'x'.repeat(300))
  fs.writeFileSync(path.join(tmp, 'secret'), 'nope')
  fs.symlinkSync(path.join(tmp, 'secret'), path.join(plans, 'link.md'))
  assert.equal(readFileInside(plans, path.join(plans, 'p.md'), 200), '# plan')
  assert.equal(readFileInside(plans, path.join(plans, 'big.md'), 200), null)
  assert.equal(readFileInside(plans, path.join(tmp, 'secret'), 200), null)
  assert.equal(readFileInside(plans, path.join(plans, '..', 'secret'), 200), null)
  assert.equal(readFileInside(plans, path.join(plans, 'link.md'), 200), null)
  assert.equal(readFileInside(plans, plans, 200), null)
  assert.equal(readFileInside(plans, path.join(plans, 'missing.md'), 200), null)
})

test('the plans folder follows CLAUDE_CONFIG_DIR', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = '/cfg'
  assert.equal(plansDir(), '/cfg/plans')
  delete process.env.CLAUDE_CONFIG_DIR
  assert.equal(plansDir(), path.join(os.homedir(), '.claude', 'plans'))
  if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved
})
