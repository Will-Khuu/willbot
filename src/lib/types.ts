import { z } from 'zod'

export type BotId = string

export const AccessSchema = z.enum(['workspace', 'full'])
export type Access = z.infer<typeof AccessSchema>

export const BotSchema = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  tools: z.array(z.string()),
  access: AccessSchema.default('full'),
  paused: z.boolean(),
  builtin: z.literal('chief').nullable(),
  createdAt: z.string(),
})
export type Bot = z.infer<typeof BotSchema>

// The Chief stays a coordinator whatever its access says.
export function isFull(bot: Bot): boolean {
  return bot.access === 'full' && bot.builtin !== 'chief'
}
export const BotsFileSchema = z.array(BotSchema)

export type BotStatus = 'paused' | 'needs_approval' | 'working' | 'idle'
export type BotView = Bot & { status: BotStatus; statusLine: string }

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
    action: z.string(),
    state: ApprovalStateSchema,
    at: z.string(),
  }),
  z.object({ kind: z.literal('error'), id: z.string(), text: z.string(), at: z.string() }),
])
export type ChatItem = z.infer<typeof ChatItemSchema>
export type ApprovalItem = Extract<ChatItem, { kind: 'approval' }>

export const ChatSchema = z.object({
  botId: z.string(),
  sessionId: z.string().nullable(),
  items: z.array(ChatItemSchema),
})
export type Chat = z.infer<typeof ChatSchema>

export type StreamEvent =
  | { type: 'item'; item: ChatItem }
  | { type: 'item_update'; item: ChatItem }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type MemoryEntry = { date: string; text: string }

export type Connector = { name: string; status: string; tools: number }
export type Capabilities = { plugins: string[]; skills: number; connectors: Connector[] } | { error: string }
