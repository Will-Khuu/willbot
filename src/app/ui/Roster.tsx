'use client'

import { useState, type FormEvent } from 'react'
import type { BotView } from '@/lib/types'
import { DOT, initialsOf, tintOf } from './look'

type Props = {
  bots: BotView[]
  selectedId: string
  onSelect: (id: string) => void
  onCreate: (name: string, job: string) => Promise<void>
}

export function Roster({ bots, selectedId, onSelect, onCreate }: Props) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [job, setJob] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onCreate(name.trim(), job.trim())
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
    <nav className="roster" aria-label="Bots">
      <div className="rosterHead">
        <h1 className="rosterTitle">Bots</h1>
        <button
          className="iconButton"
          aria-label={creating ? 'Cancel creating a bot' : 'Create a new bot'}
          aria-expanded={creating}
          onClick={() => setCreating((c) => !c)}
        >
          {creating ? '×' : '+'}
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
            placeholder="What should this bot do?"
            required
          />
          {error && <p className="formError">{error}</p>}
          <button className="primaryButton" type="submit" disabled={saving || !name.trim() || !job.trim()}>
            {saving ? 'Creating…' : 'Create bot'}
          </button>
        </form>
      )}

      <div className="rosterList">
        <div className="sectionLabel rosterLabel">Roster</div>
        {bots.map((b) => (
          <button
            key={b.id}
            className={`rosterRow${b.id === selectedId ? ' selected' : ''}`}
            aria-label={`${b.name}, ${b.statusLine}`}
            aria-current={b.id === selectedId ? 'page' : undefined}
            onClick={() => onSelect(b.id)}
          >
            <span className="avatar" style={{ background: tintOf(b.id) }} aria-hidden="true">
              {initialsOf(b.name)}
            </span>
            <span className="rosterText">
              <span className="rosterName">{b.name}</span>
              <span className="rosterStatus">{b.statusLine}</span>
            </span>
            <span className="dot" style={{ background: DOT[b.status] }} aria-hidden="true" />
          </button>
        ))}
      </div>
    </nav>
  )
}
