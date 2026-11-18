import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseMemory, serializeMemory, oneLine, today } from './memory'
import { RoutinesFileSchema, type Routine } from './routines'
import {
  BotsFileSchema,
  ChatSchema,
  type Bot,
  type BotId,
  type Chat,
  type ChatItem,
  type MemoryEntry,
} from './types'
import { UsageSchema, type Usage } from './usage'

const DATA_DIR = path.join(process.cwd(), 'data')
const BOTS_FILE = path.join(DATA_DIR, 'bots.json')
const USAGE_FILE = path.join(DATA_DIR, 'usage.json')
const ROUTINES_FILE = path.join(DATA_DIR, 'routines.json')
const BOT_ID = /^[a-z0-9-]{1,40}$/

type Seed = Pick<Bot, 'id' | 'name' | 'job' | 'builtin'>

const SEED: Seed[] = [
  { id: 'chief', name: 'Chief of Staff', job: 'Coordinates the other employees and gives me short summaries.', builtin: 'chief' },
  {
    id: 'research',
    name: 'Research Bot',
    job: 'Researches a topic on the web and writes a short brief with sources to its folder.',
    builtin: null,
  },
  { id: 'builder', name: 'Builder Bot', job: 'Makes small code changes in its folder.', builtin: null },
]

function defaultFolder(id: BotId): string {
  return path.join(DATA_DIR, 'workspaces', id)
}

function newBot(seed: Seed, createdAt: string): Bot {
  return {
    ...seed,
    folder: defaultFolder(seed.id),
    model: null,
    browser: seed.id === 'builder',
    router: seed.id === 'builder',
    paused: false,
    createdAt,
  }
}

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
    const bots = SEED.map((b) => newBot(b, now))
    saveBots(bots)
    return bots
  }
  return BotsFileSchema.parse(JSON.parse(raw)).map((b) => ({
    ...b,
    folder: b.folder ?? defaultFolder(b.id),
    browser: b.browser ?? b.id === 'builder',
    router: b.router ?? b.id === 'builder',
  }))
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
  const bot = newBot({ id: `${slug}-${randomUUID().slice(0, 4)}`, name, job, builtin: null }, new Date().toISOString())
  saveBots([...bots, bot])
  return bot
}

export type BotPatch = Partial<Pick<Bot, 'name' | 'job' | 'paused' | 'folder' | 'model' | 'browser' | 'router'>>

export function updateBot(id: BotId, patch: BotPatch): Bot | null {
  const bots = listBots()
  const i = bots.findIndex((b) => b.id === id)
  if (i < 0) return null
  const next = { ...bots[i]!, ...patch }
  bots[i] = next
  saveBots(bots)
  return next
}

// The working folder is left on disk: it may hold files the user still wants.
export function deleteBot(id: BotId): void {
  saveBots(listBots().filter((b) => b.id !== id))
  fs.rmSync(chatFile(id), { force: true })
  fs.rmSync(memoryFile(id), { force: true })
  const routines = readRoutines()
  if (routines.some((r) => r.botId === id)) saveRoutines(routines.filter((r) => r.botId !== id))
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

export function setSessionId(id: BotId, sessionId: string | null): void {
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

// The default folder is created on first use; a folder the user chose must already exist.
export function ensureFolder(bot: Bot): string {
  if (bot.folder === defaultFolder(bot.id)) fs.mkdirSync(bot.folder, { recursive: true })
  return fs.realpathSync(bot.folder)
}

export function readUsage(): Usage | null {
  const raw = readText(USAGE_FILE)
  if (raw === null) return null
  try {
    return UsageSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeUsage(usage: Usage): void {
  writeAtomic(USAGE_FILE, JSON.stringify(usage, null, 2) + '\n')
}

export function readRoutines(): Routine[] {
  const raw = readText(ROUTINES_FILE)
  return raw === null ? [] : RoutinesFileSchema.parse(JSON.parse(raw))
}

export function saveRoutines(routines: Routine[]): void {
  writeAtomic(ROUTINES_FILE, JSON.stringify(routines, null, 2) + '\n')
}
