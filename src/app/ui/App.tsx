'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { chatMarkdown } from '@/lib/chatlog'
import type { Answers, BotView, Capabilities, ChatItem, Effort, MemoryEntry, Model, StreamEvent } from '@/lib/types'
import type { Usage } from '@/lib/usage'
import { api, localError } from './api'
import { Roster } from './Roster'
import { ChatPane } from './ChatPane'
import { Details, type PanelTarget } from './Details'
import { Plugins } from './Plugins'
import { useRefit } from './refit'
import { useUnread } from './seen'
import { limitNotice } from './UsageMeter'

// Below this width the right panel overlays the chat instead of taking a column.
const WIDE = '(min-width: 1200px)'

function isWide(): boolean {
  return window.matchMedia(WIDE).matches
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
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelFocus, setPanelFocus] = useState<{ target: PanelTarget; n: number }>({ target: 'top', n: 0 })
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Bumped when an employee changes routines, so the panel reloads them.
  const [routinesRev, setRoutinesRev] = useState(0)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  // Item id -> the change number of its last live update (stream or a click here).
  const changes = useRef({ n: 0, at: new Map<string, number>() })
  const touch = (id: string) => changes.current.at.set(id, ++changes.current.n)

  const bot = bots.find((b) => b.id === selectedId) ?? null
  const busy = bots.some((b) => b.status !== 'idle')
  const limit = limitNotice(usage, now)
  const isUnread = useUnread(bots, pluginsOpen ? null : selectedId)
  useRefit(selectedId, setSelectedId)
  const activity = `${items?.length ?? 0}:${items?.at(-1)?.id ?? ''}:${bot?.status ?? ''}`

  const refreshBots = useCallback(async () => {
    try {
      setBots(await api.bots())
    } catch {}
  }, [])

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await api.usage())
    } catch {}
    setNow(Date.now())
  }, [])

  const refreshChat = useCallback(async (id: string) => {
    const since = changes.current.n
    try {
      const chat = await api.chat(id)
      if (selectedRef.current !== id) return
      // A copy that changed live after the read began is newer than the file's.
      const newer = (itemId: string) => (changes.current.at.get(itemId) ?? -1) > since
      setItems((cur) => {
        const live = new Map((cur ?? []).map((x) => [x.id, x]))
        const merged = chat.items.map((x) => (newer(x.id) ? (live.get(x.id) ?? x) : x))
        const fetched = new Set(chat.items.map((x) => x.id))
        return [...merged, ...(cur ?? []).filter((x) => !fetched.has(x.id))]
      })
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
    api.health().then(
      (h) => {
        setBillingVar(h.apiKeySet ? h.billingVar : null)
        setUser(h.user)
      },
      () => {},
    )
    api.capabilities().then(setCaps, (e: Error) => setCaps({ error: e.message }))
    setPanelOpen(isWide())
  }, [refreshBots])

  useEffect(() => {
    const t = setInterval(refreshBots, busy ? 2000 : 10000)
    return () => clearInterval(t)
  }, [busy, refreshBots])

  // Usage only arrives with real model calls, so poll faster while someone works.
  useEffect(() => {
    void refreshUsage()
    const t = setInterval(refreshUsage, busy ? 15_000 : 60_000)
    return () => clearInterval(t)
  }, [busy, refreshUsage])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setItems(null)
    setMemory([])
    changes.current.at.clear()
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
        void refreshUsage()
        return
      }
      if (e.type === 'routines') {
        setRoutinesRev((n) => n + 1)
        void refreshBots()
        return
      }
      changes.current.at.set(e.item.id, ++changes.current.n)
      setItems((cur) => upsert(cur ?? [], e.item))
      if (e.item.kind === 'approval' || e.item.kind === 'question') void refreshBots()
    }
    return () => source.close()
  }, [selectedId, refreshBots, refreshChat, refreshMemory, refreshUsage])

  const send = async (text: string, attachments: string[], model: NonNullable<Model> | null, effort: Effort | null) => {
    const id = selectedId
    try {
      await api.send(id, text, attachments, model, effort)
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
    touch(approvalId)
    setItems((cur) =>
      (cur ?? []).map((x) =>
        x.id === approvalId && x.kind === 'approval' ? { ...x, state: decision === 'allow' ? 'allowed' : 'denied' } : x,
      ),
    )
    await run(() => api.decide(approvalId, decision))()
    await refreshChat(selectedId)
  }

  const answer = async (questionId: string, answers: Answers) => {
    touch(questionId)
    setItems((cur) =>
      (cur ?? []).map((x) => (x.id === questionId && x.kind === 'question' ? { ...x, answers, state: 'answered' } : x)),
    )
    await run(() => api.answer(questionId, answers))()
    await refreshChat(selectedId)
  }

  const patch = (body: { folder?: string; extraFolders?: string[]; model?: Model; browser?: boolean; router?: boolean; hire?: boolean }) => async () => {
    await api.patchBot(selectedId, body)
    await refreshBots()
  }

  const openPanel = (target: PanelTarget) => {
    setPanelOpen(true)
    setPanelFocus((f) => ({ target, n: f.n + 1 }))
  }

  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? id

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
          not your plan. Remove {billingVar} from your shell or Claude Code settings, then restart the server, to use your
          Claude plan. Bots will not run until then.
        </div>
      )}
      <div className={`columns${panelOpen && bot && !pluginsOpen ? ' withPanel' : ''}`}>
        <Roster
          bots={bots}
          selectedId={selectedId}
          pluginsOpen={pluginsOpen}
          usage={usage}
          now={now}
          user={user}
          isUnread={isUnread}
          onSelect={(id) => {
            setSelectedId(id)
            setPluginsOpen(false)
            if (!isWide()) setPanelOpen(false)
          }}
          onCreate={async (name, job) => {
            const created = await api.createBot(name, job)
            await refreshBots()
            setSelectedId(created.id)
            setPluginsOpen(false)
          }}
          onPlugins={() => setPluginsOpen(true)}
        />
        {pluginsOpen ? (
          <Plugins caps={caps} onBack={() => setPluginsOpen(false)} />
        ) : bot ? (
          <ChatPane
            bot={bot}
            bots={bots}
            items={items ?? []}
            loading={items === null}
            working={bot.status === 'working' || bot.status === 'needs_approval'}
            blocked={billingVar !== null}
            now={now}
            limit={limit}
            onSend={send}
            onStop={run(() => api.stop(bot.id))}
            onTakeOver={run(() => api.patchBot(bot.id, { paused: !bot.paused }))}
            onDecide={decide}
            onAnswer={answer}
            panelOpen={panelOpen}
            models={caps && !('error' in caps) ? caps.models : {}}
            onTogglePanel={() => (panelOpen ? setPanelOpen(false) : openPanel('top'))}
            onDetails={() => openPanel('job')}
          />
        ) : (
          <main className="chat" aria-busy="true" />
        )}
        {bot && !pluginsOpen && (
          <Details
            bot={bot}
            memory={memory}
            caps={caps}
            open={panelOpen}
            focus={panelFocus}
            activity={activity}
            routinesRev={routinesRev}
            now={now}
            shareText={() => chatMarkdown(bot.name, items ?? [], nameOf)}
            onClose={() => setPanelOpen(false)}
            onSaveJob={async (job) => {
              await api.patchBot(bot.id, { job })
              await refreshBots()
            }}
            onSaveMemory={saveMemory}
            onSaveFolder={(folder) => patch({ folder })()}
            onSaveExtraFolders={(extraFolders) => patch({ extraFolders })()}
            onSaveModel={(model) => run(patch({ model }))()}
            onSaveBrowser={(browser) => run(patch({ browser }))()}
            onSaveRouter={(router) => run(patch({ router }))()}
            onSaveHire={(hire) => run(patch({ hire }))()}
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
