'use client'

import { useState, type FormEvent } from 'react'
import { listTime } from '@/lib/chatlog'
import type { BotView } from '@/lib/types'
import type { Usage } from '@/lib/usage'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { UsageMeter } from './UsageMeter'

type Props = {
  bots: BotView[]
  selectedId: string | null
  pluginsOpen: boolean
  usage: Usage | null
  now: number
  user: string | null
  isUnread: (bot: BotView) => boolean
  onSelect: (id: string) => void
  onCreate: (name: string, job: string) => Promise<void>
  onPlugins: () => void
}

function matches(b: BotView, q: string): boolean {
  return [b.name, b.job, b.last?.text ?? ''].some((s) => s.toLowerCase().includes(q))
}

function preview(b: BotView, nameOf: (id: string) => string): { text: string; tone: string } {
  if (b.status !== 'idle') return { text: b.status === 'working' ? `${b.statusLine}…` : b.statusLine, tone: b.status }
  const last = b.last
  if (!last) return { text: b.job, tone: 'empty' }
  if (last.who === 'user') return { text: `You: ${last.text}`, tone: 'idle' }
  if (last.who === 'teammate') return { text: `${nameOf(last.from)}: ${last.text}`, tone: 'idle' }
  return { text: last.text, tone: 'idle' }
}

export function Roster(props: Props) {
  const { bots, selectedId, usage, now, isUnread } = props
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [job, setJob] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? bots.filter((b) => matches(b, q)) : bots
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? id

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await props.onCreate(name.trim(), job.trim())
      setName('')
      setJob('')
      setCreating(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <nav className="sidebar" aria-label="Employees">
      <div className="sidebarHead">
        <button
          className="iconButton"
          aria-label={creating ? 'Cancel new employee' : 'New employee'}
          data-tip={creating ? 'Cancel' : 'New employee'}
          aria-expanded={creating}
          onClick={() => setCreating((c) => !c)}
        >
          <Icon name={creating ? 'close' : 'plus'} />
        </button>
      </div>

      {creating && (
        <form className="createForm" onSubmit={submit}>
          <label className="fieldLabel" htmlFor="new-bot-name">
            Name
          </label>
          <input
            id="new-bot-name"
            className="field"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Notes Bot"
            required
            autoFocus
          />
          <label className="fieldLabel" htmlFor="new-bot-job">
            Job
          </label>
          <textarea
            id="new-bot-job"
            className="field"
            value={job}
            maxLength={500}
            rows={3}
            onChange={(e) => setJob(e.target.value)}
            placeholder="What should this employee do?"
            required
          />
          {error && <p className="formError">{error}</p>}
          <button className="primaryButton" type="submit" disabled={saving || !name.trim() || !job.trim()}>
            {saving ? 'Hiring…' : 'Hire employee'}
          </button>
        </form>
      )}

      <div className="searchBox">
        <Icon name="search" size={16} />
        <label htmlFor="employee-search" className="visuallyHidden">
          Search employees
        </label>
        <input
          id="employee-search"
          type="search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      <ul className="employeeList">
        {shown.map((b) => {
          const line = preview(b, nameOf)
          const unread = isUnread(b)
          const current = b.id === selectedId && !props.pluginsOpen
          return (
            <li key={b.id}>
              <button
                className={`employeeRow${current ? ' selected' : ''}`}
                aria-current={current ? 'page' : undefined}
                aria-label={[b.name, b.status === 'idle' ? null : b.statusLine, unread ? 'new messages' : null].filter(Boolean).join(', ')}
                title={b.name}
                onClick={() => props.onSelect(b.id)}
              >
                <Avatar id={b.id} name={b.name} status={b.status} />
                <span className="employeeText">
                  <span className="employeeTop">
                    <span className="employeeName">{b.name}</span>
                    {b.last && <span className="employeeTime">{listTime(b.last.at, new Date(now))}</span>}
                  </span>
                  <span className="employeeBottom">
                    <span className={`employeePreview ${line.tone}`}>{line.text}</span>
                    {unread && <span className="unreadDot" />}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="mutedText searchEmpty">No employee matches “{query.trim()}”.</li>}
      </ul>

      <div className="sidebarFoot">
        <button
          className={`footRow${props.pluginsOpen ? ' selected' : ''}`}
          aria-current={props.pluginsOpen ? 'page' : undefined}
          title="Plugins"
          onClick={props.onPlugins}
        >
          <span className="footIcon">
            <Icon name="plug" size={18} />
          </span>
          <span className="footLabel">Plugins</span>
        </button>
        <UsageMeter usage={usage} now={now} />
        <div className="footRow meRow" title={props.user ?? 'You'}>
          <span className="footIcon meAvatar">
            <Icon name="person" size={16} />
          </span>
          <span className="footLabel">{props.user ?? 'You'}</span>
        </div>
      </div>
    </nav>
  )
}
