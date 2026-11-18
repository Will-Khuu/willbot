'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { MODELS, type BotView, type Capabilities, type MemoryEntry, type Model } from '@/lib/types'
import { api } from './api'

type Props = {
  bot: BotView
  memory: MemoryEntry[]
  open: boolean
  onClose: () => void
  onSaveJob: (job: string) => Promise<void>
  onSaveMemory: (entries: MemoryEntry[]) => Promise<void>
  onSaveFolder: (folder: string) => Promise<void>
  onSaveModel: (model: Model) => Promise<void>
  onSaveBrowser: (browser: boolean) => Promise<void>
  onDelete: () => Promise<void>
}

const today = () => new Date().toISOString().slice(0, 10)

const MODEL_LABELS: Record<NonNullable<Model>, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

function setupChips(caps: Capabilities): string[] {
  if ('error' in caps) return []
  return [
    ...caps.connectors.map((c) => (c.status === 'connected' ? c.name : `${c.name} (${c.status})`)),
    `${caps.skills} skills`,
    ...caps.plugins,
  ]
}

export function Details(props: Props) {
  const { bot, memory, open, onClose, onSaveJob, onSaveMemory, onDelete } = props
  const [editingJob, setEditingJob] = useState(false)
  const [job, setJob] = useState(bot.job)
  const [editing, setEditing] = useState<number | null>(null)
  const [entryText, setEntryText] = useState('')
  const [newNote, setNewNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [folder, setFolder] = useState(bot.folder)
  const [folderError, setFolderError] = useState<string | null>(null)

  useEffect(() => {
    setEditingJob(false)
    setEditing(null)
    setNewNote('')
    setError(null)
    setFolderError(null)
  }, [bot.id])

  useEffect(() => setFolder(bot.folder), [bot.folder])

  useEffect(() => {
    if (!editingJob) setJob(bot.job)
  }, [bot.job, editingJob])

  useEffect(() => {
    if (caps) return
    api.capabilities().then(setCaps, (e: Error) => setCaps({ error: e.message }))
  }, [caps])

  const saveFolder = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await props.onSaveFolder(folder.trim())
      setFolderError(null)
    } catch (err) {
      setFolderError((err as Error).message)
    }
  }

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

  const tools = caps && [...setupChips(caps), ...(bot.browser ? ['Browser'] : []), 'Memory']

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
        <h3 className="sectionLabel">Settings</h3>
        <form className="stack" onSubmit={saveFolder}>
          <label className="fieldLabel" htmlFor="folder-field">
            Working folder
          </label>
          <div className="row">
            <input
              id="folder-field"
              className="field"
              value={folder}
              spellCheck={false}
              onChange={(e) => setFolder(e.target.value)}
            />
            <button className="secondaryButton" type="submit" disabled={!folder.trim() || folder.trim() === bot.folder}>
              Save
            </button>
          </div>
          {folderError && <p className="formError">{folderError}</p>}
        </form>
        <label className="fieldLabel" htmlFor="model-field">
          Model
        </label>
        <select
          id="model-field"
          className="field"
          value={bot.model ?? ''}
          onChange={(e) => void props.onSaveModel(e.target.value === '' ? null : (e.target.value as NonNullable<Model>))}
        >
          <option value="">Default (your Claude Code model)</option>
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        <label className="option">
          <input type="checkbox" checked={bot.browser} onChange={(e) => void props.onSaveBrowser(e.target.checked)} />
          <span>Browser (Playwright, headless)</span>
        </label>
      </section>

      <section className="detailSection">
        <h3 className="sectionLabel">Connected tools</h3>
        {caps && 'error' in caps && <p className="formError">Could not load your Claude setup: {caps.error}</p>}
        {tools ? (
          <div className="chips">
            {tools.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <p className="mutedText" aria-live="polite">
            Checking your Claude setup…
          </p>
        )}
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
        <p className="detailText small">
          Runs with your Claude Code permissions and settings, exactly like a Claude Code session. When Claude Code would
          ask you, the question shows up in this chat.
        </p>
        {bot.builtin !== 'chief' && (
          <button
            className="dangerButton"
            onClick={() => {
              if (window.confirm(`Delete ${bot.name}? Its chat and memory are removed. Its working folder stays on disk.`)) {
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
