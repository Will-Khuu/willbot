import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkPath, classifyTool, isEnvFile, isSecret } from './policy.ts'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'willbot-policy-')))
const ws = path.join(tmp, 'ws')
const outside = path.join(tmp, 'outside')
fs.mkdirSync(path.join(ws, 'sub'), { recursive: true })
fs.mkdirSync(outside)
fs.writeFileSync(path.join(ws, 'notes.md'), 'hi')
fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope')
fs.symlinkSync(outside, path.join(ws, 'escape-dir'))
fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(ws, 'escape-file'))
fs.symlinkSync(path.join(outside, 'missing.txt'), path.join(ws, 'dangling'))
fs.symlinkSync(path.join(ws, 'notes.md'), path.join(ws, 'inner-link'))
fs.writeFileSync(path.join(ws, '.env.local'), 'KEY=1')
fs.symlinkSync(path.join(ws, '.env.local'), path.join(ws, 'config'))

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${e.message}`)
  }
}
const ok = (p) => checkPath(p, ws)
const allowed = (p) => assert.equal(ok(p).ok, true, `${p} should be allowed: ${ok(p).reason}`)
const rejected = (p) => assert.equal(ok(p).ok, false, `${p} should be rejected`)

check('relative file inside', () => {
  allowed('notes.md')
  assert.equal(ok('notes.md').path, path.join(ws, 'notes.md'))
})
check('new file in new subfolder', () => allowed('sub/deeper/brief.md'))
check('absolute path inside', () => allowed(path.join(ws, 'notes.md')))
check('workspace root itself', () => allowed('.'))
check('symlink that stays inside', () => assert.equal(ok('inner-link').path, path.join(ws, 'notes.md')))
check('dot-dot escape', () => rejected('../outside/secret.txt'))
check('dot-dot that lands back inside is still rejected', () => rejected('sub/../notes.md'))
check('absolute path outside', () => rejected('/etc/passwd'))
check('absolute sibling with workspace-name prefix', () => rejected(`${ws}-evil/x.txt`))
check('symlinked dir out', () => rejected('escape-dir/secret.txt'))
check('symlinked file out', () => rejected('escape-file'))
check('new file under a symlinked dir out', () => rejected('escape-dir/new.txt'))
check('dangling symlink', () => rejected('dangling'))
check('.env', () => rejected('.env'))
check('.env.local', () => rejected('.env.local'))
check('nested .env.production', () => rejected('sub/.env.production'))
check('symlink to a .env file', () => rejected('config'))
check('file inside a .env folder', () => rejected('.env/secret.txt'))
check('file inside a .env.local folder', () => rejected('.env.local/key'))
check('isEnvFile matches any segment', () => {
  assert.equal(isEnvFile('/a/.ENV.prod/b/c.txt'), true)
  assert.equal(isEnvFile('/a/environment/b.txt'), false)
})
check('empty path', () => rejected(''))
check('NUL byte', () => rejected('notes.md\0'))

const kind = (tool, input) => classifyTool(tool, input, ws).kind
check('Read inside allows and rewrites path', () => {
  const d = classifyTool('Read', { file_path: 'notes.md' }, ws)
  assert.equal(d.kind, 'allow')
  assert.equal(d.input.file_path, path.join(ws, 'notes.md'))
})
check('Read outside denies', () => assert.equal(kind('Read', { file_path: '/etc/hosts' }), 'deny'))
check('Read .env denies', () => assert.equal(kind('Read', { file_path: path.join(ws, '.env') }), 'deny'))
check('Write inside allows', () => assert.equal(kind('Write', { file_path: path.join(ws, 'brief.md'), content: 'x' }), 'allow'))
check('Write outside denies', () => assert.equal(kind('Write', { file_path: path.join(outside, 'x.md'), content: 'x' }), 'deny'))
check('Write through symlink out denies', () => assert.equal(kind('Write', { file_path: 'escape-dir/x.md', content: 'x' }), 'deny'))
check('Edit missing path denies', () => assert.equal(kind('Edit', { old_string: 'a', new_string: 'b' }), 'deny'))
check('NotebookEdit outside denies', () => assert.equal(kind('NotebookEdit', { notebook_path: '/tmp/x.ipynb' }), 'deny'))
check('Glob without path pins to workspace', () => {
  const d = classifyTool('Glob', { pattern: '**/*.md' }, ws)
  assert.equal(d.kind, 'allow')
  assert.equal(d.input.path, ws)
})
check('Glob with escaping pattern denies', () => assert.equal(kind('Glob', { pattern: '../**' }), 'deny'))
check('Glob with absolute pattern denies', () => assert.equal(kind('Glob', { pattern: '/etc/*' }), 'deny'))
check('Grep outside denies', () => assert.equal(kind('Grep', { pattern: 'x', path: '/Users' }), 'deny'))
check('Grep with escaping glob denies', () => assert.equal(kind('Grep', { pattern: 'x', glob: '../*.txt' }), 'deny'))
check('Bash asks', () => assert.equal(kind('Bash', { command: 'ls' }), 'ask'))
check('Bash asks even for harmless commands', () => assert.equal(kind('Bash', { command: 'echo hi' }), 'ask'))
check('WebSearch allows', () => assert.equal(kind('WebSearch', { query: 'x' }), 'allow'))
const fetchKind = (url) => kind('WebFetch', { url, prompt: 'x' })
check('WebFetch public URL allows', () => {
  assert.equal(fetchKind('https://example.com/page'), 'allow')
  assert.equal(fetchKind('http://93.184.216.34/'), 'allow')
  assert.equal(fetchKind('https://[2606:2800:220:1::]/'), 'allow')
  assert.equal(fetchKind('https://172.32.0.1/'), 'allow')
})
check('WebFetch unparseable denies', () => {
  assert.equal(fetchKind('not a url'), 'deny')
  assert.equal(kind('WebFetch', { prompt: 'x' }), 'deny')
})
check('WebFetch non-http protocol denies', () => {
  assert.equal(fetchKind('file:///etc/passwd'), 'deny')
  assert.equal(fetchKind('ftp://example.com/'), 'deny')
})
check('WebFetch localhost names deny', () => {
  for (const u of ['http://localhost:3000/', 'http://LOCALHOST./', 'http://api.localhost/', 'http://printer.local/']) {
    assert.equal(fetchKind(u), 'deny', u)
  }
})
check('WebFetch private IPv4 denies', () => {
  for (const u of [
    'http://127.0.0.1:3000/api/bots',
    'http://127.8.9.10/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0:3000/',
    'http://2130706433/',
    'http://0x7f.1/',
  ]) {
    assert.equal(fetchKind(u), 'deny', u)
  }
})
check('WebFetch private IPv6 denies', () => {
  for (const u of [
    'http://[::1]:3000/',
    'http://[::]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[febf::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:192.168.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
  ]) {
    assert.equal(fetchKind(u), 'deny', u)
  }
})
check('WebFetch denial names the reason', () => {
  assert.equal(classifyTool('WebFetch', { url: 'http://localhost/' }, ws).reason, 'Web fetches cannot reach this computer or a private network.')
})
check('Agent allows a plain delegation', () => assert.equal(kind('Agent', { subagent_type: 'research', prompt: 'x', description: 'x' }), 'allow'))
check('Agent strips overrides and forces foreground', () => {
  const d = classifyTool(
    'Agent',
    {
      subagent_type: 'research',
      prompt: 'p',
      description: 'd',
      model: 'opus',
      effort: 'max',
      isolation: 'remote',
      mode: 'bypassPermissions',
      name: 'n',
      team_name: 't',
      run_in_background: true,
    },
    ws,
  )
  assert.equal(d.kind, 'allow')
  assert.deepEqual(d.input, { subagent_type: 'research', prompt: 'p', description: 'd', run_in_background: false })
})
check('remember allows', () => assert.equal(kind('mcp__willbot__remember', { note: 'x' }), 'allow'))
check('unknown MCP send tool asks', () => assert.equal(kind('mcp__mail__send_message', { to: 'x' }), 'ask'))
check('unknown built-in asks', () => assert.equal(kind('PowerShell', { command: 'x' }), 'ask'))
check('Task is the Agent rule', () => {
  const d = classifyTool('Task', { subagent_type: 'research', prompt: 'p', description: 'd', model: 'opus', run_in_background: true }, ws)
  assert.equal(d.kind, 'allow')
  assert.deepEqual(d.input, { subagent_type: 'research', prompt: 'p', description: 'd', run_in_background: false })
})

const home = path.join(tmp, 'home')
for (const dir of ['.ssh', '.aws', '.gnupg', '.config/gh', 'Library/Keychains', '.claude', 'docs']) {
  fs.mkdirSync(path.join(home, dir), { recursive: true })
}
fs.writeFileSync(path.join(home, 'docs', 'plan.md'), 'plan')
fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host x')
fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}')
fs.symlinkSync(path.join(home, '.ssh'), path.join(home, 'docs', 'keys'))
const readOnly = new Set(['mcp__claude_ai_Gmail__search_threads'])
const full = { home, readOnlyMcp: (name) => readOnly.has(name) }
const fullKind = (tool, input) => classifyTool(tool, input, ws, full).kind
const fullReason = (tool, input) => classifyTool(tool, input, ws, full).reason

check('full: Read outside the workspace allows and rewrites path', () => {
  const d = classifyTool('Read', { file_path: path.join(home, 'docs', 'plan.md') }, ws, full)
  assert.equal(d.kind, 'allow')
  assert.equal(d.input.file_path, path.join(home, 'docs', 'plan.md'))
  assert.equal(fullKind('Read', { file_path: '/etc/hosts' }), 'allow')
})
check('full: Read inside still allows', () => assert.equal(fullKind('Read', { file_path: 'notes.md' }), 'allow'))
check('full: secret paths deny', () => {
  for (const p of [
    path.join(home, '.ssh', 'config'),
    path.join(home, '.SSH', 'config'),
    path.join(home, '.aws', 'credentials'),
    path.join(home, '.gnupg', 'x'),
    path.join(home, '.config', 'gh', 'hosts.yml'),
    path.join(home, '.netrc'),
    path.join(home, 'Library', 'Keychains', 'login.keychain-db'),
    path.join(home, '.claude', '.credentials.json'),
    path.join(home, 'docs', 'id_rsa'),
    path.join(home, 'docs', 'id_ed25519.pub'),
    path.join(home, 'docs', 'server.PEM'),
    path.join(home, 'docs', '.env.local'),
    path.join(home, 'docs', 'keys', 'config'),
  ]) {
    assert.equal(fullKind('Read', { file_path: p }), 'deny', p)
  }
  assert.match(fullReason('Read', { file_path: path.join(home, '.aws', 'credentials') }), /Secrets are off limits/)
})
check('full: non-secret neighbours of secrets allow', () => {
  assert.equal(isSecret(path.join(home, '.sshd', 'x'), home), false)
  assert.equal(isSecret(path.join(home, '.claude', 'settings.json'), home), false)
  assert.equal(isSecret(path.join(home, '.config', 'ghostty'), home), false)
  assert.equal(isSecret('/elsewhere/.ssh-notes', home), false)
})
check('full: dot-dot still denies', () => assert.equal(fullKind('Read', { file_path: `${home}/docs/../.ssh/config` }), 'deny'))
check('full: Glob outside allows, into a secret folder denies', () => {
  assert.equal(fullKind('Glob', { pattern: '*.md', path: path.join(home, 'docs') }), 'allow')
  assert.equal(fullKind('Glob', { pattern: '*', path: path.join(home, '.ssh') }), 'deny')
  assert.equal(classifyTool('Glob', { pattern: '*' }, ws, full).input.path, ws)
})
check('full: Grep inside allows, outside asks, secret folder denies', () => {
  assert.equal(fullKind('Grep', { pattern: 'x' }), 'allow')
  assert.equal(fullKind('Grep', { pattern: 'x', path: path.join(home, 'docs') }), 'ask')
  assert.equal(fullKind('Grep', { pattern: 'x', path: path.join(home, '.aws') }), 'deny')
})
check('full: writes inside allow, outside ask, secrets deny', () => {
  assert.equal(fullKind('Write', { file_path: path.join(ws, 'brief.md'), content: 'x' }), 'allow')
  assert.equal(fullKind('Write', { file_path: path.join(home, 'docs', 'new.md'), content: 'x' }), 'ask')
  assert.equal(fullKind('Edit', { file_path: path.join(home, 'docs', 'plan.md'), old_string: 'a', new_string: 'b' }), 'ask')
  assert.equal(fullKind('NotebookEdit', { notebook_path: '/tmp/x.ipynb' }), 'ask')
  assert.equal(fullKind('Write', { file_path: path.join(home, '.ssh', 'authorized_keys'), content: 'x' }), 'deny')
  assert.equal(fullKind('Edit', { file_path: path.join(ws, '.env'), old_string: 'a', new_string: 'b' }), 'deny')
})
check('full: Bash still asks', () => assert.equal(fullKind('Bash', { command: 'ls' }), 'ask'))
check('full: WebFetch keeps the private-network rule', () => {
  assert.equal(fullKind('WebFetch', { url: 'http://127.0.0.1:3000/', prompt: 'x' }), 'deny')
  assert.equal(fullKind('WebFetch', { url: 'https://example.com/', prompt: 'x' }), 'allow')
})
check('full: harmless built-ins allow', () => {
  for (const t of ['WebSearch', 'Skill', 'ToolSearch', 'ListAgents', 'TaskStop']) assert.equal(fullKind(t, {}), 'allow', t)
})
check('full: AskUserQuestion and plan mode deny', () => {
  assert.equal(fullReason('AskUserQuestion', { questions: [] }), 'Ask the user in your reply instead.')
  assert.equal(fullReason('EnterPlanMode', {}), 'Plan in your reply instead.')
  assert.equal(fullReason('ExitPlanMode', {}), 'Plan in your reply instead.')
})
check('full: persistent and outward built-ins ask', () => {
  for (const t of ['CronCreate', 'CronDelete', 'RemoteTrigger', 'ScheduleWakeup', 'PushNotification', 'SendMessage', 'Monitor', 'EnterWorktree']) {
    assert.equal(fullKind(t, {}), 'ask', t)
  }
})
check('full: Task is the Agent rule', () => {
  const d = classifyTool('Task', { subagent_type: 'general-purpose', prompt: 'p', description: 'd', isolation: 'remote' }, ws, full)
  assert.deepEqual(d.input, { subagent_type: 'general-purpose', prompt: 'p', description: 'd', run_in_background: false })
})
check('full: read-only MCP tool allows', () => assert.equal(fullKind('mcp__claude_ai_Gmail__search_threads', { q: 'x' }), 'allow'))
check('full: writing MCP tool asks', () => assert.equal(fullKind('mcp__claude_ai_Gmail__send_message', { to: 'x' }), 'ask'))
check('full: unknown MCP tool asks', () => assert.equal(fullKind('mcp__claude_ai_Notion__notion-new-thing', {}), 'ask'))
check('full: remember allows', () => assert.equal(fullKind('mcp__willbot__remember', { note: 'x' }), 'allow'))
check('workspace mode ignores the MCP lookup', () => assert.equal(kind('mcp__claude_ai_Gmail__search_threads', {}), 'ask'))
check('workspace mode still denies reads outside', () => assert.equal(kind('Read', { file_path: path.join(home, 'docs', 'plan.md') }), 'deny'))

fs.rmSync(tmp, { recursive: true, force: true })
if (failures) {
  console.log(`\n${failures} failed`)
  process.exit(1)
}
console.log('\nall policy checks passed')
