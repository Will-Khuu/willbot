import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatMarkdown, dividerTime, lastLine, lastReplyAt, listTime, needsDivider } from './chatlog.ts'

const at = (h, m, day = 18) => new Date(2026, 10, day, h, m).toISOString()
const now = new Date(2026, 10, 18, 21, 0)

test('listTime reads like a messages app', () => {
  assert.equal(listTime(at(19, 34), now), '7:34 PM')
  assert.equal(listTime(at(9, 0, 17), now), 'Yesterday')
  assert.equal(listTime(at(9, 0, 17 - 1), now), 'Monday')
  assert.equal(listTime(at(9, 0, 3), now), 'Nov 3')
  assert.equal(dividerTime(at(9, 41), now), '9:41 AM')
  assert.equal(dividerTime(at(9, 41, 17), now), 'Yesterday 9:41 AM')
})

test('a divider goes before the first message and after a 30 minute gap', () => {
  assert.equal(needsDivider(null, at(9, 0)), true)
  assert.equal(needsDivider(at(9, 0), at(9, 30)), false)
  assert.equal(needsDivider(at(9, 0), at(9, 31)), true)
})

test('lastLine takes the last user or assistant text and skips cards', () => {
  const items = [
    { kind: 'user', id: 'u', text: 'hi\nthere', at: at(9, 0) },
    { kind: 'assistant', id: 'a', botId: 'chief', text: '  Done.  ', at: at(9, 1) },
    { kind: 'activity', id: 'x', botId: 'chief', label: 'Read file', at: at(9, 2) },
  ]
  assert.deepEqual(lastLine(items), { who: 'assistant', text: 'Done.', at: at(9, 1) })
  assert.equal(lastReplyAt(items), at(9, 1))
  assert.deepEqual(lastLine([{ kind: 'user', id: 'u', text: '', attachments: [{ name: 'a', path: '/a', mime: 'x' }], at: at(9, 0) }]), {
    who: 'user',
    text: 'Sent a file',
    at: at(9, 0),
  })
  assert.equal(lastLine([]), null)
  assert.equal(lastLine([{ kind: 'assistant', id: 'a', botId: 'c', text: 'See **[the blog](https://x.y)** and `2015`.', at: at(9, 0) }]).text, 'See the blog and 2015.')
})

test('chatMarkdown names who said what', () => {
  const md = chatMarkdown('Chief', [
    { kind: 'user', id: 'u', text: 'hi', at: at(9, 0) },
    { kind: 'assistant', id: 'a', botId: 'chief', text: 'hello', at: at(9, 1) },
  ], () => 'Chief of Staff')
  assert.match(md, /^# Chief\n/)
  assert.match(md, /\*\*You\*\* · .*\n\nhi/)
  assert.match(md, /\*\*Chief of Staff\*\* · .*\n\nhello/)
})

test('a teammate message names its sender, not you', () => {
  const items = [{ kind: 'user', id: 'u', text: 'Can you check the build?', from: 'builder', at: at(9, 0) }]
  assert.deepEqual(lastLine(items), { who: 'teammate', from: 'builder', text: 'Can you check the build?', at: at(9, 0) })
  const md = chatMarkdown('Research', items, (id) => (id === 'builder' ? 'Builder Bot' : id))
  assert.match(md, /\*\*Builder Bot\*\* · .*\n\nCan you check the build\?/)
  assert.doesNotMatch(md, /\*\*You\*\*/)
})
