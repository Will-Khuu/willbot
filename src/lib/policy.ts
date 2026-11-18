import fs from 'node:fs'
import path from 'node:path'

type ToolInput = Record<string, unknown>

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string }

// 'allow' carries the input with every path rewritten to the absolute real
// path that was checked, so a subagent whose process cwd is another bot's
// workspace still touches exactly the file that was checked.
export type Decision =
  | { kind: 'allow'; input: ToolInput }
  | { kind: 'ask' }
  | { kind: 'deny'; reason: string }

// What a full-access bot's rules need beyond its workspace. readOnlyMcp is
// true only for a tool its server annotates readOnly and not destructive.
export type FullAccess = { home: string; readOnlyMcp: (toolName: string) => boolean }

type Rule = (input: ToolInput, workspace: string, home: string) => Decision

const allow = (input: ToolInput): Decision => ({ kind: 'allow', input })
const deny = (reason: string): Decision => ({ kind: 'deny', reason })

export function isEnvFile(p: string): boolean {
  return p.split(/[\\/]/).some((segment) => /^\.env/i.test(segment))
}

function isInside(p: string, root: string): boolean {
  const rel = path.relative(root, p)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

const SECRET_NAME = /^(\.env|id_rsa|id_ed25519)|\.pem$/i
const HOME_SECRET = /^(\.ssh|\.aws|\.gnupg|\.config\/gh|\.netrc|library\/keychains)(\/|$)|^\.claude\/\.credentials/

// Lowercased because the Mac's disk ignores case: ~/.SSH is ~/.ssh.
export function isSecret(p: string, home: string): boolean {
  if (p.split(/[\\/]/).some((segment) => SECRET_NAME.test(segment))) return true
  return HOME_SECRET.test(path.relative(home.toLowerCase(), p.toLowerCase()))
}

function realpathOfNearestExisting(abs: string): string | null {
  const rest: string[] = []
  let cur = abs
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest)
    } catch {
      // A dangling symlink lstat()s fine but cannot be realpath()ed; writing
      // through it would land wherever it points.
      try {
        fs.lstatSync(cur)
        return null
      } catch {}
      const parent = path.dirname(cur)
      if (parent === cur) return null
      rest.unshift(path.basename(cur))
      cur = parent
    }
  }
}

export function checkPath(p: string, workspace: string): PathCheck {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) return { ok: false, reason: 'Invalid path.' }
  if (p.split(/[\\/]/).includes('..')) return { ok: false, reason: 'Paths may not contain "..".' }
  const root = fs.realpathSync(workspace)
  const abs = path.resolve(root, p)
  if (isEnvFile(abs)) return { ok: false, reason: '.env files are off limits.' }
  const real = realpathOfNearestExisting(abs)
  if (real === null) return { ok: false, reason: 'Path resolves through a broken link.' }
  if (!isInside(real, root)) return { ok: false, reason: `Only files inside ${root} are allowed.` }
  if (isEnvFile(real)) return { ok: false, reason: '.env files are off limits.' }
  return { ok: true, path: real }
}

export type FullPathCheck = { ok: true; path: string; inside: boolean } | { ok: false; reason: string }

// Like checkPath, but any non-secret location is ok; `inside` says whether it
// is in the workspace.
export function checkFullPath(p: string, workspace: string, home: string): FullPathCheck {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) return { ok: false, reason: 'Invalid path.' }
  if (p.split(/[\\/]/).includes('..')) return { ok: false, reason: 'Paths may not contain "..".' }
  const root = fs.realpathSync(workspace)
  const abs = path.resolve(root, p)
  const secret = { ok: false as const, reason: 'Secrets are off limits: .env files, keys, and credential folders.' }
  if (isSecret(abs, home)) return secret
  const real = realpathOfNearestExisting(abs)
  if (real === null) return { ok: false, reason: 'Path resolves through a broken link.' }
  if (isSecret(real, home)) return secret
  return { ok: true, path: real, inside: isInside(real, root) }
}

function pathField(field: string, required: boolean): Rule {
  return (input, workspace) => {
    const value = input[field]
    if (value === undefined || value === null || value === '') {
      return required ? deny(`Missing ${field}.`) : allow({ ...input, [field]: fs.realpathSync(workspace) })
    }
    if (typeof value !== 'string') return deny(`Invalid ${field}.`)
    const check = checkPath(value, workspace)
    return check.ok ? allow({ ...input, [field]: check.path }) : deny(check.reason)
  }
}

