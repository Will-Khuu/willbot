'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { BotView, MemoryEntry } from '@/lib/types'
import { TOOL_LABELS } from './look'

type Props = {
  bot: BotView
  memory: MemoryEntry[]
  open: boolean
  onClose: () => void
  onSaveJob: (job: string) => Promise<void>
  onSaveMemory: (entries: MemoryEntry[]) => Promise<void>
  onDelete: () => Promise<void>
}

const today = () => new Date().toISOString().slice(0, 10)

export function Details({ bot, memory, open, onClose, onSaveJob, onSaveMemory, onDelete }: Props) {
  const [editingJob, setEditingJob] = useState(false)
  const [job, setJob] = useState(bot.job)
  const [editing, setEditing] = useState<number | null>(null)
  const [entryText, setEntryText] = useState('')
  const [newNote, setNewNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEditingJob(false)
    setEditing(null)
    setNewNote('')
    setError(null)
  }, [bot.id])

  useEffect(() => {
    if (!editingJob) setJob(bot.job)
  }, [bot.job, editingJob])

  const saveJob = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await onSaveJob(job.trim())
      setEditingJob(false)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const saveEntry = async (e: FormEvent, index: number) => {
    e.preventDefault()
    const text = entryText.trim()
    if (!text) return
    await onSaveMemory(memory.map((m, i) => (i === index ? { ...m, text } : m)))
    setEditing(null)
  }

  const addNote = async (e: FormEvent) => {
    e.preventDefault()
    const text = newNote.trim()
    if (!text) return
    await onSaveMemory([...memory, { date: today(), text }])
    setNewNote('')
  }

  const tools = [...bot.tools.map((t) => TOOL_LABELS[t] ?? t), 'Memory']

  return (
    <aside id="details" className={`details${open ? ' open' : ''}`} aria-label={`${bot.name} details`}>
      <button className="secondaryButton detailsClose" onClick={onClose}>
        Close details
      </button>

      <section className="detailSection">
        <div className="sectionHead">
          <h3 className="sectionLabel">Job</h3>
          {!editingJob && (
            <button className="linkButton" onClick={() => setEditingJob(true)} aria-label={`Edit ${bot.name}'s job`}>
              Edit
            </button>
          )}
        </div>
        {editingJob ? (
          <form className="stack" onSubmit={saveJob}>
            <label htmlFor="job-field" className="visuallyHidden">
              Job
            </label>
            <textarea
              id="job-field"
              className="field"
              rows={4}
              maxLength={500}
              value={job}
              onChange={(e) => setJob(e.target.value)}
            />
            {error && <p className="formError">{error}</p>}
            <div className="row">
              <button className="primaryButton" type="submit" disabled={!job.trim()}>
                Save
              </button>
              <button className="secondaryButton" type="button" onClick={() => setEditingJob(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p className="detailText">{bot.job}</p>
        )}
      </section>

      <section className="detailSection">
        <h3 className="sectionLabel">Connected tools</h3>
        <div className="chips">
          {tools.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      </section>

      <section className="detailSection">
        <h3 className="sectionLabel">Memory</h3>
        {memory.length === 0 && <p className="mutedText">Nothing saved yet. Tell the bot something worth keeping.</p>}
        <ul className="memoryList">
          {memory.map((m, i) => (
            <li key={`${i}-${m.text}`} className="memoryItem">
              {editing === i ? (
                <form className="stack" onSubmit={(e) => void saveEntry(e, i)}>
                  <label htmlFor={`memory-${i}`} className="visuallyHidden">
                    Memory entry
                  </label>
                  <textarea
                    id={`memory-${i}`}
                    className="field"
                    rows={3}
                    maxLength={500}
                    value={entryText}
                    onChange={(e) => setEntryText(e.target.value)}
                    autoFocus
                  />
                  <div className="row">
                    <button className="primaryButton" type="submit" disabled={!entryText.trim()}>
                      Save
                    </button>
                    <button className="secondaryButton" type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <span className="memoryText">{m.text}</span>
                  <span className="memoryMeta">
                    <span className="mutedText">{m.date}</span>
                    <span className="row">
                      <button
                        className="linkButton"
                        aria-label={`Edit memory: ${m.text}`}
                        onClick={() => {
                          setEditing(i)
                          setEntryText(m.text)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="linkButton"
                        aria-label={`Delete memory: ${m.text}`}
                        onClick={() => void onSaveMemory(memory.filter((_, j) => j !== i))}
                      >
                        Delete
                      </button>
                    </span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        <form className="addMemory" onSubmit={addNote}>
          <label htmlFor="new-memory" className="visuallyHidden">
            Add a memory
          </label>
          <input
            id="new-memory"
            className="field"
            placeholder="Add a memory"
            maxLength={500}
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <button className="secondaryButton" type="submit" disabled={!newNote.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="detailSection">
        <h3 className="sectionLabel">Routines</h3>
        <p className="mutedText">No routines yet. Coming in a later version.</p>
      </section>

      <section className="detailSection autonomy">
        <h3 className="sectionLabel">Autonomy</h3>
        <p className="detailText small">Asks before running commands or deleting anything. Cannot read or write outside its own folder.</p>
        {bot.builtin !== 'chief' && (
          <button
            className="dangerButton"
            onClick={() => {
              if (window.confirm(`Delete ${bot.name}? Its chat and memory are removed. Its workspace folder stays on disk.`)) {
                void onDelete()
              }
            }}
          >
            Delete {bot.name}
          </button>
        )}
      </section>
    </aside>
  )
}
