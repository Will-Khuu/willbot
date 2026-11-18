import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  createSdkMcpServer,
  filterEscalatingDefaultMode,
  query,
  resolveSettings,
  tool,
  type AgentDefinition,
  type CanUseTool,
  type HookCallback,
  type McpStdioServerConfig,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { classify } from './classify'
import { detailInput, detailOutput } from './detail'
import { sdkEnv } from './env'
import { actorOf, guardToolCall, isDelegation, REMEMBER } from './guard'
import { parseQuestions } from './questions'
import { aliasOf, decideRoute, isNewTask, loadRoleTables, resolveModel, type Alias, type Route } from './router'
import {
  AsyncQueue,
  awaitDecision,
  delegatedBy,
  expireDecisions,
  noteLimitError,
  noteRateLimit,
  publish,
  rt,
  type LiveSession,
} from './runtime'
import { applyTaskCall, parseTaskCall, TASK_TOOLS, type TaskCall, type TaskEntry } from './tasks'
import { initialSession, isQuiet, isWorking, reduce, shouldRecycle, type SessionEvent } from './session'
import { appendMemory, ensureFolder, getBot, listBots, readChat, readMemory, setSessionId, upsertChatItem } from './store'
import type { ActivityItem, ApprovalItem, Bot, BotId, ChatItem, Model, Question, QuestionItem, RouteItem, TasksItem } from './types'

const CONNECT_WAIT_MS = 12_000
const IDLE_CLOSE_MS = 15 * 60 * 1000

function employeeBlock(bot: Bot, opts: { canRemember: boolean; team?: Bot[] }): string {
  const memory = readMemory(bot.id)
  const lines = [
    `You are ${bot.name}, one employee in will-bot; the user talks to you through its chat UI.`,
    `Your job: ${bot.job}`,
    `Your working folder is ${bot.folder}.`,
  ]
  if (opts.canRemember) {
    lines.push(`When the user tells you a durable fact or preference, save it with the ${REMEMBER} tool.`)
  }
  if (opts.team?.length) {
    lines.push(
      '',
      'You lead a team. Delegate to a teammate with the Agent tool, using their id as subagent_type:',
      ...opts.team.map((b) => `- ${b.id}: ${b.name}. ${b.job}`),
    )
  }
  lines.push('', 'Memory:', ...(memory.length ? memory.map((m) => `- ${m.date}: ${m.text}`) : ['(nothing saved yet)']))
  return lines.join('\n')
}

function playwright(folder: string): McpStdioServerConfig {
  return {
    command: 'npx',
    args: ['-y', '@playwright/mcp@0.0.84', '--headless', '--isolated', '--output-dir', path.join(folder, '.playwright')],
  }
}

function rememberServer(botId: BotId) {
  return createSdkMcpServer({
    name: 'willbot',
    version: '0.1.0',
    tools: [
      tool(
        'remember',
        'Save one durable fact or preference to your memory. It is loaded into every future conversation.',
        { note: z.string().min(1).max(500).describe('One short sentence to remember.') },
        async ({ note }) => {
          appendMemory(botId, note)
          return { content: [{ type: 'text', text: 'Saved to memory.' }] }
        },
      ),
    ],
  })
}

function agentDefinitions(team: Bot[]): Record<string, AgentDefinition> {
  return Object.fromEntries(
    team.map((b) => [
      b.id,
      {
        description: `${b.name}: ${b.job}`,
        prompt: employeeBlock(b, { canRemember: false }),
        model: b.model ?? undefined,
        mcpServers: b.browser ? [{ playwright: playwright(b.folder) }] : undefined,
      },
    ]),
  )
}

function short(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  return typeof v === 'string' ? v : ''
}

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return short(url, 40)
  }
}

