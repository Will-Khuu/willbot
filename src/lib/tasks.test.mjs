import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyTaskCall, parseTaskCall, taskCounts } from './tasks.ts'

const run = (steps) => steps.reduce((list, [name, input, result]) => applyTaskCall(list, parseTaskCall(name, input), result), [])

test('TodoWrite replaces the whole list', () => {
  const list = run([
    ['TodoWrite', { todos: [{ content: 'Read the code', status: 'completed', activeForm: 'Reading the code' }] }],
    [
      'TodoWrite',
      {
        todos: [
          { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
          { content: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
          { content: 'Run tests', status: 'pending', activeForm: 'Running tests' },
        ],
      },
    ],
  ])
  assert.deepEqual(
    list.map((t) => [t.content, t.status]),
    [
      ['Read the code', 'completed'],
      ['Write the fix', 'in_progress'],
      ['Run tests', 'pending'],
    ],
  )
  assert.equal(list[1].activeForm, 'Writing the fix')
  assert.deepEqual(taskCounts(list), { done: 1, total: 3 })
})

test('TaskCreate takes its id from the result; TaskUpdate patches and deletes by id', () => {
  const list = run([
    ['TaskCreate', { subject: 'Add the route', description: 'x', activeForm: 'Adding the route' }, { task: { id: '1', subject: 'Add the route' } }],
    ['TaskCreate', { subject: 'Write tests', description: 'y' }, { task: { id: '2', subject: 'Write tests' } }],
    ['TaskCreate', { subject: 'Scratch', description: 'z' }, { task: { id: '3', subject: 'Scratch' } }],
    ['TaskUpdate', { taskId: '1', status: 'in_progress' }],
    ['TaskUpdate', { taskId: '2', subject: 'Write the tests' }],
    ['TaskUpdate', { taskId: '3', status: 'deleted' }],
    ['TaskUpdate', { taskId: '1', status: 'completed' }],
  ])
  assert.deepEqual(list, [
    { taskId: '1', content: 'Add the route', status: 'completed', activeForm: 'Adding the route' },
    { taskId: '2', content: 'Write the tests', status: 'pending' },
  ])
})

test('TaskList resyncs from its result and keeps known activeForms', () => {
  const list = run([
    ['TaskCreate', { subject: 'A', description: '', activeForm: 'Doing A' }, { task: { id: '1', subject: 'A' } }],
    [
      'TaskList',
      {},
      {
        tasks: [
          { id: '1', subject: 'A', status: 'in_progress', blockedBy: [] },
          { id: '4', subject: 'B', status: 'pending', blockedBy: [] },
        ],
      },
    ],
  ])
  assert.deepEqual(list, [
    { taskId: '1', content: 'A', status: 'in_progress', activeForm: 'Doing A' },
    { taskId: '4', content: 'B', status: 'pending' },
  ])
})

test('rejects other tools and malformed input', () => {
  assert.equal(parseTaskCall('Bash', { command: 'ls' }), null)
  assert.equal(parseTaskCall('TodoWrite', { todos: [{ content: 'x', status: 'blocked' }] }), null)
  assert.equal(parseTaskCall('TaskUpdate', { status: 'completed' }), null)
  const list = run([['TaskCreate', { subject: 'A', description: '' }, 'Task #1 created']])
  assert.deepEqual(list, [{ content: 'A', status: 'pending' }])
})
