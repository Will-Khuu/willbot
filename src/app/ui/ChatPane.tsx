'use client'

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { dividerTime, needsDivider } from '@/lib/chatlog'
import { isImageMime, type Attachment } from '@/lib/context'
import { routeLine } from '@/lib/router'
import { taskCounts, type TaskStatus } from '@/lib/tasks'
import type { ActivityItem, Answers, ApprovalItem, BotView, ChatItem, Effort, Model, ModelCatalog, QuestionItem, TasksItem } from '@/lib/types'
import { attachmentUrl } from './api'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { Markdown } from './Markdown'
import { FileCard } from './FileCard'
import { Icon, type IconName } from './icons'

type Row =
  | { kind: 'item'; item: Exclude<ChatItem, { kind: 'activity' | 'tasks' }> }
  | { kind: 'activity'; id: string; botId: string; entries: ActivityItem[] }
  | { kind: 'divider'; id: string; at: string }

function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = []
  let prevAt: string | null = null
  for (const item of items) {
    if (item.kind === 'tasks') continue
    if (needsDivider(prevAt, item.at)) rows.push({ kind: 'divider', id: `divider-${item.id}`, at: item.at })
    prevAt = item.at
    const last = rows.at(-1)
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
  if (!detail) return <li className="activityLine">{item.label}</li>
  const panel = `detail-${item.id}`
  return (
    <li>
      <button className="activityButton" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        <span className="activityLabel">{item.label}</span>
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

const TASK_MARK: Record<TaskStatus, { icon: IconName | null; text: string }> = {
  completed: { icon: 'check', text: 'Done' },
  in_progress: { icon: 'more', text: 'In progress' },
  pending: { icon: null, text: 'Pending' },
}

function TaskCard({ item, working }: { item: TasksItem; working: boolean }) {
  const [open, setOpen] = useState(true)
  const { done, total } = taskCounts(item.items)
  if (total === 0 || (done === total && !working)) return null
  return (
    <section className="card taskCard" aria-label="Tasks">
      <button className="taskHead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          Tasks <span className="taskCount">{done}/{total}</span>
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
      </button>
      {open && (
        <ul className="taskList">
          {item.items.map((t, i) => {
            const mark = TASK_MARK[t.status]
            return (
              <li key={t.taskId ?? i} className={`task ${t.status}`}>
                <span className="taskMark">{mark.icon && <Icon name={mark.icon} size={12} strokeWidth={3} />}</span>
                <span className="visuallyHidden">{mark.text}: </span>
                <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Attachments({ botId, attachments }: { botId: string; attachments: Attachment[] }) {
  return (
    <ul className="sentFiles" aria-label="Attachments">
      {attachments.map((a) => {
        const image = isImageMime(a.mime) ? attachmentUrl(botId, a.path) : undefined
        return (
          <li key={a.path}>
            <FileCard name={a.name} mime={a.mime} size={a.size} thumb={image} href={image} />
          </li>
        )
      })}
    </ul>
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
    <form className={`card approvalCard${item.state === 'pending' ? ' pending' : ''}`} onSubmit={submit}>
      <div className="cardHead attention">
        <Icon name="alert" size={16} strokeWidth={2.5} />
        <span>{who} has a question</span>
      </div>
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
            {item.state === 'answered' && item.answers && <div className="cardOutcome">Answered: {item.answers[q.question]}</div>}
          </fieldset>
        )
      })}
      {item.state === 'pending' ? (
        <div className="cardButtons">
          <button className="primaryButton" type="submit" disabled={!complete}>
            Send answers
          </button>
        </div>
      ) : (
        item.state === 'expired' && <div className="cardOutcome">No answer in time.</div>
      )}
    </form>
  )
}

function ApprovalCard({ item, who, onDecide }: { item: ApprovalItem; who: string; onDecide: (d: 'allow' | 'deny') => void }) {
  return (
    <div className={`card approvalCard${item.state === 'pending' ? ' pending' : ''}`}>
      <div className="cardHead attention">
        <Icon name="alert" size={16} strokeWidth={2.5} />
        <span>
          {who} {item.plan ? 'has a plan for you' : 'needs your approval'}
        </span>
      </div>
      <div className="approvalAction">{item.action}</div>
      {item.detail && <div className="approvalDetail">{item.detail}</div>}
      {item.body &&
        (item.plan ? (
          <pre className="approvalBody">{item.body}</pre>
        ) : (
          <details className="approvalInput">
            <summary>Input</summary>
            <pre className="approvalBody">{item.body}</pre>
          </details>
        ))}
      {item.state === 'pending' ? (
        <div className="cardButtons">
          <button className="primaryButton" onClick={() => onDecide('allow')}>
            Approve
          </button>
          <button className="secondaryButton" onClick={() => onDecide('deny')}>
            {item.plan ? 'Keep planning' : 'Deny'}
          </button>
        </div>
      ) : (
        <div className="cardOutcome">{outcomeOf(item)}</div>
      )}
    </div>
  )
}

type Props = {
  bot: BotView
  bots: BotView[]
  items: ChatItem[]
  loading: boolean
  working: boolean
  blocked: boolean
  now: number
  // The plan's usage limit; blocks is false when its reset time is unknown.
  limit: { text: string; blocks: boolean } | null
  panelOpen: boolean
  models: ModelCatalog
  onSend: (text: string, attachments: string[], model: NonNullable<Model> | null, effort: Effort | null) => Promise<void>
  onStop: () => Promise<void>
  onTakeOver: () => Promise<void>
  onDecide: (id: string, decision: 'allow' | 'deny') => Promise<void>
  onAnswer: (id: string, answers: Answers) => Promise<void>
  onTogglePanel: () => void
  onDetails: () => void
}

export function ChatPane(props: Props) {
  const { bot, bots, items, working, blocked, limit } = props
  const [dropped, setDropped] = useState<{ files: File[]; n: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? id
  const tasks = items.findLast((i): i is TasksItem => i.kind === 'tasks')
  const today = new Date(props.now)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length, working])

  // Like Claude Code, a message sent mid-turn joins the session's queue. Only
  // an employee working inside another's session cannot take messages.
  const closed = bot.paused || blocked || bot.delegatedBy !== null

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e) || closed) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
  }
  const onDrop = (e: DragEvent) => {
    setDragging(false)
    if (!hasFiles(e) || closed) return
    e.preventDefault()
    setDropped((cur) => ({ files: [...e.dataTransfer.files], n: (cur?.n ?? 0) + 1 }))
  }

  return (
    <main className={`chat${dragging ? ' dropping' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="paneHead chatHead">
        <Avatar id={bot.id} name={bot.name} size={28} />
        <div className="chatTitle">
          <h2 className="chatName">{bot.name}</h2>
          <div className={`chatStatus ${bot.status}`}>{bot.statusLine}</div>
        </div>
        <div className="headActions">
          {working && !bot.paused && (
            <button className="iconButton" aria-label="Stop" data-tip="Stop" onClick={() => void props.onStop()}>
              <Icon name="stop" />
            </button>
          )}
          <button
            className={`iconButton${bot.paused ? ' active' : ''}`}
            aria-label={bot.paused ? 'Hand back' : 'Take over'}
            data-tip={bot.paused ? 'Hand back' : 'Take over'}
            onClick={() => void props.onTakeOver()}
          >
            <Icon name={bot.paused ? 'play' : 'hand'} />
          </button>
          <button className="iconButton" aria-label="Details" data-tip="Details" aria-controls="details" onClick={props.onDetails}>
            <Icon name="info" />
          </button>
          <button
            className={`iconButton${props.panelOpen ? ' active' : ''}`}
            aria-label={`${bot.name}'s screen`}
            data-tip={props.panelOpen ? 'Hide screen' : 'Show screen'}
            aria-pressed={props.panelOpen}
            aria-controls="details"
            onClick={props.onTogglePanel}
          >
            <Icon name="screen" />
          </button>
        </div>
      </header>

      {limit && (
        <div className="banner limitBanner" role="status">
          {limit.text}
        </div>
      )}

      {bot.paused && (
        <div className="banner" role="status">
          You are driving. {bot.name} is paused until you hand control back.
        </div>
      )}

      <div className="messages" ref={scroller} aria-live="polite">
        <div className="messagesInner">
          {items.length === 0 && !props.loading && (
            <div className="emptyChat">
              <Avatar id={bot.id} name={bot.name} size={64} />
              <p className="emptyName">{bot.name}</p>
              <p className="mutedText">
                {bot.builtin === 'chief' ? 'Ask for a summary or hand out a task.' : `Tell ${bot.name} what you need.`}
              </p>
            </div>
          )}
          {toRows(items).map((row) => {
            if (row.kind === 'divider') {
              return (
                <div key={row.id} className="timeDivider">
                  <time dateTime={row.at}>{dividerTime(row.at, today)}</time>
                </div>
              )
            }
            if (row.kind === 'activity') {
              return (
                <div key={row.id} className="card activityCard">
                  <div className="cardHead">
                    <Icon name="spark" size={14} />
                    <span>
                      {nameOf(row.botId)} · {row.entries.length === 1 ? '1 step' : `${row.entries.length} steps`}
                    </span>
                  </div>
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
                // A teammate's message sits on the bot side, under the sender's name.
                if (item.from) {
                  return (
                    <div key={item.id} className="botRow">
                      <div className="botWho">{nameOf(item.from)}</div>
                      <div className="bubble botBubble" title={new Date(item.at).toLocaleString()}>
                        {item.text}
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={item.id} className="userRow">
                    {item.attachments && <Attachments botId={bot.id} attachments={item.attachments} />}
                    {item.text && (
                      <div className="bubble userBubble" title={new Date(item.at).toLocaleString()}>
                        {item.text}
                      </div>
                    )}
                  </div>
                )
              case 'assistant':
                return (
                  <div key={item.id} className="botRow">
                    {item.botId !== bot.id && <div className="botWho">{nameOf(item.botId)}</div>}
                    <div className="bubble botBubble mdBubble" title={new Date(item.at).toLocaleString()}>
                      <Markdown text={item.text} />
                    </div>
                  </div>
                )
              case 'approval':
                return (
                  <ApprovalCard key={item.id} item={item} who={nameOf(item.botId)} onDecide={(d) => void props.onDecide(item.id, d)} />
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
                    <Icon name="clock" size={14} />
                    <span>Routine · {item.name}</span>
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
          {working && !bot.paused && (
            <div className="botRow">
              <div className="bubble botBubble typing">
                <span className="typingDots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="visuallyHidden">{bot.name} is working…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chatFoot">
        {tasks && <TaskCard key={tasks.id} item={tasks} working={working} />}
        <Composer bot={bot} closed={closed} limit={limit} dropped={dropped} models={props.models} onSend={props.onSend} />
      </div>
    </main>
  )
}
