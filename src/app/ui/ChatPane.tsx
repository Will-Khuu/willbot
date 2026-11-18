'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MODEL_LABELS, routeLine } from '@/lib/router'
import { taskCounts, type TaskStatus } from '@/lib/tasks'
import {
  MODELS,
  type ActivityItem,
  type Answers,
  type ApprovalItem,
  type BotView,
  type ChatItem,
  type Model,
  type QuestionItem,
  type TasksItem,
} from '@/lib/types'
import { initialsOf, timeOf, tintOf } from './look'

type Row =
  | { kind: 'item'; item: Exclude<ChatItem, { kind: 'activity' | 'tasks' }> }
  | { kind: 'activity'; id: string; botId: string; entries: ActivityItem[] }

function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    const last = rows.at(-1)
    if (item.kind === 'tasks') continue
    if (item.kind !== 'activity') rows.push({ kind: 'item', item })
    else if (last?.kind === 'activity' && last.botId === item.botId) last.entries.push(item)
    else rows.push({ kind: 'activity', id: item.id, botId: item.botId, entries: [item] })
  }
  return rows
}

function outcomeOf(item: ApprovalItem): string {
  if (item.state === 'allowed') return 'Approved.'
  if (item.state === 'expired') return 'No answer in time, so it was not done.'
  if (item.state === 'denied') return item.plan ? 'Sent back to keep planning.' : 'Denied.'
  return ''
}

function ActivityLine({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false)
  const { detail } = item
  if (!detail) return <li>{item.label}</li>
  const panel = `detail-${item.id}`
  return (
    <li>
      <button className="activityButton" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>{item.label}</span>
        {detail.isError && <span className="activityError">Error</span>}
      </button>
      {open && (
        <div id={panel} className="activityDetail">
          <pre className="detailPre">{detail.input}</pre>
          {detail.output !== undefined && (
            <>
              <div className="detailLabel">{detail.isError ? 'Error' : 'Output'}</div>
              <pre className="detailPre">{detail.output || '(no text output)'}</pre>
            </>
          )}
        </div>
      )}
    </li>
  )
}

const TASK_MARK: Record<TaskStatus, { mark: string; text: string }> = {
  completed: { mark: '✓', text: 'Done' },
  in_progress: { mark: '●', text: 'In progress' },
  pending: { mark: '○', text: 'Pending' },
}

function TaskCard({ item, working }: { item: TasksItem; working: boolean }) {
  const [open, setOpen] = useState(true)
  const { done, total } = taskCounts(item.items)
  if (total === 0 || (done === total && !working)) return null
  return (
    <section className="taskCard" aria-label="Tasks">
      <button className="taskHead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          Tasks {done}/{total}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="taskList">
          {item.items.map((t, i) => (
            <li key={t.taskId ?? i} className={`task ${t.status}`}>
              <span className="taskMark" aria-hidden="true">
                {TASK_MARK[t.status].mark}
              </span>
              <span className="visuallyHidden">{TASK_MARK[t.status].text}: </span>
              <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
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
  // The plan's usage limit; blocks is false when its reset time is unknown.
  limit: { text: string; blocks: boolean } | null
  detailsOpen: boolean
  onSend: (text: string, model: NonNullable<Model> | null) => Promise<void>
  onStop: () => Promise<void>
  onTakeOver: () => Promise<void>
  onDecide: (id: string, decision: 'allow' | 'deny') => Promise<void>
  onAnswer: (id: string, answers: Answers) => Promise<void>
  onToggleDetails: () => void
}

export function ChatPane(props: Props) {
  const { bot, bots, items, working, blocked, limit } = props
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<NonNullable<Model> | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? id
  const tasks = items.findLast((i): i is TasksItem => i.kind === 'tasks')

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
    if (!text || closed || limit?.blocks) return
    setDraft('')
    setPick(null)
    void props.onSend(text, pick)
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

      {limit && (
        <div className="takeoverBanner limitBanner" role="status">
          {limit.text}
        </div>
      )}

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
                  {row.entries.map((entry) => (
                    <ActivityLine key={entry.id} item={entry} />
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
            case 'route':
              return (
                <div key={item.id} className="routeLine">
                  {routeLine(item)}
                </div>
              )
            case 'routine':
              return (
                <div key={item.id} className="routineDivider">
                  Routine · {item.name}
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

      {tasks && <TaskCard key={tasks.id} item={tasks} working={working} />}

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
        <label htmlFor="composer-model" className="visuallyHidden">
          Model
        </label>
        <select
          id="composer-model"
          className="composerModel"
          value={pick ?? ''}
          disabled={closed}
          onChange={(e) => setPick(e.target.value === '' ? null : (e.target.value as NonNullable<Model>))}
        >
          <option value="">Auto</option>
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        <button
          className="sendButton"
          type="submit"
          disabled={!draft.trim() || closed || limit?.blocks}
          title={limit?.blocks ? limit.text : undefined}
        >
          Send
        </button>
      </form>
    </main>
  )
}