const ACTIVITY: Record<string, (input: Record<string, unknown>, nameOf: (id: string) => string) => string> = {
  Read: (i) => `Read ${path.basename(str(i, 'file_path'))}`,
  Write: (i) => `Wrote ${path.basename(str(i, 'file_path'))}`,
  Edit: (i) => `Edited ${path.basename(str(i, 'file_path'))}`,
  NotebookEdit: (i) => `Edited ${path.basename(str(i, 'notebook_path'))}`,
  Glob: (i) => `Listed files matching ${short(str(i, 'pattern'), 40)}`,
  Grep: (i) => `Searched files for "${short(str(i, 'pattern'), 40)}"`,
  WebSearch: (i) => `Searched the web for "${short(str(i, 'query'), 60)}"`,
  WebFetch: (i) => `Opened ${host(str(i, 'url'))}`,
  Bash: (i) => (str(i, 'description') ? `Shell command: ${short(str(i, 'description'), 60)}` : 'Shell command'),
  Agent: (i, nameOf) => `Asked ${nameOf(str(i, 'subagent_type') || 'a subagent')}`,
  Task: (i, nameOf) => `Asked ${nameOf(str(i, 'subagent_type') || 'a subagent')}`,
  Skill: (i) => `Used the ${short(str(i, 'skill'), 40)} skill`,
  AskUserQuestion: () => 'Asked you a question',
  ExitPlanMode: () => 'Shared a plan',
  [REMEMBER]: (i) => `Remembered: ${short(str(i, 'note'), 60)}`,
}

// mcp__claude_ai_Google_Drive__search_files -> "Google Drive: search_files"
function mcpName(toolName: string): string | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (!m) return null
  return `${m[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ')}: ${m[2]}`
}

function activityLabel(toolName: string, input: Record<string, unknown>, nameOf: (id: string) => string): string {
  return ACTIVITY[toolName]?.(input, nameOf) ?? `Used ${mcpName(toolName) ?? toolName}`
}

function planText(input: Record<string, unknown>): string {
  if (typeof input.plan === 'string' && input.plan.trim()) return input.plan
  const file = str(input, 'planFilePath')
  if (file) {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {}
  }
  return JSON.stringify(input, null, 2)
}

// The user's own Claude Code sessions run in auto mode unless their settings
// name another default. The CLI started headless picks 'default' instead, so
// say auto explicitly when the settings are silent. A resumed session also
// keeps the model it last ran on, so an employee on "Default" is moved to the
// user's current default model.
async function matchClaudeCodeDefaults(q: Query, cwd: string, model: string | null): Promise<void> {
  const settings = filterEscalatingDefaultMode(await resolveSettings({ cwd, settingSources: ['user', 'project', 'local'] }))
  if (!settings.permissions?.defaultMode) await q.setPermissionMode('auto')
  if (!model && settings.model) await q.setModel(settings.model)
}

const now = () => new Date().toISOString()
const newId = () => randomUUID()

function save(ownerId: BotId, item: ChatItem, update = false): void {
  upsertChatItem(ownerId, item)
  publish(ownerId, { type: update ? 'item_update' : 'item', item })
}

function dispatch(live: LiveSession, event: SessionEvent): void {
  const before = live.state
  live.state = reduce(before, event)
  if (live.state === before) return
  if (isWorking(before) !== isWorking(live.state) || before.phase !== live.state.phase) {
    publish(live.botId, { type: 'status' })
    for (const id of new Set([...before.delegated.values(), ...live.state.delegated.values()])) publish(id, { type: 'status' })
  }
  if (shouldRecycle(live.state)) return closeLive(live)
  if (isQuiet(live.state)) {
    live.idleTimer ??= setTimeout(() => {
      if (isQuiet(live.state)) closeLive(live)
    }, IDLE_CLOSE_MS)
  } else if (live.idleTimer) {
    clearTimeout(live.idleTimer)
    live.idleTimer = null
  }
}

function closeLive(live: LiveSession): void {
  if (live.state.phase === 'closing') return
  dispatch(live, { type: 'closing' })
  if (live.idleTimer) clearTimeout(live.idleTimer)
  live.idleTimer = null
  live.inbox.close()
  live.query.close()
  expireDecisions(live.botId)
  if (rt.sessions.get(live.botId) === live) rt.sessions.delete(live.botId)
  publish(live.botId, { type: 'status' })
}

