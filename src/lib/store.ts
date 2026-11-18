import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseMemory, serializeMemory, oneLine, today } from './memory'
import {
  BotsFileSchema,
  ChatSchema,
  type Bot,
  type BotId,
  type Chat,
  type ChatItem,
  type MemoryEntry,
} from './types'

const DATA_DIR = path.join(process.cwd(), 'data')
const BOTS_FILE = path.join(DATA_DIR, 'bots.json')
const BOT_ID = /^[a-z0-9-]{1,40}$/

export const NEW_BOT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch']

const SEED: Omit<Bot, 'createdAt'>[] = [
  {
    id: 'chief',
    name: 'Chief of Staff',
    job: 'Coordinates the other bots and gives me short summaries.',
    tools: ['Read', 'Glob', 'Grep', 'Agent'],
    access: 'full',
    paused: false,
    builtin: 'chief',
  },
  {
    id: 'research',
    name: 'Research Bot',
    job: 'Researches a topic with the web tools and writes a short brief with sources to its workspace.',
    tools: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Glob', 'Grep'],
    access: 'full',
    paused: false,
    builtin: null,
  },
  {
    id: 'builder',
    name: 'Builder Bot',
    job: 'Makes small code changes inside its workspace folder only.',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    access: 'full',
    paused: false,
    builtin: null,
  },
]

function writeAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(tmp, contents)
  fs.renameSync(tmp, file)
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export function isBotId(id: string): boolean {
  return BOT_ID.test(id)
}

export function listBots(): Bot[] {
  const raw = readText(BOTS_FILE)
  if (raw === null) {
    const now = new Date().toISOString()
    const bots = SEED.map((b) => ({ ...b, createdAt: now }))
    saveBots(bots)
    return bots
  }
  return BotsFileSchema.parse(JSON.parse(raw))
}

function saveBots(bots: Bot[]): void {
  writeAtomic(BOTS_FILE, JSON.stringify(bots, null, 2) + '\n')
}

export function getBot(id: BotId): Bot | null {
  return listBots().find((b) => b.id === id) ?? null
}

export function createBot(name: string, job: string): Bot {
  const bots = listBots()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'bot'
  const bot: Bot = {
    id: `${slug}-${randomUUID().slice(0, 4)}`,
    name,
    job,
    tools: NEW_BOT_TOOLS,
    access: 'full',
    paused: false,
    builtin: null,
    createdAt: new Date().toISOString(),
  }
  saveBots([...bots, bot])
  return bot
}

export function updateBot(id: BotId, patch: Partial<Pick<Bot, 'name' | 'job' | 'paused' | 'access'>>): Bot | null {
  const bots = listBots()
  const i = bots.findIndex((b) => b.id === id)
  if (i < 0) return null
  const next = { ...bots[i]!, ...patch }
  bots[i] = next
  saveBots(bots)
  return next
}

// The workspace folder is left on disk: it may hold files the user still wants.
export function deleteBot(id: BotId): void {
  saveBots(listBots().filter((b) => b.id !== id))
  fs.rmSync(chatFile(id), { force: true })
  fs.rmSync(memoryFile(id), { force: true })
}

function chatFile(id: BotId): string {
  return path.join(DATA_DIR, 'chats', `${id}.json`)
}

export function readChat(id: BotId): Chat {
  const raw = readText(chatFile(id))
  if (raw === null) return { botId: id, sessionId: null, items: [] }
  return ChatSchema.parse(JSON.parse(raw))
}

function writeChat(chat: Chat): void {
  writeAtomic(chatFile(chat.botId), JSON.stringify(chat, null, 2) + '\n')
}

export function upsertChatItem(id: BotId, item: ChatItem): void {
  const chat = readChat(id)
  const i = chat.items.findIndex((x) => x.id === item.id)
  if (i < 0) chat.items.push(item)
  else chat.items[i] = item
  writeChat(chat)
}

export function setSessionId(id: BotId, sessionId: string): void {
  const chat = readChat(id)
  if (chat.sessionId === sessionId) return
  writeChat({ ...chat, sessionId })
}

function memoryFile(id: BotId): string {
  return path.join(DATA_DIR, 'memory', `${id}.md`)
}

export function readMemory(id: BotId): MemoryEntry[] {
  return parseMemory(readText(memoryFile(id)) ?? '')
}

export function writeMemory(id: BotId, entries: MemoryEntry[]): void {
  writeAtomic(memoryFile(id), serializeMemory(entries))
}

export function appendMemory(id: BotId, note: string): MemoryEntry {
  const entry = { date: today(), text: oneLine(note) }
  writeMemory(id, [...readMemory(id), entry])
  return entry
}

export function workspaceDir(id: BotId): string {
  const dir = path.join(DATA_DIR, 'workspaces', id)
  fs.mkdirSync(dir, { recursive: true })
  return fs.realpathSync(dir)
}
