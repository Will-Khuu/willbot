'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { insertMention, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, mentionAt, type FileHit, type Upload } from '@/lib/context'
import { MODEL_LABELS } from '@/lib/router'
import { MODELS, type BotView, type Model } from '@/lib/types'
import { api } from './api'

type Pending = { key: string; name: string } & (
  | { state: 'uploading' }
  | { state: 'ready'; upload: Upload }
  | { state: 'failed'; error: string }
)

type Mention = { start: number; caret: number; hits: FileHit[]; active: number }

type Props = {
  bot: BotView
  closed: boolean
  limit: { text: string; blocks: boolean } | null
  // Files dropped on the chat, handed over by the pane.
  dropped: { files: File[]; n: number } | null
  onSend: (text: string, attachments: string[], model: NonNullable<Model> | null) => Promise<void>
}

let nextKey = 0

export function Composer({ bot, closed, limit, dropped, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<NonNullable<Model> | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [mention, setMention] = useState<Mention | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const search = useRef<AbortController | null>(null)
  const listId = useId()

  useEffect(() => {
    setPending([])
    setNote(null)
    setMention(null)
  }, [bot.id])

  const attach = (files: File[]) => {
    if (closed || files.length === 0) return
    const room = MAX_ATTACHMENTS - pending.length
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES)
    const fits = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
    const taken = fits.slice(0, Math.max(room, 0))
    const notes = [
      ...tooBig.map((f) => `${f.name} is over 20 MB.`),
      ...(fits.length > taken.length ? [`Up to ${MAX_ATTACHMENTS} files per message.`] : []),
    ]
    setNote(notes.length ? notes.join(' ') : null)
    for (const file of taken) {
      const key = `a${nextKey++}`
      const name = file.name || 'pasted-image.png'
      setPending((cur) => [...cur, { key, name, state: 'uploading' }])
      api.upload(bot.id, file).then(
        (upload) => setPending((cur) => cur.map((p) => (p.key === key ? { key, name: upload.name, state: 'ready', upload } : p))),
        (e: Error) => setPending((cur) => cur.map((p) => (p.key === key ? { key, name, state: 'failed', error: e.message } : p))),
      )
    }
  }

  useEffect(() => {
    if (dropped) attach(dropped.files)
  }, [dropped])

  const closeMention = () => {
    search.current?.abort()
    setMention(null)
  }

  const findMention = (text: string, caret: number) => {
    const at = mentionAt(text, caret)
    if (!at) return closeMention()
    search.current?.abort()
    const ctrl = new AbortController()
    search.current = ctrl
    api.files(bot.id, at.query, ctrl.signal).then(
      (hits) => {
        if (ctrl.signal.aborted) return
        setMention(hits.length ? { start: at.start, caret, hits, active: 0 } : null)
      },
      () => {},
    )
  }

  const choose = (hit: FileHit) => {
    if (!mention) return
    const next = insertMention(draft, mention.start, mention.caret, hit.path)
    setDraft(next.text)
    closeMention()
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!mention) return
    const count = mention.hits.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setMention({ ...mention, active: (mention.active + step + count) % count })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      choose(mention.hits[mention.active]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMention()
    }
  }

  const uploading = pending.some((p) => p.state === 'uploading')
  const ready = pending.flatMap((p) => (p.state === 'ready' ? [p.upload.id] : []))
  const canSend = (draft.trim() !== '' || ready.length > 0) && !uploading && !closed && !limit?.blocks

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    void onSend(draft.trim(), ready, pick)
    setDraft('')
    setPick(null)
    setPending([])
    setNote(null)
    closeMention()
  }

  const placeholder = bot.paused
    ? `Hand back to message ${bot.name}`
    : bot.delegatedBy
      ? `${bot.name} is ${bot.statusLine.toLowerCase()}…`
      : `Message ${bot.name}, @ to mention a file`

  const optionId = (i: number) => `${listId}-${i}`

  return (
    <form className="composer" onSubmit={submit}>
      {(pending.length > 0 || note) && (
        <div className="pendingRow">
          {pending.length > 0 && (
            <ul className="pendingList" aria-label="Attachments">
              {pending.map((p) => (
                <li key={p.key} className={`pendingChip${p.state === 'failed' ? ' failed' : ''}`}>
                  <span className="pendingName">{p.name}</span>
                  {p.state === 'uploading' && <span className="pendingState">Uploading…</span>}
                  {p.state === 'failed' && <span className="pendingState">{p.error}</span>}
                  <button
                    type="button"
                    className="pendingRemove"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setPending((cur) => cur.filter((x) => x.key !== p.key))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && (
            <p className="formError" role="status">
              {note}
            </p>
          )}
        </div>
      )}
      <div className="composerRow">
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            attach([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="attachButton"
          aria-label="Attach files"
          title="Attach files"
          disabled={closed}
          onClick={() => filePicker.current?.click()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <div className="composerField">
          {mention && (
            <ul id={listId} className="mentionList" role="listbox" aria-label="Files">
              {mention.hits.map((hit, i) => (
                <li
                  key={hit.path}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === mention.active}
                  className="mentionOption"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(hit)
                  }}
                  onMouseEnter={() => setMention({ ...mention, active: i })}
                >
                  <span className="mentionName">{hit.rel.slice(hit.rel.lastIndexOf('/') + 1)}</span>
                  <span className="mentionPath">
                    {hit.root.slice(hit.root.lastIndexOf('/') + 1)}/{hit.rel}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="composer" className="visuallyHidden">
            Message {bot.name}
          </label>
          <input
            ref={input}
            id="composer"
            className="composerInput"
            value={draft}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={mention !== null}
            aria-controls={mention ? listId : undefined}
            aria-activedescendant={mention ? optionId(mention.active) : undefined}
            onChange={(e) => {
              setDraft(e.target.value)
              findMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }}
            onKeyDown={onKeyDown}
            onBlur={closeMention}
            onPaste={(e) => {
              const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
              if (images.length === 0) return
              e.preventDefault()
              attach(images)
            }}
            placeholder={placeholder}
            disabled={closed}
            autoComplete="off"
          />
        </div>
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
          disabled={!canSend}
          title={limit?.blocks ? limit.text : uploading ? 'Waiting for uploads' : undefined}
        >
          Send
        </button>
      </div>
    </form>
  )
}