// model overrides the employee's configured model for this session (a route or a pick).
function open(bot: Bot, model: Alias | null): LiveSession {
  const all = listBots()
  const names = new Map(all.map((b) => [b.id, b.name]))
  const nameOf = (id: string) => names.get(id) ?? id
  const teamBots = bot.builtin === 'chief' ? all.filter((b) => b.id !== bot.id && !b.paused) : []
  const team = new Set(teamBots.map((b) => b.id))
  const cwd = ensureFolder(bot)
  const teamFolders = teamBots.flatMap((b) => {
    try {
      return [ensureFolder(b)]
    } catch {
      return []
    }
  })

  // tool_use id -> employee making the call, so canUseTool (which only sees a
  // toolUseID) can say who is asking.
  const caller = new Map<string, BotId>()
  // task id -> what the session told us about it, for background activity items.
  const tasks = new Map<string, { description: string; toolUseId: string | undefined; announced: boolean }>()
  const backgroundToolUses = new Set<string>()
  let interrupted = false
  const chat = readChat(bot.id)
  const tasksId = (sessionId: string | null) => `tasks:${sessionId}`
  // Main-thread task-list calls waiting for their result, by tool_use id.
  const taskCalls = new Map<string, TaskCall>()
  // Activity items waiting for their tool's result, by tool_use id.
  const toolActivity = new Map<string, ActivityItem>()
  let taskList: TaskEntry[] =
    chat.items.find((i): i is TasksItem => i.kind === 'tasks' && i.id === tasksId(chat.sessionId))?.items ?? []

  const inbox = new AsyncQueue<SDKUserMessage>()
  let markReady!: () => void
  const ready = new Promise<void>((r) => (markReady = r))
  // claude.ai connectors connect seconds after start. A message sent at once
  // runs its first turn without them, and the model reports them unavailable.
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    await ready
    yield* inbox
  }

  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    const call = {
      ownerId: bot.id,
      team,
      agentId: input.agent_id,
      agentType: input.agent_type,
      toolName: input.tool_name,
      input: (input.tool_input ?? {}) as Record<string, unknown>,
    }
    caller.set(input.tool_use_id, actorOf(call))
    const reason = guardToolCall(call, getBot)
    if (!reason) return {}
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
  }

  async function approve(
    actor: BotId,
    card: Pick<ApprovalItem, 'action' | 'detail' | 'body' | 'plan'>,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const { id, outcome } = awaitDecision<'approval'>({ kind: 'approval', botId: actor, ownerId: bot.id }, signal)
    const item: ApprovalItem = { kind: 'approval', id, botId: actor, ...card, state: 'pending', at: now() }
    save(bot.id, item)
    const state = await outcome
    save(bot.id, { ...item, state }, true)
    if (state === 'allowed') return { behavior: 'allow', updatedInput: input }
    if (state === 'expired') return { behavior: 'deny', message: 'The user did not answer in time.' }
    return {
      behavior: 'deny',
      message: card.plan ? 'The user wants you to keep planning.' : 'The user denied this action.',
    }
  }

  async function ask(
    actor: BotId,
    questions: Question[],
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const { id, outcome } = awaitDecision<'question'>({ kind: 'question', botId: actor, ownerId: bot.id, questions }, signal)
    const item: QuestionItem = { kind: 'question', id, botId: actor, questions, answers: null, state: 'pending', at: now() }
    save(bot.id, item)
    const result = await outcome
    if (result === 'expired') {
      save(bot.id, { ...item, state: 'expired' }, true)
      return { behavior: 'deny', message: 'The user did not answer in time.' }
    }
    save(bot.id, { ...item, answers: result.answers, state: 'answered' }, true)
    return { behavior: 'allow', updatedInput: { ...input, answers: result.answers } }
  }

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    const actor = caller.get(opts.toolUseID) ?? bot.id
    if (toolName === 'AskUserQuestion') {
      const questions = parseQuestions(input)
      if (questions) return ask(actor, questions, input, opts.signal)
    }
    if (toolName === 'ExitPlanMode') {
      const card = { action: `${nameOf(actor)} has a plan ready`, detail: null, body: planText(input), plan: true }
      return approve(actor, card, input, opts.signal)
    }
    const card = {
      action: opts.title ?? `${nameOf(actor)} wants to use ${opts.displayName ?? mcpName(toolName) ?? toolName}`,
      detail: opts.description ?? null,
      body: JSON.stringify(input, null, 2),
      plan: false,
    }
    return approve(actor, card, input, opts.signal)
  }

  const options: Options = {
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: employeeBlock(bot, { canRemember: true, team: teamBots }),
      snapshot: false,
    },
    settingSources: ['user', 'project', 'local'],
    cwd,
    additionalDirectories: teamFolders,
    resume: chat.sessionId ?? undefined,
    model: model ?? bot.model ?? undefined,
    mcpServers: { willbot: rememberServer(bot.id), ...(bot.browser ? { playwright: playwright(cwd) } : {}) },
    agents: teamBots.length ? agentDefinitions(teamBots) : undefined,
    hooks: { PreToolUse: [{ hooks: [guard] }] },
    canUseTool,
    env: sdkEnv(),
  }

  const q = query({ prompt: prompt(), options })
  const live: LiveSession = {
    botId: bot.id,
    query: q,
    inbox,
    state: initialSession,
    team,
    idleTimer: null,
    model,
    interrupt: async () => {
      interrupted = true
      await q.interrupt()
    },
  }

  const fail = (text: string) => {
    noteLimitError(text)
    const hint = /authenticat|oauth|log ?in/i.test(text)
      ? '\nLog in with your Claude plan: run `claude` in a terminal, then /login, and try again.'
      : ''
    save(bot.id, { kind: 'error', id: newId(), text: text + hint, at: now() })
  }
  const activity = (botId: BotId, label: string, detail?: ActivityItem['detail']): ActivityItem => {
    const item: ActivityItem = { kind: 'activity', id: newId(), botId, label, ...(detail ? { detail } : {}), at: now() }
    save(bot.id, item)
    return item
  }
  const speakerOf = (toolUseId: string | null | undefined) =>
    (toolUseId && live.state.delegated.get(toolUseId)) || bot.id
  const announce = (taskId: string) => {
    const task = tasks.get(taskId)
    if (!task || task.announced) return
    task.announced = true
    if (task.toolUseId) backgroundToolUses.add(task.toolUseId)
    activity(speakerOf(task.toolUseId), `Started in the background: ${short(task.description, 80)}`)
  }

  const handle = (msg: SDKMessage) => {
    // Only a session that produced a real turn is worth resuming.
    if ((msg.type === 'assistant' && !msg.error) || (msg.type === 'result' && !msg.is_error)) {
      setSessionId(bot.id, msg.session_id)
    }
    if (msg.type === 'assistant') {
      if (msg.error) {
        if (msg.error === 'rate_limit') {
          noteLimitError(msg.message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'))
        }
        return
      }
      const speaker = speakerOf(msg.parent_tool_use_id)
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          save(bot.id, { kind: 'assistant', id: newId(), botId: speaker, text: block.text.trim(), at: now() })
        } else if (block.type === 'tool_use') {
          if (TASK_TOOLS.has(block.name)) {
            const call = msg.parent_tool_use_id === null ? parseTaskCall(block.name, block.input) : null
            if (call) taskCalls.set(block.id, call)
            continue
          }
          const input = (block.input ?? {}) as Record<string, unknown>
          const target = str(input, 'subagent_type')
          if (isDelegation(block.name) && team.has(target)) {
            dispatch(live, { type: 'delegated', toolUseId: block.id, botId: target })
          }
          const item = activity(speaker, activityLabel(block.name, input, nameOf), { input: detailInput(block.name, input) })
          toolActivity.set(block.id, item)
        }
      }
      return
    }
    if (msg.type === 'user' && Array.isArray(msg.message.content)) {
      const results = msg.message.content.flatMap((b) => (b.type === 'tool_result' ? [b] : []))
      for (const block of results) {
        if (!backgroundToolUses.has(block.tool_use_id)) {
          dispatch(live, { type: 'delegation_ended', toolUseId: block.tool_use_id })
        }
        const item = toolActivity.get(block.tool_use_id)
        if (item?.detail) {
          toolActivity.delete(block.tool_use_id)
          const detail = { ...item.detail, output: detailOutput(block.content), ...(block.is_error ? { isError: true } : {}) }
          save(bot.id, { ...item, detail }, true)
        }
        const call = taskCalls.get(block.tool_use_id)
        if (!call) continue
        taskCalls.delete(block.tool_use_id)
        if (block.is_error) continue
        // tool_use_result is per message, so it only belongs to a block that is alone in it.
        taskList = applyTaskCall(taskList, call, results.length === 1 ? msg.tool_use_result : undefined)
        const id = tasksId(msg.session_id ?? readChat(bot.id).sessionId)
        save(bot.id, { kind: 'tasks', id, botId: bot.id, items: taskList, at: now() }, true)
      }
      return
    }
    if (msg.type === 'result') {
      const stopped = interrupted
      interrupted = false
      if (stopped && msg.is_error) return activity(bot.id, 'Stopped.')
      if (msg.subtype === 'success') {
        if (msg.is_error) fail(msg.result || 'The turn failed.')
      } else {
        fail(msg.errors.join('\n') || `The turn ended early (${msg.subtype}).`)
      }
      return
    }
    if (msg.type === 'rate_limit_event') return noteRateLimit(msg.rate_limit_info)
    if (msg.type !== 'system') return
    switch (msg.subtype) {
      case 'session_state_changed':
        return dispatch(live, { type: 'cli_state', state: msg.state })
      case 'background_tasks_changed':
        return dispatch(live, { type: 'background', taskIds: msg.tasks.filter((t) => !t.ambient).map((t) => t.task_id) })
      case 'task_started':
        tasks.set(msg.task_id, { description: msg.description, toolUseId: msg.tool_use_id, announced: false })
        if (msg.is_backgrounded && !msg.ambient && !msg.skip_transcript) announce(msg.task_id)
        return
      case 'task_updated':
        if (msg.patch.is_backgrounded) announce(msg.task_id)
        return
      case 'task_notification': {
        const task = tasks.get(msg.task_id)
        tasks.delete(msg.task_id)
        if (task?.announced) {
          const verb = { completed: 'Finished', failed: 'Failed', stopped: 'Stopped' }[msg.status]
          activity(speakerOf(task.toolUseId), `${verb} in the background: ${short(msg.summary || task.description, 80)}`)
        }
        const toolUseId = msg.tool_use_id ?? task?.toolUseId
        if (toolUseId) dispatch(live, { type: 'delegation_ended', toolUseId })
        return
      }
    }
  }

  void (async () => {
    try {
      await q.initializationResult()
      const deadline = Date.now() + CONNECT_WAIT_MS
      for (;;) {
        const servers = await q.mcpServerStatus()
        const settled = servers.some((s) => s.scope === 'claudeai') && !servers.some((s) => s.status === 'pending')
        if (settled || Date.now() >= deadline || live.state.phase === 'closing') break
        await new Promise((r) => setTimeout(r, 300))
      }
      await matchClaudeCodeDefaults(q, cwd, model ?? bot.model)
    } catch {
      // A failed status check or mode switch leaves Claude Code's own defaults.
    } finally {
      markReady()
      dispatch(live, { type: 'opened' })
    }
  })()

  void (async () => {
    try {
      for await (const msg of q) handle(msg)
    } catch (e) {
      if (live.state.phase !== 'closing') fail(e instanceof Error ? e.message : String(e))
    } finally {
      closeLive(live)
    }
  })()

  return live
}

