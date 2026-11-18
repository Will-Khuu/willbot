import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BotNameSchema } from './names.ts'

test('ordinary names pass, trimmed', () => {
  assert.equal(BotNameSchema.parse('  Inbox Bot '), 'Inbox Bot')
  assert.equal(BotNameSchema.parse('Dr Egg-2'), 'Dr Egg-2')
})

test('names that osascript would read as options are rejected', () => {
  assert.ok(!BotNameSchema.safeParse('-eon activate\nerror "X"\nend').success)
  assert.ok(!BotNameSchema.safeParse('-x').success)
  assert.ok(!BotNameSchema.safeParse('  -x').success)
})

test('control characters and newlines are rejected', () => {
  for (const name of ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u007fb']) assert.ok(!BotNameSchema.safeParse(name).success, JSON.stringify(name))
})

test('empty and long names are rejected', () => {
  assert.ok(!BotNameSchema.safeParse('   ').success)
  assert.ok(!BotNameSchema.safeParse('x'.repeat(41)).success)
  assert.ok(BotNameSchema.safeParse('x'.repeat(40)).success)
})
