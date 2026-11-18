import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DETAIL_MAX, detailInput, detailOutput, truncate } from './detail.ts'

test('short text is kept as is', () => {
  assert.equal(truncate('a\nb'), 'a\nb')
  assert.equal(truncate('x'.repeat(DETAIL_MAX)), 'x'.repeat(DETAIL_MAX))
})

test('long text is cut at a line boundary and marked', () => {
  const line = 'y'.repeat(99)
  const text = Array.from({ length: 100 }, () => line).join('\n')
  const out = truncate(text)
  assert.ok(out.endsWith('\n… (truncated)'))
  const kept = out.slice(0, -'\n… (truncated)'.length)
  assert.ok(kept.length <= DETAIL_MAX)
  assert.ok(kept.split('\n').every((l) => l === line))
  assert.equal(kept.split('\n').length, 40)
})

test('one long line is cut at the limit', () => {
  const out = truncate('z'.repeat(DETAIL_MAX + 10))
  assert.equal(out, `${'z'.repeat(DETAIL_MAX)}\n… (truncated)`)
})

test('summarizes tool input', () => {
  assert.equal(detailInput('Bash', { command: 'npm test', description: 'Run tests' }), '$ npm test')
  assert.equal(
    detailInput('Edit', { file_path: '/a/b.ts', old_string: 'one\ntwo', new_string: 'three' }),
    '/a/b.ts\n- one\n- two\n+ three',
  )
  assert.equal(detailInput('Write', { file_path: '/a/c.md', content: 'hi\nthere' }), '/a/c.md\n+ hi\n+ there')
  assert.equal(detailInput('WebFetch', { url: 'https://example.com', prompt: 'title?' }), 'https://example.com\ntitle?')
  assert.equal(detailInput('mcp__x__y', { q: 1 }), '{\n  "q": 1\n}')
  assert.ok(detailInput('Write', { file_path: '/f', content: 'w\n'.repeat(5000) }).endsWith('… (truncated)'))
})

test('keeps only the text of a tool result', () => {
  assert.equal(detailOutput('done'), 'done')
  assert.equal(
    detailOutput([
      { type: 'text', text: 'line 1' },
      { type: 'image', source: {} },
      { type: 'text', text: 'line 2' },
    ]),
    'line 1\nline 2',
  )
  assert.equal(detailOutput(undefined), '')
})

test('strips terminal color codes from output', () => {
  assert.equal(detailOutput('\u001b[32m✔ passes\u001b[39m'), '✔ passes')
})