function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' }
}

function userDefaultModel(): string | null {
  try {
    const model = JSON.parse(readOrNull(path.join(os.homedir(), '.claude', 'settings.json')) ?? '{}').model
    return typeof model === 'string' ? model : null
  } catch {
    return null
  }
}

const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function classifierContext(items: ChatItem[]): string {
  const lines = items.flatMap((i) =>
    i.kind === 'user' ? [`User: ${i.text}`] : i.kind === 'assistant' ? [`Assistant: ${i.text}`] : [],
  )
  return lines.slice(-2).join('\n').slice(-400)
}

// The chat before a message. lastUserAt is null when the message opens a new
// Claude Code session, even if the chat file holds older messages.
type Prior = { items: ChatItem[]; lastUserAt: string | null }

// A manual pick wins; a router employee asks the classifier; anyone else keeps
// their configured model (null).
async function chooseRoute(bot: Bot, text: string, pick: Alias | null, prior: Prior, signal: AbortSignal): Promise<Route | null> {
  if (!pick && !bot.router) return null
  // Before any route, the session ran on the employee's model or the user's
  // Claude Code default; the sticky rule must start from that, not from nothing.
  const current =
    rt.sessions.get(bot.id)?.model ??
    prior.items.findLast((i): i is RouteItem => i.kind === 'route')?.model ??
    aliasOf(bot.model ?? userDefaultModel() ?? '') ??
    null
  const newTask = isNewTask(prior.lastUserAt, Date.now())
  if (pick) return decideRoute(current, { by: 'pick', model: pick }, newTask)
  const classification = await classify(classifierContext(prior.items), text, signal)
  if (!classification) return decideRoute(current, { by: 'unavailable' }, newTask)
  const { user, defaults } = loadRoleTables(readOrNull, path.join(os.homedir(), '.claude'))
  const resolved = resolveModel(classification.kind, user, defaults)
  return decideRoute(current, { by: 'router', classification, resolved }, newTask)
}

