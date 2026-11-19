import type { FileHit, Upload } from '@/lib/context'
import type { Answers, BotView, Capabilities, Chat, ChatItem, Effort, MemoryEntry, Model } from '@/lib/types'
import type { Routine, Schedule } from '@/lib/routines'
import type { Usage } from '@/lib/usage'
import type { RecentFile } from '@/lib/workspace'

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  if (!res.ok) throw new Error(await errorText(res))
  return (res.status === 204 ? null : await res.json()) as T
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? `Request failed (${res.status}).`
  } catch {
    return `Request failed (${res.status}).`
  }
}

export const api = {
  health: () => call<{ apiKeySet: boolean; billingVar: string | null; user: string }>('/api/health'),
  workspace: (botId: string) =>
    call<{ name: string; folder: string; files: RecentFile[] }>(`/api/workspace?botId=${encodeURIComponent(botId)}`),
  bots: () => call<BotView[]>('/api/bots'),
  createBot: (name: string, job: string) => call<BotView>('/api/bots', { method: 'POST', json: { name, job } }),
  patchBot: (
    id: string,
    patch: {
      job?: string
      paused?: boolean
      folder?: string
      extraFolders?: string[]
      model?: Model
      browser?: boolean
      router?: boolean
      hire?: boolean
    },
  ) =>
    call<BotView>(`/api/bots/${id}`, { method: 'PATCH', json: patch }),
  capabilities: () => call<Capabilities>('/api/capabilities'),
  usage: () => call<Usage | null>('/api/usage'),
  deleteBot: (id: string) => call<null>(`/api/bots/${id}`, { method: 'DELETE' }),
  chat: (id: string) => call<Chat>(`/api/chats/${id}`),
  send: (botId: string, message: string, attachments: string[], model: NonNullable<Model> | null, effort: Effort | null) =>
    call<{ ok: true }>('/api/chat', { method: 'POST', json: { botId, message, attachments, model: model ?? undefined, effort } }),
  upload: async (botId: string, file: File) =>
    call<Upload>(`/api/attachments?botId=${encodeURIComponent(botId)}`, {
      method: 'POST',
      json: { name: file.name || 'pasted-image.png', data: await base64Of(file) },
    }),
  files: (botId: string, q: string, signal?: AbortSignal) =>
    call<FileHit[]>(`/api/files?botId=${encodeURIComponent(botId)}&q=${encodeURIComponent(q)}`, { signal }),
  pickFolder: (botId: string) =>
    call<{ path: string } | { cancelled: true }>('/api/pick-folder', { method: 'POST', json: { botId } }),
  stop: (botId: string) => call<{ stopped: boolean }>('/api/chat/stop', { method: 'POST', json: { botId } }),
  decide: (id: string, decision: 'allow' | 'deny') =>
    call<{ ok: true }>(`/api/approvals/${id}`, { method: 'POST', json: { decision } }),
  answer: (id: string, answers: Answers) => call<{ ok: true }>(`/api/questions/${id}`, { method: 'POST', json: { answers } }),
  memory: (id: string) => call<MemoryEntry[]>(`/api/memory/${id}`),
  saveMemory: (id: string, entries: MemoryEntry[]) =>
    call<MemoryEntry[]>(`/api/memory/${id}`, { method: 'PUT', json: { entries } }),
  routines: (botId: string) => call<Routine[]>(`/api/routines?botId=${encodeURIComponent(botId)}`),
  createRoutine: (botId: string, input: RoutineInput) => call<Routine>('/api/routines', { method: 'POST', json: { botId, ...input } }),
  patchRoutine: (id: string, patch: Partial<RoutineInput> & { enabled?: boolean }) =>
    call<Routine>(`/api/routines/${id}`, { method: 'PATCH', json: patch }),
  deleteRoutine: (id: string) => call<null>(`/api/routines/${id}`, { method: 'DELETE' }),
  runRoutine: (id: string) => call<Routine>(`/api/routines/${id}/run`, { method: 'POST' }),
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

export function attachmentUrl(botId: string, path: string): string {
  return `/api/attachments/file?botId=${encodeURIComponent(botId)}&path=${encodeURIComponent(path)}`
}

export type RoutineInput = { name: string; prompt: string; schedule: Schedule }

export function localError(text: string): ChatItem {
  return { kind: 'error', id: `local-${Date.now()}`, text, at: new Date().toISOString() }
}
