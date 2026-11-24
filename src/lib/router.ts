import { z } from 'zod'

// Picks a model per message for a router employee from the user's pstack
// role table, so one file drives both Claude Code and will-bot.

export const TASK_KINDS = ['trivial', 'investigation', 'feature', 'refactoring', 'bug-fix', 'perf-issue', 'judgment'] as const
export type TaskKind = (typeof TASK_KINDS)[number]
export type Alias = 'haiku' | 'sonnet' | 'opus'

const RANK: Record<Alias, number> = { haiku: 0, sonnet: 1, opus: 2 }
export const MODEL_LABELS: Record<Alias, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

// trivial has no role: it always runs on Haiku.
const ROLE_OF: Record<TaskKind, string | null> = {
  trivial: null,
  investigation: 'how explorer',
  feature: 'feature, refactoring',
  refactoring: 'feature, refactoring',
  'bug-fix': 'bug-fix',
  'perf-issue': 'perf-issue',
  judgment: 'judgment and prose',
}

// role -> model slugs, first slug first.
export type RoleTable = ReadonlyMap<string, readonly string[]>

const SLUG = /^[a-z0-9][a-z0-9.-]*$/
const ROLE_LINE = /^\s*(?:[-*]\s+)?([a-z][a-z ,-]*?)\s*:\s*(.+?)\s*$/

export function parseRoleTable(md: string): RoleTable {
  const table = new Map<string, string[]>()
  for (const line of md.split('\n')) {
    const m = ROLE_LINE.exec(line)
    if (!m) continue
    const slugs = m[2]!.split(',').map((s) => s.trim().replace(/^`|`$/g, ''))
    if (slugs.every((s) => SLUG.test(s))) table.set(m[1]!, slugs)
  }
  return table
}

const ModelsJson = z.object({ roles: z.array(z.object({ role: z.string(), models: z.array(z.string()) })) })

export function parseModelsJson(text: string): RoleTable {
  try {
    const parsed = ModelsJson.safeParse(JSON.parse(text))
    return new Map(parsed.success ? parsed.data.roles.map((r) => [r.role, r.models]) : [])
  } catch {
    return new Map()
  }
}

export function aliasOf(slug: string): Alias | null {
  if (slug.includes('opus') || slug.includes('fable')) return 'opus'
  if (slug.includes('sonnet')) return 'sonnet'
  if (slug.includes('haiku')) return 'haiku'
  return null
}

export type Resolved = { model: Alias; slug: string | null }

export function resolveModel(kind: TaskKind, user: RoleTable | null, defaults: RoleTable | null): Resolved {
  const role = ROLE_OF[kind]
  if (!role) return { model: 'haiku', slug: null }
  for (const table of [user, defaults]) {
    const slug = table?.get(role)?.[0]
    const model = slug && aliasOf(slug)
    if (slug && model) return { model, slug }
  }
  return { model: 'opus', slug: null }
}

export const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...TASK_KINDS] },
    reason: { type: 'string', maxLength: 80, description: 'A few words on what the task is.' },
  },
  required: ['kind', 'reason'],
  additionalProperties: false,
} as const

const Classification = z.object({ kind: z.enum(TASK_KINDS), reason: z.string() })
export type Classification = { kind: TaskKind; reason: string }

export function parseClassification(value: unknown): Classification | null {
  const parsed = Classification.safeParse(value)
  if (!parsed.success) return null
  return { kind: parsed.data.kind, reason: oneLine(parsed.data.reason, 80) }
}

const KIND_HINTS: Record<TaskKind, string> = {
  trivial: 'a greeting, a quick factual answer, or a tiny edit that needs no investigation',
  investigation: 'a read-only question about how something works or why it was built that way',
  feature: 'new or changed behavior',
  refactoring: 'a behavior-preserving change to structure (rename, extract, move, dedupe)',
  'bug-fix': 'a defect to reproduce, root-cause and fix',
  'perf-issue': 'slowness to measure and improve',
  judgment: 'writing, reviewing, or a decision or tradeoff call',
}

// The start of a long paste says what the task is; the rest only slows the classifier.
const CLASSIFY_MESSAGE_MAX = 4000

