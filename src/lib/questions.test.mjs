import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answersSchema, parseQuestions } from './questions.ts'

const input = {
  questions: [
    {
      question: 'Which library should we use?',
      header: 'Library',
      options: [
        { label: 'date-fns', description: 'Small' },
        { label: 'Luxon', description: 'Zones' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which features do you want?',
      header: 'Features',
      options: [
        { label: 'Dark mode', description: '' },
        { label: 'Export', description: '' },
      ],
      multiSelect: true,
    },
  ],
}
const questions = parseQuestions(input)

test('parses AskUserQuestion input and rejects other shapes', () => {
  assert.equal(questions.length, 2)
  assert.equal(questions[1].multiSelect, true)
  assert.equal(parseQuestions({}), null)
  assert.equal(parseQuestions({ questions: [] }), null)
  assert.equal(parseQuestions({ questions: [{ question: 'x' }] }), null)
})

test('accepts one answer per question, keyed by question text', () => {
  const answers = { 'Which library should we use?': 'Luxon', 'Which features do you want?': 'Dark mode, Export' }
  assert.deepEqual(answersSchema(questions).parse(answers), answers)
})

test('accepts free "Other" text', () => {
  const answers = { 'Which library should we use?': 'Temporal', 'Which features do you want?': 'Export' }
  assert.ok(answersSchema(questions).safeParse(answers).success)
})

test('rejects a missing, empty or unknown answer', () => {
  const schema = answersSchema(questions)
  assert.ok(!schema.safeParse({ 'Which library should we use?': 'Luxon' }).success)
  assert.ok(!schema.safeParse({ 'Which library should we use?': '  ', 'Which features do you want?': 'Export' }).success)
  assert.ok(
    !schema.safeParse({ 'Which library should we use?': 'Luxon', 'Which features do you want?': 'Export', extra: 'x' }).success,
  )
  assert.ok(!schema.safeParse({ 'Which library should we use?': 1, 'Which features do you want?': 'Export' }).success)
})
