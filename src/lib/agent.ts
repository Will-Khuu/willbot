import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  createSdkMcpServer,
  query,
  tool,
  type AgentDefinition,
  type CanUseTool,
  type HookCallback,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { classifyTool } from './policy'
import { endRun, requestApproval, startRun } from './runtime'
import { appendMemory, getBot, listBots, readChat, readMemory, setSessionId, upsertChatItem, workspaceDir } from './store'
import type { Bot, BotId, ChatItem, StreamEvent } from './types'

const MODELS = { chief: 'sonnet', worker: 'haiku' } as const
const MAX_TURNS = { chief: 12, worker: 8 } as const
const REMEMBER = 'mcp__willbot__remember'
const DENY_MESSAGE = 'The user said not yet. Do not retry this action; tell the user what you wanted to do.'

const BILLING_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const
const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'CLAUDE_CONFIG_DIR']

export function billingOverride(): string | null {
  return BILLING_VARS.find((name) => process.env[name]) ?? null
}

// The SDK does not merge this with process.env, so nothing else reaches the CLI.
function sdkEnv(): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_AGENT_SDK_CLIENT_APP: 'will-bot/0.1.0' }
  for (const name of ENV_ALLOWLIST) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

function systemPrompt(bot: Bot, opts: { canRemember: boolean; team?: Bot[] }): string {
  const memory = readMemory(bot.id)
  const lines = [
    `You are ${bot.name}, one bot in a small team the user runs on their own Mac.`,
    `Your job: ${bot.job}`,
    `Your workspace folder is ${workspaceDir(bot.id)}. Only read and write files inside it, and always use absolute paths.`,
    '',
    'Rules:',
    '- Keep replies short: a few sentences unless asked for more.',
    '- Ask before risky actions. Shell commands, deleting files and anything that sends or posts need the user to approve.',
    '- If the user denies an action, do not retry it. Say what you wanted to do.',
    '- Never read .env files or anything that looks like a secret.',
  ]
  if (opts.canRemember) lines.push('- When the user tells you a durable fact or preference, save it with the remember tool.')
  if (opts.team?.length) {
    lines.push(
      '- Delegate work to the other bots with the Agent tool, using their id as subagent_type. Then give the user a short summary.',
      '',
      'Your team:',
      ...opts.team.map((b) => `- ${b.id}: ${b.name}. ${b.job}`),
    )
  }
  lines.push('', 'Memory:', ...(memory.length ? memory.map((m) => `- ${m.date}: ${m.text}`) : ['(nothing saved yet)']))
  return lines.join('\n')
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
  Agent: (i, nameOf) => `Asked ${nameOf(str(i, 'subagent_type'))}`,
  [REMEMBER]: (i) => `Remembered: ${short(str(i, 'note'), 60)}`,
}

function activityLabel(toolName: string, input: Record<string, unknown>, nameOf: (id: string) => string): string {
  return ACTIVITY[toolName]?.(input, nameOf) ?? `Used ${toolName}`
}

