import { z } from 'zod'
import { QuestionSchema } from './questions'

export type { Answers, Question } from './questions'

export type BotId = string

export const MODELS = ['haiku', 'sonnet', 'opus'] as const
export const ModelSchema = z.enum(MODELS).nullable()
export type Model = z.infer<typeof ModelSchema>

// Unknown keys from older files (tools, access) are dropped by z.object.
// folder and browser have per-bot defaults that store.ts fills in.
export const StoredBotSchema = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  folder: z.string().optional(),
  model: ModelSchema.default(null),
  browser: z.boolean().optional(),
  paused: z.boolean(),
  builtin: z.literal('chief').nullable(),
  createdAt: z.string(),
})
export type Bot = Required<z.infer<typeof StoredBotSchema>>
export const BotsFileSchema = z.array(StoredBotSchema)

export type BotStatus = 'paused' | 'needs_approval' | 'working' | 'idle'
export type BotView = Bot & { status: BotStatus; statusLine: string; delegatedBy: BotId | null }

export const ApprovalStateSchema = z.enum(['pending', 'allowed', 'denied', 'expired'])
export type ApprovalState = z.infer<typeof ApprovalStateSchema>

export const ChatItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal('assistant'), id: z.string(), botId: z.string(), text: z.string(), at: z.string() }),
  z.object({ kind: z.literal('activity'), id: z.string(), botId: z.string(), label: z.string(), at: z.string() }),
  z.object({
    kind: z.literal('approval'),
    id: z.string(),
    botId: z.string(),
    // The prompt sentence, as Claude Code words it.
    action: z.string(),
    detail: z.string().nullable().default(null),
    // Preformatted text: the plan for ExitPlanMode, else the raw input when Claude Code sent no title.
    body: z.string().nullable().default(null),
    plan: z.boolean().default(false),
    state: ApprovalStateSchema,
    at: z.string(),
  }),
  z.object({
    kind: z.literal('question'),
    id: z.string(),
    botId: z.string(),
    questions: z.array(QuestionSchema),
    answers: z.record(z.string(), z.string()).nullable(),
    state: z.enum(['pending', 'answered', 'expired']),
    at: z.string(),
  }),
  z.object({ kind: z.literal('error'), id: z.string(), text: z.string(), at: z.string() }),
])
export type ChatItem = z.infer<typeof ChatItemSchema>
export type ApprovalItem = Extract<ChatItem, { kind: 'approval' }>
export type QuestionItem = Extract<ChatItem, { kind: 'question' }>

export const ChatSchema = z.object({
  botId: z.string(),
  sessionId: z.string().nullable(),
  items: z.array(ChatItemSchema),
})
export type Chat = z.infer<typeof ChatSchema>

export type StreamEvent = { type: 'item'; item: ChatItem } | { type: 'item_update'; item: ChatItem } | { type: 'status' }

export type MemoryEntry = { date: string; text: string }

export type Connector = { name: string; status: string; tools: number }
export type Capabilities = { plugins: string[]; skills: number; connectors: Connector[] } | { error: string }
