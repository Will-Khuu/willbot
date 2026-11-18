import type { Answers, BotView, Capabilities, Chat, ChatItem, MemoryEntry, Model } from '@/lib/types'

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
  health: () => call<{ apiKeySet: boolean; billingVar: string | null }>('/api/health'),
  bots: () => call<BotView[]>('/api/bots'),
  createBot: (name: string, job: string) => call<BotView>('/api/bots', { method: 'POST', json: { name, job } }),
  patchBot: (id: string, patch: { job?: string; paused?: boolean; folder?: string; model?: Model; browser?: boolean }) =>
    call<BotView>(`/api/bots/${id}`, { method: 'PATCH', json: patch }),
  capabilities: () => call<Capabilities>('/api/capabilities'),
  deleteBot: (id: string) => call<null>(`/api/bots/${id}`, { method: 'DELETE' }),
  chat: (id: string) => call<Chat>(`/api/chats/${id}`),
  send: (botId: string, message: string) => call<{ ok: true }>('/api/chat', { method: 'POST', json: { botId, message } }),
  stop: (botId: string) => call<{ stopped: boolean }>('/api/chat/stop', { method: 'POST', json: { botId } }),
  decide: (id: string, decision: 'allow' | 'deny') =>
    call<{ ok: true }>(`/api/approvals/${id}`, { method: 'POST', json: { decision } }),
  answer: (id: string, answers: Answers) => call<{ ok: true }>(`/api/questions/${id}`, { method: 'POST', json: { answers } }),
  memory: (id: string) => call<MemoryEntry[]>(`/api/memory/${id}`),
  saveMemory: (id: string, entries: MemoryEntry[]) =>
    call<MemoryEntry[]>(`/api/memory/${id}`, { method: 'PUT', json: { entries } }),
}

export function localError(text: string): ChatItem {
  return { kind: 'error', id: `local-${Date.now()}`, text, at: new Date().toISOString() }
}