async function deliver(botId: BotId, text: string, pick: Alias | null, prior: Prior, signal: AbortSignal): Promise<void> {
  const stopped = () => save(botId, { kind: 'activity', id: newId(), botId, label: 'Stopped.', at: now() })
  let bot = getBot(botId)
  if (!bot || bot.paused) return
  if (signal.aborted) return stopped()
  const route = await chooseRoute(bot, text, pick, prior, signal)
  if (signal.aborted) return stopped()
  bot = getBot(botId)
  if (!bot || bot.paused) return
  if (route) save(botId, { kind: 'route', id: newId(), botId, ...route, at: now() })
  const model = route?.model ?? null
  let live = rt.sessions.get(botId)
  if (!live || live.state.phase === 'closing') {
    try {
      live = open(bot, model)
    } catch (e) {
      save(botId, { kind: 'error', id: newId(), text: e instanceof Error ? e.message : String(e), at: now() })
      return
    }
    rt.sessions.set(botId, live)
  } else if (live.model !== model) {
    try {
      await live.query.setModel(model ?? bot.model ?? undefined)
      live.model = model
    } catch (e) {
      const text = `Could not switch the model: ${e instanceof Error ? e.message : String(e)}`
      save(botId, { kind: 'error', id: newId(), text, at: now() })
    }
  }
  live.inbox.push(userMessage(text))
  dispatch(live, { type: 'pushed' })
}

