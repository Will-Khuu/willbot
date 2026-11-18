import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attachmentId,
  attachmentName,
  fuzzyScore,
  insertMention,
  isAttachmentId,
  mentionAt,
  mimeOf,
  promptText,
  rankFiles,
  safeName,
  skipDir,
} from './context.ts'

test('safeName keeps only a plain basename', () => {
  assert.equal(safeName('Screen Shot 2026-11-18 at 9.41.02 AM.png'), 'Screen-Shot-2026-11-18-at-9.41.02-AM.png')
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('C:\\Users\\me\\report.pdf'), 'report.pdf')
  assert.equal(safeName('.env'), 'env')
  assert.equal(safeName('..'), 'file')
  assert.equal(safeName(''), 'file')
  assert.equal(safeName('???'), 'file')
  assert.equal(safeName('café résumé.txt'), 'cafe-resume.txt')
  assert.equal(safeName('a<>:"|?*b.txt'), 'a-b.txt')
})

test('safeName caps the length and keeps the extension', () => {
  const name = safeName(`${'x'.repeat(200)}.jpeg`)
  assert.equal(name.length, 80)
  assert.ok(name.endsWith('.jpeg'))
})

test('attachment ids are stamped safe names, and only those pass the check', () => {
  const at = new Date(2026, 10, 18, 9, 5, 7)
  assert.equal(attachmentId(at, 'my photo.png'), '20261118-090507-my-photo.png')
  assert.equal(attachmentId(at, 'my photo.png', 2), '20261118-090507-2-my-photo.png')
  assert.equal(attachmentName('20261118-090507-2-my-photo.png'), 'my-photo.png')
  assert.ok(isAttachmentId('20261118-090507-my-photo.png'))
  assert.ok(isAttachmentId('20261118-090507-3-a.pdf'))
  for (const bad of ['../20261118-090507-a.png', '20261118-090507-../x', '20261118-090507-a/b.png', 'a.png', '20261118-090507-.env', '20261118-090507-']) {
    assert.ok(!isAttachmentId(bad), bad)
  }
})

test('mimeOf maps extensions, case-insensitively', () => {
  assert.equal(mimeOf('a.PNG'), 'image/png')
  assert.equal(mimeOf('a.jpg'), 'image/jpeg')
  assert.equal(mimeOf('a.svg'), 'application/octet-stream')
  assert.equal(mimeOf('noext'), 'application/octet-stream')
})

test('promptText adds one Attached file line per attachment', () => {
  const a = [{ name: 'a.png', path: '/w/.will-bot/attachments/a.png', mime: 'image/png' }]
  assert.equal(promptText('hi', a), 'hi\n\nAttached file: /w/.will-bot/attachments/a.png')
  assert.equal(promptText('', a), 'Attached file: /w/.will-bot/attachments/a.png')
  assert.equal(promptText('hi', []), 'hi')
})

test('skipDir skips build output and dot-folders, but not the attachments folder', () => {
  for (const rel of ['node_modules', 'a/node_modules', '.git', '.next', 'dist', 'pkg/build', '.cache', 'a/.venv', '.will-bot/other', '.will-bot/other/x']) {
    assert.ok(skipDir(rel), rel)
  }
  for (const rel of ['src', 'src/app', '.will-bot', '.will-bot/attachments', '.will-bot/attachments/sub', 'builds', 'distro']) {
    assert.ok(!skipDir(rel), rel)
  }
})

test('fuzzyScore ranks name prefix > name substring > path substring > subsequence', () => {
  const prefix = fuzzyScore('chat', 'src/ChatPane.tsx')
  const inName = fuzzyScore('pane', 'src/ChatPane.tsx')
  const inPath = fuzzyScore('app/ui', 'src/app/ui/Details.tsx')
  const scattered = fuzzyScore('cpt', 'src/ChatPane.tsx')
  assert.ok(prefix > inName && inName > inPath && inPath > scattered)
  assert.equal(fuzzyScore('zzz', 'src/ChatPane.tsx'), null)
  assert.equal(fuzzyScore('tpc', 'src/ChatPane.tsx'), null)
  assert.ok(fuzzyScore('', 'a') > fuzzyScore('', 'a/b/c'))
})

test('rankFiles filters, sorts and caps', () => {
  const files = ['README.md', 'src/readme-notes.txt', 'docs/guide/read.md', 'src/app.ts'].map((rel) => ({ rel }))
  assert.deepEqual(rankFiles(files, 'read').map((f) => f.rel), ['README.md', 'docs/guide/read.md', 'src/readme-notes.txt'])
  assert.equal(rankFiles(files, '', 2).length, 2)
  const many = Array.from({ length: 50 }, (_, i) => ({ rel: `f${i}.ts` }))
  assert.equal(rankFiles(many, 'f').length, 20)
})

test('mentionAt finds the @-token at the caret', () => {
  assert.deepEqual(mentionAt('look at @src/ap', 15), { start: 8, query: 'src/ap' })
  assert.deepEqual(mentionAt('@', 1), { start: 0, query: '' })
  assert.equal(mentionAt('mail me@example.com', 19), null)
  assert.equal(mentionAt('@done now', 9), null)
  assert.deepEqual(mentionAt('a @x b', 4), { start: 2, query: 'x' })
})

test('insertMention replaces the token and quotes paths with spaces', () => {
  assert.deepEqual(insertMention('see @ap now', 4, 7, '/w/app.ts'), { text: 'see @/w/app.ts  now', caret: 15 })
  assert.equal(insertMention('@x', 0, 2, '/My Files/a.txt').text, '@"/My Files/a.txt" ')
})
