'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MODELS, type BotView, type Capabilities, type MemoryEntry, type Model } from '@/lib/types'
import { MODEL_LABELS } from '@/lib/router'
import { api } from './api'
import { Icon } from './icons'
import { Routines } from './Routines'
import { Screen } from './Screen'

export type PanelTarget = 'top' | 'job' | 'settings'

type Props = {
  bot: BotView
  memory: MemoryEntry[]
  caps: Capabilities | null
  open: boolean
  // Bumped with a new n on every request, so asking twice scrolls twice.
  focus: { target: PanelTarget; n: number }
  activity: string
  now: number
  shareText: () => string
  onClose: () => void
  onSaveJob: (job: string) => Promise<void>
  onSaveMemory: (entries: MemoryEntry[]) => Promise<void>
  onSaveFolder: (folder: string) => Promise<void>
  onSaveExtraFolders: (folders: string[]) => Promise<void>
  onSaveModel: (model: Model) => Promise<void>
  onSaveBrowser: (browser: boolean) => Promise<void>
  onSaveRouter: (router: boolean) => Promise<void>
  onSaveHire: (hire: boolean) => Promise<void>
  onDelete: () => Promise<void>
}

const today = () => new Date().toISOString().slice(0, 10)

function setupChips(caps: Capabilities): string[] {
  if ('error' in caps) return []
  return [
    ...caps.connectors.map((c) => (c.status === 'connected' ? c.name : `${c.name} (${c.status})`)),
    `${caps.skills.length} skills`,
    ...caps.plugins,
  ]
}