// Opens the employee's session on first use; later messages join it, even
// mid-turn. Routing happens before the message reaches the session, one
// message at a time per employee.
export function sendMessage(bot: Bot, text: string, pick: Alias | null): void {
  const chat = readChat(bot.id)
  const ongoing = chat.sessionId !== null || rt.sessions.has(bot.id) || rt.sending.has(bot.id)
  const prior: Prior = {
    items: chat.items,
    lastUserAt: ongoing ? (chat.items.findLast((i) => i.kind === 'user')?.at ?? null) : null,
  }
  save(bot.id, { kind: 'user', id: newId(), text, at: now() })
  const ctrl = new AbortController()
  let sending = rt.sending.get(bot.id)
  if (!sending) rt.sending.set(bot.id, (sending = new Set()))
  sending.add(ctrl)
  publish(bot.id, { type: 'status' })
  const tail = (rt.sendTail.get(bot.id) ?? Promise.resolve())
    .then(() => deliver(bot.id, text, pick, prior, ctrl.signal))
    .catch((e: unknown) => save(bot.id, { kind: 'error', id: newId(), text: e instanceof Error ? e.message : String(e), at: now() }))
    .finally(() => {
      sending.delete(ctrl)
      if (sending.size === 0 && rt.sending.get(bot.id) === sending) rt.sending.delete(bot.id)
      if (rt.sendTail.get(bot.id) === tail) rt.sendTail.delete(bot.id)
      publish(bot.id, { type: 'status' })
    })
  rt.sendTail.set(bot.id, tail)
}

// Stops the current turn and keeps the session. A delegated employee lives
// inside its delegator's session, so that turn stops too.
export async function stopBot(botId: BotId): Promise<boolean> {
  const sending = [...(rt.sending.get(botId) ?? [])]
  for (const ctrl of sending) ctrl.abort()
  const targets = [rt.sessions.get(botId), rt.sessions.get(delegatedBy(botId) ?? '')].filter((l) => l !== undefined)
  await Promise.all(targets.map((l) => l.interrupt().catch(() => {})))
  return targets.length > 0 || sending.length > 0
}

export async function closeSession(botId: BotId): Promise<void> {
  await stopBot(botId)
  const live = rt.sessions.get(botId)
  if (live) closeLive(live)
}

// Claude Code keeps sessions per project folder, so a new folder starts a new conversation.
export async function changeFolder(botId: BotId): Promise<void> {
  await closeSession(botId)
  setSessionId(botId, null)
}

// The appended prompt is fixed for a session's life, so a changed job, memory,
// folder or team reopens it: now if it is quiet, else after its turn.
export function markStale(botId: BotId): void {
  const live = rt.sessions.get(botId)
  if (live) dispatch(live, { type: 'edited' })
}

// The Chief's prompt and subagents describe the whole team.
export function markChiefStale(): void {
  for (const b of listBots()) if (b.builtin === 'chief') markStale(b.id)
}

export async function applyModel(botId: BotId, model: Model): Promise<void> {
  const live = rt.sessions.get(botId)
  if (!live) return
  live.model = null
  await live.query.setModel(model ?? undefined).catch(() => dispatch(live, { type: 'edited' }))
}