function globField(field: string): Rule {
  return (input) => {
    const value = input[field]
    if (value === undefined || value === null) return allow(input)
    if (typeof value !== 'string') return deny(`Invalid ${field}.`)
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      return deny('Search patterns must stay inside the workspace.')
    }
    return allow(input)
  }
}

function all(...rules: Rule[]): Rule {
  return (input, workspace, home) => {
    let current = input
    for (const rule of rules) {
      const d = rule(current, workspace, home)
      if (d.kind !== 'allow') return d
      current = d.input
    }
    return allow(current)
  }
}

const passthrough: Rule = (input) => allow(input)
const ask: Rule = () => ({ kind: 'ask' })

// Delegates run in the foreground, on their own definition's model, as plain subagents.
const AGENT_STRIPPED = new Set(['model', 'effort', 'isolation', 'mode', 'name', 'team_name'])
const agent: Rule = (input) =>
  allow({ ...Object.fromEntries(Object.entries(input).filter(([k]) => !AGENT_STRIPPED.has(k))), run_in_background: false })

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

// URL serializes IPv6 in compressed lowercase hex, so ::ffff:127.0.0.1 arrives as ::ffff:7f00:1.
function isPrivateIPv6(host: string): boolean {
  if (host === '::1' || host === '::') return true
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16)
    const lo = parseInt(mapped[2]!, 16)
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)
  if (dotted) return isPrivateIPv4(dotted[1]!)
  const first = parseInt(host.split(':')[0]!, 16)
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
}

// A literal check only: a public name that resolves to a private address is not caught.
const webFetch: Rule = (input) => {
  let url: URL
  try {
    url = new URL(String(input.url))
  } catch {
    return deny('Invalid url.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return deny('Only http and https URLs can be fetched.')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
  const isPrivate = host.startsWith('[') ? isPrivateIPv6(host.slice(1, -1)) : isPrivateIPv4(host)
  return local || isPrivate ? deny('Web fetches cannot reach this computer or a private network.') : allow(input)
}

function fullPathField(field: string, required: boolean, outside: 'allow' | 'ask'): Rule {
  return (input, workspace, home) => {
    const value = input[field]
    if (value === undefined || value === null || value === '') {
      return required ? deny(`Missing ${field}.`) : allow({ ...input, [field]: fs.realpathSync(workspace) })
    }
    if (typeof value !== 'string') return deny(`Invalid ${field}.`)
    const check = checkFullPath(value, workspace, home)
    if (!check.ok) return deny(check.reason)
    if (!check.inside && outside === 'ask') return { kind: 'ask' }
    return allow({ ...input, [field]: check.path })
  }
}

const RULES: Record<string, Rule> = {
  Read: pathField('file_path', true),
  Write: pathField('file_path', true),
  Edit: pathField('file_path', true),
  NotebookEdit: pathField('notebook_path', true),
  Glob: all(pathField('path', false), globField('pattern')),
  Grep: all(pathField('path', false), globField('glob')),
  WebSearch: passthrough,
  WebFetch: webFetch,
  Agent: agent,
  Task: agent,
  Bash: ask,
  mcp__willbot__remember: passthrough,
}

// Grep outside the workspace asks: it reads every file under its path, and
// one search pattern cannot leave out .env files and keys.
const FULL_RULES: Record<string, Rule> = {
  ...RULES,
  Read: fullPathField('file_path', true, 'allow'),
  Glob: all(fullPathField('path', false, 'allow'), globField('pattern')),
  Grep: all(fullPathField('path', false, 'ask'), globField('glob')),
  Write: fullPathField('file_path', true, 'ask'),
  Edit: fullPathField('file_path', true, 'ask'),
  NotebookEdit: fullPathField('notebook_path', true, 'ask'),
  Skill: passthrough,
  ToolSearch: passthrough,
  ListAgents: passthrough,
  TaskStop: passthrough,
  AskUserQuestion: () => deny('Ask the user in your reply instead.'),
  EnterPlanMode: () => deny('Plan in your reply instead.'),
  ExitPlanMode: () => deny('Plan in your reply instead.'),
}

// Without `full`, the bot is jailed to its workspace.
export function classifyTool(toolName: string, input: ToolInput, workspace: string, full?: FullAccess): Decision {
  if (!full) return (RULES[toolName] ?? ask)(input, workspace, '')
  const rule = FULL_RULES[toolName]
  if (rule) return rule(input, workspace, full.home)
  return toolName.startsWith('mcp__') && full.readOnlyMcp(toolName) ? allow(input) : { kind: 'ask' }
}
