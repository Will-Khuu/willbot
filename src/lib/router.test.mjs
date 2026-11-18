import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aliasOf,
  decideRoute,
  isNewTask,
  loadRoleTables,
  parseClassification,
  parseModelsJson,
  parseRoleTable,
  resolveModel,
  routeLine,
} from './router.ts'

const TABLE_MD = `# pstack model configuration

Per-role model overrides for pstack skills. Delete a line to fall back to the skill default.

feature, refactoring: claude-opus-5
bug-fix: claude-fable-5-1
how explorer: claude-sonnet-5
judgment and prose: inherit-parent
how critics: claude-opus-5, claude-fable-5-1, claude-sonnet-5
`

const MODELS_JSON = JSON.stringify({
  singleRoleDefault: 'claude-opus-5',
  roles: [
    { role: 'feature, refactoring', models: ['claude-opus-5'] },
    { role: 'perf-issue', models: ['claude-fable-5'] },
    { role: 'judgment and prose', models: ['claude-sonnet-5'] },
  ],
})

test('parses role lines and skips prose', () => {
  const table = parseRoleTable(TABLE_MD)
  assert.deepEqual(table.get('feature, refactoring'), ['claude-opus-5'])
  assert.deepEqual(table.get('how critics'), ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5'])
  assert.equal(table.size, 5)
})

test('maps the first slug to an alias, fable to opus', () => {
  assert.equal(aliasOf('claude-opus-5'), 'opus')
  assert.equal(aliasOf('claude-fable-5-1'), 'opus')
  assert.equal(aliasOf('claude-sonnet-5'), 'sonnet')
  assert.equal(aliasOf('claude-haiku-4-5'), 'haiku')
  assert.equal(aliasOf('inherit-parent'), null)
})

test('resolves each kind through its role line', () => {
  const user = parseRoleTable(TABLE_MD)
  assert.deepEqual(resolveModel('feature', user, null), { model: 'opus', slug: 'claude-opus-5' })
  assert.deepEqual(resolveModel('refactoring', user, null), { model: 'opus', slug: 'claude-opus-5' })
  assert.deepEqual(resolveModel('bug-fix', user, null), { model: 'opus', slug: 'claude-fable-5-1' })
  assert.deepEqual(resolveModel('investigation', user, null), { model: 'sonnet', slug: 'claude-sonnet-5' })
  assert.deepEqual(resolveModel('trivial', user, null), { model: 'haiku', slug: null })
})

test('a missing line or unusable value falls back to models.json, then opus', () => {
  const user = parseRoleTable(TABLE_MD)
  const defaults = parseModelsJson(MODELS_JSON)
  assert.deepEqual(resolveModel('perf-issue', user, defaults), { model: 'opus', slug: 'claude-fable-5' })
  assert.deepEqual(resolveModel('judgment', user, defaults), { model: 'sonnet', slug: 'claude-sonnet-5' })
  assert.deepEqual(resolveModel('investigation', null, defaults), { model: 'opus', slug: null })
  assert.deepEqual(resolveModel('bug-fix', null, null), { model: 'opus', slug: null })
  assert.equal(parseModelsJson('not json').size, 0)
})

test('reads the user table and the enabled pstack models.json', () => {
  const files = new Map([
    ['/c/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'pstack@old': [{ installPath: '/old' }], 'pstack@x': [{ installPath: '/p/9.9.9' }] } })],
    ['/c/settings.json', JSON.stringify({ enabledPlugins: { 'pstack@x': true } })],
    ['/p/9.9.9/models.json', MODELS_JSON],
  ])
  const read = (f) => files.get(f) ?? null
  let tables = loadRoleTables(read, '/c')
  assert.equal(tables.user, null)
  assert.equal(resolveModel('judgment', tables.user, tables.defaults).model, 'sonnet')
  files.set('/c/pstack-models.md', TABLE_MD)
  tables = loadRoleTables(read, '/c')
  assert.equal(resolveModel('investigation', tables.user, tables.defaults).model, 'sonnet')
  assert.deepEqual(loadRoleTables(() => null, '/c'), { user: null, defaults: null })
})

const route = (kind, model, slug = null) => ({ by: 'router', classification: { kind, reason: 'why' }, resolved: { model, slug } })

test('upgrades any time', () => {
  const r = decideRoute('haiku', route('feature', 'opus'), false)
  assert.deepEqual(r, { taskKind: 'feature', model: 'opus', reason: 'why', changed: true })
})

test('does not downgrade mid-task', () => {
  const r = decideRoute('opus', route('trivial', 'haiku'), false)
  assert.deepEqual(r, { taskKind: 'trivial', model: 'opus', reason: 'mid-task, no downgrade', changed: false })
  assert.equal(routeLine(r), 'Kept Opus · trivial: mid-task, no downgrade')
})

test('downgrades when a new task starts', () => {
  const now = Date.parse('2026-11-18T12:00:00Z')
  assert.ok(isNewTask(null, now))
  assert.ok(isNewTask('2026-11-18T11:29:00Z', now))
  assert.ok(!isNewTask('2026-11-18T11:45:00Z', now))
  const r = decideRoute('opus', route('trivial', 'haiku'), isNewTask('2026-11-18T11:00:00Z', now))
  assert.equal(r.model, 'haiku')
  assert.ok(r.changed)
})

test('a manual pick always wins, even downward mid-task', () => {
  const r = decideRoute('opus', { by: 'pick', model: 'haiku' }, false)
  assert.deepEqual(r, { taskKind: null, model: 'haiku', reason: 'You picked this model', changed: true })
  assert.equal(routeLine(r), 'Haiku · You picked this model')
})

test('fable in the table runs on opus and says why', () => {
  const r = decideRoute(null, route('bug-fix', 'opus', 'claude-fable-5-1'), true)
  assert.equal(r.model, 'opus')
  assert.match(r.reason, /bug-fix → Fable in your table, using Opus \(Fable needs credits\)/)
})

test('an unavailable router keeps the current model', () => {
  assert.deepEqual(decideRoute('sonnet', { by: 'unavailable' }, true), {
    taskKind: null,
    model: 'sonnet',
    reason: 'Router unavailable, kept Sonnet',
    changed: false,
  })
  assert.equal(routeLine(decideRoute('sonnet', { by: 'unavailable' }, true)), 'Sonnet · Router unavailable, kept Sonnet')
  assert.equal(decideRoute(null, { by: 'unavailable' }, true).model, 'opus')
})

test('parses classifier output and rejects bad output', () => {
  assert.deepEqual(parseClassification({ kind: 'feature', reason: 'add a settings page' }), {
    kind: 'feature',
    reason: 'add a settings page',
  })
  assert.equal(parseClassification({ kind: 'feature', reason: 'x'.repeat(200) }).reason.length, 80)
  assert.equal(parseClassification({ kind: 'epic', reason: 'x' }), null)
  assert.equal(parseClassification({ reason: 'x' }), null)
  assert.equal(parseClassification(undefined), null)
  assert.equal(parseClassification('feature'), null)
})
