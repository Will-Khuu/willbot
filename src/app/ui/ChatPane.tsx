'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApprovalItem, BotView, ChatItem } from '@/lib/types'
import { initialsOf, timeOf, tintOf } from './look'

type Row =
  | { kind: 'item'; item: Exclude<ChatItem, { kind: 'activity' }> }
  | { kind: 'activity'; id: string; botId: string; labels: string[] }

function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    const last = rows.at(-1)
    if (item.kind !== 'activity') rows.push({ kind: 'item', item })
    else if (last?.kind === 'activity' && last.botId === item.botId) last.labels.push(item.label)
    else rows.push({ kind: 'activity', id: item.id, botId: item.botId, labels: [item.label] })
  }
  return rows
}

const OUTCOME: Record<ApprovalItem['state'], string> = {
  pending: '',
  allowed: 'Approved.',
  denied: 'Held back. The bot was told not to retry.',
  expired: 'No answer in time, so it was not done.',
}

type Props = {
  bot: BotView
  bots: BotView[]
  items: ChatItem[]
  loading: boolean
  working: boolean
  blocked: boolean
  detailsOpen: boolean
  onSend: (text: string) => Promise<void>
  onStop: () => Promise<void>
  onTakeOver: () => Promise<void>
  onDecide: (id: string, decision: 'allow' | 'deny') => Promise<void>
  onToggleDetails: () => void
}

export function ChatPane(props: Props) {
  const { bot, bots, items, working, blocked } = props
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? id

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length, working])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || working || bot.paused || blocked) return
    setDraft('')
    void props.onSend(text)
  }

  const placeholder = bot.paused
    ? `Hand back to message ${bot.name}`
    : working
      ? `${bot.name} is working…`
      : `Message ${bot.name}`

  return (
    <main className="chat">
      <header className="chatHead">
        <div className="chatTitle">
          <h2 className="chatName">{bot.name}</h2>
          <div className="chatStatus">{bot.statusLine}</div>
        </div>
        {working && !bot.paused && (
          <button className="secondaryButton" onClick={() => void props.onStop()}>
            Stop
          </button>
        )}
        <button className={`secondaryButton${bot.paused ? ' inverted' : ''}`} onClick={() => void props.onTakeOver()}>
          {bot.paused ? 'Hand back' : 'Take over'}
        </button>
        <button
          className="secondaryButton detailsToggle"
          aria-expanded={props.detailsOpen}
          aria-controls="details"
          onClick={props.onToggleDetails}
        >
          Details
        </button>
      </header>

      {bot.paused && (
        <div className="takeoverBanner" role="status">
          You are driving. The bot is paused until you hand control back.
        </div>
      )}

      <div className="messages" ref={scroller} aria-live="polite">
        {items.length === 0 && !props.loading && (
          <p className="emptyChat">
            No messages yet. {bot.builtin === 'chief' ? 'Ask for a summary or hand out a task.' : `Tell ${bot.name} what you need.`}
          </p>
        )}
        {toRows(items).map((row) => {
          if (row.kind === 'activity') {
            return (
              <div key={row.id} className="activityCard">
                <div className="cardLabel">{nameOf(row.botId)} · working</div>
                <ul className="activityList">
                  {row.labels.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )
          }
          const item = row.item
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="userRow">
                  <div className="userBubble">{item.text}</div>
                </div>
              )
            case 'assistant':
              return (
                <div key={item.id} className="botRow">
                  <span className="avatar small" style={{ background: tintOf(item.botId) }} aria-hidden="true">
                    {initialsOf(nameOf(item.botId))}
                  </span>
                  <div className="botBody">
                    <div className="botMeta">
                      <span className="botWho">{nameOf(item.botId)}</span>
                      <span className="botTime">{timeOf(item.at)}</span>
                    </div>
                    <div className="botBubble">{item.text}</div>
                  </div>
                </div>
              )
            case 'approval':
              return (
                <div key={item.id} className="approvalCard">
                  <div className="cardLabel approvalLabel">{nameOf(item.botId)} needs your approval</div>
                  <div className="approvalAction">{item.action}</div>
                  {item.state === 'pending' ? (
                    <div className="approvalButtons">
                      <button className="darkButton" onClick={() => void props.onDecide(item.id, 'allow')}>
                        Approve
                      </button>
                      <button className="secondaryButton" onClick={() => void props.onDecide(item.id, 'deny')}>
                        Not yet
                      </button>
                    </div>
                  ) : (
                    <div className="approvalOutcome">{OUTCOME[item.state]}</div>
                  )}
                </div>
              )
            case 'error':
              return (
                <div key={item.id} className="errorCard" role="alert">
                  {item.text}
                </div>
              )
          }
        })}
        {working && !bot.paused && <div className="workingLine">{bot.name} is working…</div>}
      </div>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="composer" className="visuallyHidden">
          Message {bot.name}
        </label>
        <input
          id="composer"
          className="composerInput"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          disabled={bot.paused || blocked}
          autoComplete="off"
        />
        <button className="sendButton" type="submit" disabled={!draft.trim() || working || bot.paused || blocked}>
          Send
        </button>
      </form>
    </main>
  )
}
