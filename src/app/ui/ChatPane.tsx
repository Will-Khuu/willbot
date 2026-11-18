'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Answers, ApprovalItem, BotView, ChatItem, QuestionItem } from '@/lib/types'
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

function outcomeOf(item: ApprovalItem): string {
  if (item.state === 'allowed') return 'Approved.'
  if (item.state === 'expired') return 'No answer in time, so it was not done.'
  if (item.state === 'denied') return item.plan ? 'Sent back to keep planning.' : 'Denied.'
  return ''
}

const OTHER = '__other__'

function QuestionCard({ item, who, onAnswer }: { item: QuestionItem; who: string; onAnswer: (a: Answers) => Promise<void> }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const answerOf = (q: QuestionItem['questions'][number]) =>
    (picked[q.question] ?? [])
      .map((label) => (label === OTHER ? (other[q.question] ?? '').trim() : label))
      .filter(Boolean)
      .join(', ')
  const complete = item.questions.every((q) => answerOf(q))
  const toggle = (question: string, label: string, multi: boolean) =>
    setPicked((cur) => {
      const now = cur[question] ?? []
      if (!multi) return { ...cur, [question]: [label] }
      return { ...cur, [question]: now.includes(label) ? now.filter((l) => l !== label) : [...now, label] }
    })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!complete) return
    void onAnswer(Object.fromEntries(item.questions.map((q) => [q.question, answerOf(q)])))
  }

  return (
    <form className="approvalCard" onSubmit={submit}>
      <div className="cardLabel approvalLabel">{who} has a question</div>
      {item.questions.map((q, qi) => {
        const name = `${item.id}-${qi}`
        const type = q.multiSelect ? 'checkbox' : 'radio'
        const chosen = picked[q.question] ?? []
        return (
          <fieldset key={q.question} className="question" disabled={item.state !== 'pending'}>
            <legend className="questionText">
              <span className="chip">{q.header}</span> {q.question}
            </legend>
            {q.options.map((o) => (
              <label key={o.label} className="option">
                <input
                  type={type}
                  name={name}
                  checked={chosen.includes(o.label) || item.answers?.[q.question]?.split(', ').includes(o.label) === true}
                  onChange={() => toggle(q.question, o.label, q.multiSelect)}
                />
                <span>
                  <span className="optionLabel">{o.label}</span>
                  {o.description && <span className="optionDescription">{o.description}</span>}
                </span>
              </label>
            ))}
            {item.state === 'pending' && (
              <label className="option">
                <input
                  type={type}
                  name={name}
                  checked={chosen.includes(OTHER)}
                  onChange={() => toggle(q.question, OTHER, q.multiSelect)}
                />
                <input
                  className="field"
                  placeholder="Other"
                  aria-label={`Other answer to: ${q.question}`}
                  value={other[q.question] ?? ''}
                  onFocus={() => !chosen.includes(OTHER) && toggle(q.question, OTHER, q.multiSelect)}
                  onChange={(e) => setOther((cur) => ({ ...cur, [q.question]: e.target.value }))}
                />
              </label>
            )}
            {item.state === 'answered' && item.answers && <div className="approvalOutcome">Answered: {item.answers[q.question]}</div>}
          </fieldset>
        )
      })}
      {item.state === 'pending' ? (
        <div className="approvalButtons">
          <button className="darkButton" type="submit" disabled={!complete}>
            Send answers
          </button>
        </div>
      ) : (
        item.state === 'expired' && <div className="approvalOutcome">No answer in time.</div>
      )}
    </form>
  )
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
  onAnswer: (id: string, answers: Answers) => Promise<void>
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

  // Like Claude Code, a message sent mid-turn joins the session's queue. Only
  // an employee working inside another's session cannot take messages.
  const closed = bot.paused || blocked || bot.delegatedBy !== null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || closed) return
    setDraft('')
    void props.onSend(text)
  }

  const placeholder = bot.paused
    ? `Hand back to message ${bot.name}`
    : bot.delegatedBy
      ? `${bot.name} is ${bot.statusLine.toLowerCase()}…`
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
                  {item.detail && <div className="approvalDetail">{item.detail}</div>}
                  {item.body &&
                    (item.plan ? (
                      <pre className="approvalBody">{item.body}</pre>
                    ) : (
                      <details>
                        <summary className="approvalDetail">Input</summary>
                        <pre className="approvalBody">{item.body}</pre>
                      </details>
                    ))}
                  {item.state === 'pending' ? (
                    <div className="approvalButtons">
                      <button className="darkButton" onClick={() => void props.onDecide(item.id, 'allow')}>
                        Approve
                      </button>
                      <button className="secondaryButton" onClick={() => void props.onDecide(item.id, 'deny')}>
                        {item.plan ? 'Keep planning' : 'Deny'}
                      </button>
                    </div>
                  ) : (
                    <div className="approvalOutcome">{outcomeOf(item)}</div>
                  )}
                </div>
              )
            case 'question':
              return (
                <QuestionCard
                  key={item.id}
                  item={item}
                  who={nameOf(item.botId)}
                  onAnswer={(answers) => props.onAnswer(item.id, answers)}
                />
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
          disabled={closed}
          autoComplete="off"
        />
        <button className="sendButton" type="submit" disabled={!draft.trim() || closed}>
          Send
        </button>
      </form>
    </main>
  )
}