export function Details(props: Props) {
  const { bot, memory, caps, open, focus, onClose, onSaveJob, onSaveMemory, onDelete } = props
  const [editingJob, setEditingJob] = useState(false)
  const [job, setJob] = useState(bot.job)
  const [editing, setEditing] = useState<number | null>(null)
  const [entryText, setEntryText] = useState('')
  const [newNote, setNewNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const jobRef = useRef<HTMLElement>(null)
  const settingsRef = useRef<HTMLElement>(null)
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

  const scrollTo = (target: PanelTarget) => {
    const el = target === 'job' ? jobRef.current : target === 'settings' ? settingsRef.current : null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    if (open) scrollTo(focus.target)
  }, [focus, open])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const share = async () => {
    try {
      await navigator.clipboard.writeText(props.shareText())
      setToast('Copied')
    } catch {
      setToast('Could not copy the chat')
    }
  }

  const tryFolders = async (fn: () => Promise<void>) => {
    try {
      await fn()
      setFolderError(null)
    } catch (err) {
      setFolderError((err as Error).message)
    }
  }

  const saveFolder = (e: FormEvent) => {
    e.preventDefault()
    void tryFolders(() => props.onSaveFolder(folder.trim()))
  }

  // Resolves to null when the user cancels the dialog.
  const pickFolder = async (): Promise<string | null> => {
    const picked = await api.pickFolder(bot.id)
    return 'path' in picked ? picked.path : null
  }

  const chooseFolder = () =>
    tryFolders(async () => {
      const chosen = await pickFolder()
      if (chosen && chosen !== bot.folder) await props.onSaveFolder(chosen)
    })

  const addExtraFolder = () =>
    tryFolders(async () => {
      const chosen = await pickFolder()
      if (chosen && !bot.extraFolders.includes(chosen)) await props.onSaveExtraFolders([...bot.extraFolders, chosen])
    })

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

  const tools = caps && [...setupChips(caps), ...(bot.browser ? ['Browser'] : []), ...(bot.hire ? ['Hiring'] : []), 'Memory']

  return (
    <aside id="details" className={`panel${open ? ' open' : ''}`} aria-label={`${bot.name} details`} hidden={!open}>
      <div className="paneHead panelHead">
        <button className="iconButton" aria-label="Back" data-tip="Back" onClick={onClose}>
          <Icon name="chevronLeft" />
        </button>
        <div className="headActions">
          <button className="iconButton" aria-label="Copy chat as Markdown" data-tip="Copy chat" onClick={() => void share()}>
            <Icon name="share" />
          </button>
          <button className="iconButton" aria-label="Settings" data-tip="Settings" onClick={() => scrollTo('settings')}>
            <Icon name="gear" />
          </button>
          <button className="iconButton" aria-label="Close panel" data-tip="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div className="panelScroll" ref={scroller}>
        <Screen bot={bot} activity={props.activity} now={props.now} />

        <Routines bot={bot} />

        <section className="panelSection" ref={jobRef} aria-labelledby="job-label">
          <div className="sectionHead">
            <h3 className="sectionLabel" id="job-label">
              Job
            </h3>
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

        <section className="panelSection" aria-labelledby="memory-label">
          <h3 className="sectionLabel" id="memory-label">
            Memory
          </h3>
          {memory.length === 0 && <p className="mutedText">Nothing saved yet. Tell {bot.name} something worth keeping.</p>}
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
                      <span>{m.date}</span>
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

        <section className="panelSection" ref={settingsRef} aria-labelledby="settings-label">
          <h3 className="sectionLabel" id="settings-label">
            Settings
          </h3>
          <label className="fieldLabel" htmlFor="model-field">
            Model
          </label>
          <select
            id="model-field"
            className="field"
            value={bot.router ? 'router' : (bot.model ?? '')}
            disabled={bot.router}
            onChange={(e) => void props.onSaveModel(e.target.value === '' ? null : (e.target.value as NonNullable<Model>))}
          >
            {bot.router && <option value="router">Router</option>}
            <option value="">Default (your Claude Code model)</option>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
              </option>
            ))}
          </select>
          <div className="toggleList">
            <label className="toggle">
              <span>Pick the model per task (pstack table)</span>
              <input type="checkbox" role="switch" checked={bot.router} onChange={(e) => void props.onSaveRouter(e.target.checked)} />
            </label>
            <label className="toggle">
              <span>Browser (Playwright, headless)</span>
              <input type="checkbox" role="switch" checked={bot.browser} onChange={(e) => void props.onSaveBrowser(e.target.checked)} />
            </label>
            <label className="toggle">
              <span>Can hire new employees</span>
              <input type="checkbox" role="switch" checked={bot.hire} onChange={(e) => void props.onSaveHire(e.target.checked)} />
            </label>
          </div>
        </section>

        <section className="panelSection" aria-labelledby="folders-label">
          <h3 className="sectionLabel" id="folders-label">
            Folders
          </h3>
          <form className="stack" onSubmit={saveFolder}>
            <label className="fieldLabel" htmlFor="folder-field">
              Working folder
            </label>
            <input
              id="folder-field"
              className="field"
              value={folder}
              spellCheck={false}
              onChange={(e) => setFolder(e.target.value)}
            />
            <div className="row">
              <button className="secondaryButton" type="submit" disabled={!folder.trim() || folder.trim() === bot.folder}>
                Save
              </button>
              <button className="secondaryButton" type="button" onClick={() => void chooseFolder()}>
                Choose folder…
              </button>
            </div>
          </form>
          <div className="stack">
            <h4 className="fieldLabel" id="extra-folders-label">
              Also has access to
            </h4>
            {bot.extraFolders.length > 0 ? (
              <ul className="folderList" aria-labelledby="extra-folders-label">
                {bot.extraFolders.map((f) => (
                  <li key={f} className="folderItem">
                    <Icon name="folder" size={16} />
                    <span className="folderPath" title={f}>
                      {f}
                    </span>
                    <button
                      className="linkButton"
                      aria-label={`Remove ${f}`}
                      onClick={() => void tryFolders(() => props.onSaveExtraFolders(bot.extraFolders.filter((x) => x !== f)))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mutedText">Only the working folder.</p>
            )}
            <button className="secondaryButton alignStart" type="button" onClick={() => void addExtraFolder()}>
              Add folder…
            </button>
          </div>
          {folderError && <p className="formError">{folderError}</p>}
        </section>

        <section className="panelSection" aria-labelledby="tools-label">
          <h3 className="sectionLabel" id="tools-label">
            Connected tools
          </h3>
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

        <section className="panelSection" aria-labelledby="autonomy-label">
          <h3 className="sectionLabel" id="autonomy-label">
            Autonomy
          </h3>
          <p className="detailText small">
            Runs with your Claude Code permissions and settings, exactly like a Claude Code session. When Claude Code would
            ask you, the question shows up in this chat.
          </p>
          {bot.builtin !== 'chief' && (
            <button
              className="dangerButton alignStart"
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
      </div>

      <div className={`toast${toast ? ' show' : ''}`} role="status">
        {toast}
      </div>
    </aside>
  )
}