export function classifierPrompt(context: string, message: string): string {
  const shown = message.length > CLASSIFY_MESSAGE_MAX ? `${message.slice(0, CLASSIFY_MESSAGE_MAX)}\n[…cut]` : message
  return [
    'Classify the task in the new message to a coding assistant. Kinds:',
    ...TASK_KINDS.map((k) => `- ${k}: ${KIND_HINTS[k]}`),
    'When unsure between two kinds, pick the more demanding one.',
    '',
    'Recent conversation:',
    context || '(none)',
    '',
    'New message:',
    shown,
  ].join('\n')
}

const NEW_TASK_GAP_MS = 30 * 60 * 1000

// A message starts a new task when the session has no earlier user message
// or the last one is over 30 minutes old.
export function isNewTask(lastUserAt: string | null, now: number): boolean {
  return lastUserAt === null || now - Date.parse(lastUserAt) > NEW_TASK_GAP_MS
}

export type RouteChoice =
  | { by: 'pick'; model: Alias }
  | { by: 'router'; classification: Classification; resolved: Resolved }
  | { by: 'unavailable' }

export type Route = { taskKind: TaskKind | null; model: Alias; reason: string; changed: boolean }

// current is the model the employee's task runs on now, null when unknown.
export function decideRoute(current: Alias | null, choice: RouteChoice, newTask: boolean): Route {
  if (choice.by === 'pick') {
    return { taskKind: null, model: choice.model, reason: 'You picked this model', changed: choice.model !== current }
  }
  if (choice.by === 'unavailable') {
    const model = current ?? 'opus'
    return { taskKind: null, model, reason: `Router unavailable, kept ${MODEL_LABELS[model]}`, changed: model !== current }
  }
  const { classification, resolved } = choice
  const proposed = resolved.model
  if (current && RANK[proposed] < RANK[current] && !newTask) {
    return { taskKind: classification.kind, model: current, reason: 'mid-task, no downgrade', changed: false }
  }
  const fable = resolved.slug?.includes('fable')
    ? `; ${classification.kind} → Fable in your table, using Opus (Fable needs credits)`
    : ''
  return { taskKind: classification.kind, model: proposed, reason: classification.reason + fable, changed: proposed !== current }
}

export function routeLine(route: Pick<Route, 'taskKind' | 'model' | 'reason' | 'changed'>): string {
  const label = MODEL_LABELS[route.model]
  if (!route.taskKind) return `${label} · ${route.reason}`
  return `${route.changed ? '' : 'Kept '}${label} · ${route.taskKind}: ${route.reason}`
}

function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const InstalledPlugins = z.object({
  plugins: z.record(z.string(), z.array(z.object({ installPath: z.string() }))),
})
const Settings = z.object({ enabledPlugins: z.record(z.string(), z.unknown()).optional() })

export type ReadFile = (file: string) => string | null

function pstackModelsJson(read: ReadFile, claudeDir: string): string | null {
  try {
    const installed = InstalledPlugins.parse(JSON.parse(read(`${claudeDir}/plugins/installed_plugins.json`) ?? ''))
    const settings = Settings.safeParse(JSON.parse(read(`${claudeDir}/settings.json`) ?? '{}'))
    const enabled = (settings.success && settings.data.enabledPlugins) || {}
    const keys = Object.keys(installed.plugins).filter((k) => k.startsWith('pstack@'))
    const key = keys.find((k) => enabled[k] === true) ?? keys[0]
    const install = key ? installed.plugins[key]?.[0] : undefined
    return install ? read(`${install.installPath}/models.json`) : null
  } catch {
    return null
  }
}

// The reader is passed in so this module stays free of node imports: the UI imports it too.
export function loadRoleTables(read: ReadFile, claudeDir: string): { user: RoleTable | null; defaults: RoleTable | null } {
  const md = read(`${claudeDir}/pstack-models.md`)
  const json = pstackModelsJson(read, claudeDir)
  return { user: md === null ? null : parseRoleTable(md), defaults: json === null ? null : parseModelsJson(json) }
}
