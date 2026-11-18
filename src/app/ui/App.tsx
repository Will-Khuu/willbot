'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BotView, ChatItem, MemoryEntry, StreamEvent } from '@/lib/types'
import { api, localError, streamChat } from './api'
import { Roster } from './Roster'
import { ChatPane } from './ChatPane'
import { Details } from './Details'

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
  const [streamingId, setStreamingId] = useState<string | null>(null)
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
      if (selectedRef.current === id) setItems(chat.items)
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

  // Runs started elsewhere (another tab, a delegation, a run left going when
  // you switched bots) have no live stream here, so follow them by polling.
  const followRun = bot !== null && bot.status !== 'idle' && streamingId !== selectedId
  useEffect(() => {
    if (!followRun) return
    const t = setInterval(() => {
      void refreshChat(selectedId)
      void refreshMemory(selectedId)
    }, 2000)
    return () => clearInterval(t)
  }, [followRun, selectedId, refreshChat, refreshMemory])

  const send = async (text: string) => {
    const id = selectedId
    setStreamingId(id)
    const onEvent = (e: StreamEvent) => {
      if (selectedRef.current !== id) return
      if (e.type === 'item' || e.type === 'item_update') setItems((cur) => upsert(cur ?? [], e.item))
      if (e.type === 'item' && e.item.kind === 'approval') void refreshBots()
    }
    void refreshBots()
    try {
      await streamChat(id, text, onEvent)
    } catch (e) {
      if (selectedRef.current === id) setItems((cur) => [...(cur ?? []), localError((e as Error).message)])
    } finally {
      setStreamingId(null)
      void refreshBots()
      void refreshMemory(id)
    }
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
            working={streamingId === bot.id || bot.status === 'working' || bot.status === 'needs_approval'}
            blocked={billingVar !== null}
            onSend={send}
            onStop={run(() => api.stop(bot.id))}
            onTakeOver={run(() => api.patchBot(bot.id, { paused: !bot.paused }))}
            onDecide={decide}
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
            onSaveAccess={(access) => run(() => api.patchBot(bot.id, { access }))()}
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
