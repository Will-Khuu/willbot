'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Answers, BotView, ChatItem, MemoryEntry, Model, StreamEvent } from '@/lib/types'
import { api, localError } from './api'
import { Roster } from './Roster'
import { ChatPane } from './ChatPane'
import { Details } from './Details'

function upsertMissing(items: ChatItem[], item: ChatItem): ChatItem[] {
  return items.some((x) => x.id === item.id) ? items : [...items, item]
}

function upsert(items: ChatItem[], item: ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === item.id)
  if (i < 0) return [...items, item]
  const next = items.slice()
  next[i] = item
  return next
}

export function App() {
  const [bots, setBots] = useState<BotView[]>([])
  const [selectedId, setSelectedId] = useState('chief')
  const [items, setItems] = useState<ChatItem[] | null>(null)
  const [memory, setMemory] = useState<MemoryEntry[]>([])
  const [billingVar, setBillingVar] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  const bot = bots.find((b) => b.id === selectedId) ?? null
  const busy = bots.some((b) => b.status !== 'idle')

  const refreshBots = useCallback(async () => {
    try {
      setBots(await api.bots())
    } catch {}
  }, [])

  const refreshChat = useCallback(async (id: string) => {
    try {
      const chat = await api.chat(id)
      // Items streamed in while the file was being read are kept.
      if (selectedRef.current === id) setItems((cur) => (cur ?? []).reduce(upsertMissing, chat.items))
    } catch {}
  }, [])

  const refreshMemory = useCallback(async (id: string) => {
    try {
      const entries = await api.memory(id)
      if (selectedRef.current === id) setMemory(entries)
    } catch {}
  }, [])

  useEffect(() => {
    void refreshBots()
    api.health().then((h) => setBillingVar(h.apiKeySet ? h.billingVar : null), () => {})
  }, [refreshBots])

  useEffect(() => {
    const t = setInterval(refreshBots, busy ? 2000 : 10000)
    return () => clearInterval(t)
  }, [busy, refreshBots])

  useEffect(() => {
    setItems(null)
    setMemory([])
    void refreshChat(selectedId)
    void refreshMemory(selectedId)
  }, [selectedId, refreshChat, refreshMemory])

  // One stream per selected employee carries everything its session does,
  // whoever started the turn. A reconnect reloads the chat file to catch up.
  useEffect(() => {
    const id = selectedId
    const source = new EventSource(`/api/chats/${id}/stream`)
    source.onopen = () => void refreshChat(id)
    source.onmessage = (msg: MessageEvent<string>) => {
      if (selectedRef.current !== id) return
      const e = JSON.parse(msg.data) as StreamEvent
      if (e.type === 'status') {
        void refreshBots()
        void refreshMemory(id)
        return
      }
      setItems((cur) => upsert(cur ?? [], e.item))
      if (e.item.kind === 'approval' || e.item.kind === 'question') void refreshBots()
    }
    return () => source.close()
  }, [selectedId, refreshBots, refreshChat, refreshMemory])

  const send = async (text: string) => {
    const id = selectedId
    try {
      await api.send(id, text)
    } catch (e) {
      if (selectedRef.current === id) setItems((cur) => [...(cur ?? []), localError((e as Error).message)])
    }
    void refreshBots()
  }

  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn()
    } catch (e) {
      setItems((cur) => [...(cur ?? []), localError((e as Error).message)])
    }
    await refreshBots()
  }

  const decide = async (approvalId: string, decision: 'allow' | 'deny') => {
    setItems((cur) =>
      (cur ?? []).map((x) =>
        x.id === approvalId && x.kind === 'approval' ? { ...x, state: decision === 'allow' ? 'allowed' : 'denied' } : x,
      ),
    )
    await run(() => api.decide(approvalId, decision))()
    await refreshChat(selectedId)
  }

  const answer = async (questionId: string, answers: Answers) => {
    setItems((cur) =>
      (cur ?? []).map((x) => (x.id === questionId && x.kind === 'question' ? { ...x, answers, state: 'answered' } : x)),
    )
    await run(() => api.answer(questionId, answers))()
    await refreshChat(selectedId)
  }

  const patch = (body: { folder?: string; model?: Model; browser?: boolean }) => async () => {
    await api.patchBot(selectedId, body)
    await refreshBots()
  }

  const saveMemory = async (entries: MemoryEntry[]) => {
    setMemory(entries)
    try {
      setMemory(await api.saveMemory(selectedId, entries))
    } catch (e) {
      setItems((cur) => [...(cur ?? []), localError((e as Error).message)])
      void refreshMemory(selectedId)
    }
  }

  return (
    <div className="shell">
      {billingVar && (
        <div className="keyBanner" role="alert">
          {billingVar === 'ANTHROPIC_API_KEY' ? 'API key set' : `${billingVar} is set`}: usage will be billed to the API,
          not your plan. Unset {billingVar} and restart the server to use your Claude plan. Bots will not run until then.
        </div>
      )}
      <div className="columns">
        <Roster
          bots={bots}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            setDetailsOpen(false)
          }}
          onCreate={async (name, job) => {
            const created = await api.createBot(name, job)
            await refreshBots()
            setSelectedId(created.id)
          }}
        />
        {bot ? (
          <ChatPane
            bot={bot}
            bots={bots}
            items={items ?? []}
            loading={items === null}
            working={bot.status === 'working' || bot.status === 'needs_approval'}
            blocked={billingVar !== null}
            onSend={send}
            onStop={run(() => api.stop(bot.id))}
            onTakeOver={run(() => api.patchBot(bot.id, { paused: !bot.paused }))}
            onDecide={decide}
            onAnswer={answer}
            onToggleDetails={() => setDetailsOpen((o) => !o)}
            detailsOpen={detailsOpen}
          />
        ) : (
          <main className="chat" aria-busy="true" />
        )}
        {bot && (
          <Details
            bot={bot}
            memory={memory}
            open={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            onSaveJob={async (job) => {
              await api.patchBot(bot.id, { job })
              await refreshBots()
            }}
            onSaveMemory={saveMemory}
            onSaveFolder={(folder) => patch({ folder })()}
            onSaveModel={(model) => run(patch({ model }))()}
            onSaveBrowser={(browser) => run(patch({ browser }))()}
            onDelete={async () => {
              await api.deleteBot(bot.id)
              setSelectedId('chief')
              await refreshBots()
            }}
          />
        )}
      </div>
    </div>
  )
}