function describeAction(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') return `Run this shell command: ${str(input, 'command')}`
  return `Use ${toolName} with ${short(JSON.stringify(input), 300)}`
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

function agentDefinitions(others: Bot[]): Record<string, AgentDefinition> {
  return Object.fromEntries(
    others.map((b) => {
      const memo = readMemory(b.id)
        .slice(0, 3)
        .map((m) => m.text)
        .join(' ')
      return [
        b.id,
        {
          description: `${b.name}: ${b.job}${memo ? ` Notes: ${memo}` : ''}`,
          prompt: systemPrompt(b, { canRemember: false }),
          tools: b.tools.filter((t) => t !== 'Agent'),
          model: MODELS.worker,
          maxTurns: MAX_TURNS.worker,
          background: false,
        },
      ]
    }),
  )
}

export type RunHandle = { done: Promise<void> }

export function runBot(botId: BotId, message: string, emit: (event: StreamEvent) => void): RunHandle | null {
  const bot = getBot(botId)
  if (!bot) return null

  const allBots = listBots()
  const names = new Map(allBots.map((b) => [b.id, b.name]))
  const nameOf = (id: string) => names.get(id) ?? id
  const isChief = bot.builtin === 'chief'
  const team = isChief ? allBots.filter((b) => b.id !== bot.id && !b.paused) : []
  const workspaces = new Map<BotId, string>([[bot.id, workspaceDir(bot.id)], ...team.map((b) => [b.id, workspaceDir(b.id)] as const)])
  const workspaceOf = (id: BotId) => workspaces.get(id) ?? workspaces.get(bot.id)!
  const ownTools = (b: Bot) => b.tools.filter((t) => t !== 'Agent' || (isChief && b.id === bot.id))
  // The session-level `tools` option caps subagents too, so it must be the
  // union of every bot's tools; the hook then holds each bot to its own list.
  // remember writes to the run owner's memory, so only the owner gets it.
  const toolsOf = new Map<BotId, Set<string>>(
    [bot, ...team].map((b) => [b.id, new Set(b.id === bot.id ? [...ownTools(b), REMEMBER] : ownTools(b))]),
  )
  const sessionTools = [...new Set([bot, ...team].flatMap(ownTools))]
  const isTeam = (id: string) => id !== bot.id && workspaces.has(id)
  const prompt = systemPrompt(bot, { canRemember: true, team })
  const resume = readChat(botId).sessionId ?? undefined
  const agents = isChief ? agentDefinitions(team) : undefined

  // Everything above can throw (disk reads, mkdir); claiming the slot after it
  // means a setup failure never leaves the bot stuck as working.
  const run = startRun(botId)
  if (!run) return null

  // tool_use id -> bot that made the call, so canUseTool (which only sees a
  // toolUseID) can check and label a subagent's call against its own workspace.
  const caller = new Map<string, BotId>()
  // Agent tool_use id -> delegated bot, to attribute subagent messages.
  const delegations = new Map<string, BotId>()

  const save = (item: ChatItem, update = false) => {
    upsertChatItem(botId, item)
    emit({ type: update ? 'item_update' : 'item', item })
  }
  const now = () => new Date().toISOString()
  const id = () => randomUUID()

  const refuse = (reason: string) => ({
    hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: reason },
  })
  // Paused and deleted are re-read on every call: the user can take over or
  // delete a bot while it works as a subagent.
  const unavailable = (id: BotId): string | null => {
    const current = getBot(id)
    if (!current) return 'That bot was deleted.'
    return current.paused ? `${current.name} is paused by the user.` : null
  }

  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    if (input.agent_id && !(input.agent_type && isTeam(input.agent_type))) return refuse('Unknown agent.')
    const actor = input.agent_id ? input.agent_type! : bot.id
    caller.set(input.tool_use_id, actor)
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>
    const actorUnavailable = unavailable(actor)
    if (actorUnavailable) return refuse(actorUnavailable)
    if (!toolsOf.get(actor)?.has(input.tool_name)) {
      return refuse(`${input.tool_name} is not one of your tools. Delegate it to a bot that has it.`)
    }
    if (input.tool_name === 'Agent') {
      const target = str(toolInput, 'subagent_type')
      if (!isTeam(target)) return refuse('Delegate only to your team, using a bot id as subagent_type.')
      const targetUnavailable = unavailable(target)
      if (targetUnavailable) return refuse(targetUnavailable)
    }
    const decision = classifyTool(input.tool_name, toolInput, workspaceOf(actor))
    if (decision.kind === 'deny') return refuse(decision.reason)
    // The CLI auto-allows commands it judges read-only (`ls`), so returning
    // nothing here would skip canUseTool. 'ask' forces the approval path.
    if (decision.kind === 'ask') {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }
    }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: decision.input } }
  }

  const canUseTool: CanUseTool = async (toolName, input, { signal, toolUseID }) => {
    const actor = caller.get(toolUseID) ?? bot.id
    const decision = classifyTool(toolName, input, workspaceOf(actor))
    if (decision.kind === 'allow') return { behavior: 'allow', updatedInput: decision.input }
    if (decision.kind === 'deny') return { behavior: 'deny', message: decision.reason }
    const action = describeAction(toolName, input)
    const approval = requestApproval(actor, bot.id, action, signal)
    const card: ChatItem = { kind: 'approval', id: approval.id, botId: actor, action, state: 'pending', at: now() }
    save(card)
    const outcome = await approval.outcome
    save({ ...card, state: outcome }, true)
    if (run.abort.signal.aborted) return { behavior: 'deny', message: 'Stopped.' }
    return outcome === 'allowed' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: DENY_MESSAGE }
  }

  const options: Options = {
    systemPrompt: prompt,
    cwd: workspaceOf(bot.id),
    additionalDirectories: team.map((b) => workspaceOf(b.id)),
    resume,
    maxTurns: isChief ? MAX_TURNS.chief : MAX_TURNS.worker,
    model: isChief ? MODELS.chief : MODELS.worker,
    abortController: run.abort,
    tools: sessionTools,
    mcpServers: { willbot: rememberServer(bot.id) },
    agents,
    hooks: { PreToolUse: [{ hooks: [guard] }] },
    canUseTool,
    settingSources: [],
    permissionMode: 'default',
    env: sdkEnv(),
  }

  let reported = false
  const fail = (text: string) => {
    reported = true
    const hint = /authenticat|oauth|log ?in/i.test(text)
      ? '\nLog in with your Claude plan: run `claude` in a terminal, then /login, and try again.'
      : ''
    save({ kind: 'error', id: id(), text: text + hint, at: now() })
  }

  const handle = (msg: SDKMessage) => {
    // Only a session that produced a real turn is worth resuming.
    if ((msg.type === 'assistant' && !msg.error) || (msg.type === 'result' && !msg.is_error)) {
      setSessionId(botId, msg.session_id)
    }
    if (msg.type === 'assistant') {
      if (msg.error) return
      const speaker = msg.parent_tool_use_id ? (delegations.get(msg.parent_tool_use_id) ?? bot.id) : bot.id
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          save({ kind: 'assistant', id: id(), botId: speaker, text: block.text.trim(), at: now() })
        } else if (block.type === 'tool_use') {
          const input = (block.input ?? {}) as Record<string, unknown>
          if (block.name === 'Agent') {
            const target = str(input, 'subagent_type')
            if (workspaces.has(target)) {
              delegations.set(block.id, target)
              run.delegated.add(target)
            }
          }
          save({ kind: 'activity', id: id(), botId: speaker, label: activityLabel(block.name, input, nameOf), at: now() })
        }
      }
    } else if (msg.type === 'user' && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue
        const target = delegations.get(block.tool_use_id)
        if (!target) continue
        delegations.delete(block.tool_use_id)
        if (![...delegations.values()].includes(target)) run.delegated.delete(target)
      }
    } else if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        if (msg.is_error) fail(msg.result || 'The run failed.')
      } else if (msg.subtype === 'error_max_turns') {
        fail(`Stopped at the turn limit (${msg.num_turns} turns). Send another message to continue.`)
      } else {
        fail(msg.errors.join('\n') || `The run ended early (${msg.subtype}).`)
      }
    }
  }

  const done = (async () => {
    try {
      save({ kind: 'user', id: id(), text: message, at: now() })
      for await (const msg of query({ prompt: message, options })) handle(msg)
    } catch (e) {
      if (run.abort.signal.aborted) save({ kind: 'error', id: id(), text: 'Stopped.', at: now() })
      else if (!reported) fail(e instanceof Error ? e.message : String(e))
    } finally {
      endRun(botId, run)
      emit({ type: 'done' })
    }
  })()

  return { done }
}
