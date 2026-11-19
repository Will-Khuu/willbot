'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { insertMention, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, mentionAt, type FileHit, type Upload } from '@/lib/context'
import type { BotView, Effort, Model, ModelCatalog } from '@/lib/types'
import { api } from './api'
import { FileCard } from './FileCard'
import { Icon } from './icons'
import { ModelMenu } from './ModelMenu'

type Pending = { key: string; name: string } & (
  | { state: 'uploading' }
  | { state: 'ready'; upload: Upload }
  | { state: 'failed'; error: string }
)

type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, (new () => Recognition) | undefined>
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

type Mention = { start: number; caret: number; hits: FileHit[]; active: number }

type Props = {
  bot: BotView
  closed: boolean
  limit: { text: string; blocks: boolean } | null
  // Files dropped on the chat, handed over by the pane.
  dropped: { files: File[]; n: number } | null
  onSend: (text: string, attachments: string[], model: NonNullable<Model> | null, effort: Effort | null) => Promise<void>
  models: ModelCatalog
}

let nextKey = 0

export function Composer({ bot, closed, limit, dropped, models, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<NonNullable<Model> | null>(null)
  const [effort, setEffort] = useState<Effort | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [mention, setMention] = useState<Mention | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const search = useRef<AbortController | null>(null)
  const listId = useId()
  const [canDictate, setCanDictate] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const [recording, setRecording] = useState(false)

  useEffect(() => setCanDictate(speechRecognition() !== null), [])

  // Grow with the text until the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  useEffect(() => () => recognition.current?.stop(), [])

  // Effort sticks per employee, like Claude Code's /effort, in this browser only.
  const effortKey = `willbot.effort.${bot.id}`
  useEffect(() => {
    try {
      setEffort((localStorage.getItem(effortKey) as Effort | null) ?? null)
    } catch {
      setEffort(null)
    }
  }, [effortKey])
  const chooseEffort = (level: Effort | null) => {
    setEffort(level)
    try {
      if (level) localStorage.setItem(effortKey, level)
      else localStorage.removeItem(effortKey)
    } catch {}
  }

  useEffect(() => {
    setPending([])
    setNote(null)
    setMention(null)
    recognition.current?.stop()
  }, [bot.id])

  const dictate = () => {
    if (recording) return recognition.current?.stop()
    const Ctor = speechRecognition()
    if (!Ctor) return
    const rec = new Ctor()
    const before = draft.trimEnd()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language
    rec.onresult = (e) => {
      const heard = Array.from(e.results, (r) => r[0]?.transcript ?? '').join('')
      setDraft(before && heard ? `${before} ${heard.trimStart()}` : before || heard)
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setNote('Allow microphone access to dictate.')
    }
    rec.onend = () => {
      setRecording(false)
      recognition.current = null
      input.current?.focus()
    }
    recognition.current = rec
    setRecording(true)
    rec.start()
  }

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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mention) {
      // Enter sends and Shift+Enter starts a new line; isComposing leaves IME input alone.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        e.currentTarget.form?.requestSubmit()
      }
      return
    }
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
  const hasContent = draft.trim() !== '' || pending.length > 0
  const canSend = (draft.trim() !== '' || ready.length > 0) && !uploading && !closed && !limit?.blocks

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    recognition.current?.stop()
    void onSend(draft.trim(), ready, pick, effort)
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
      : `Message ${bot.name}`

  const optionId = (i: number) => `${listId}-${i}`

  return (
    <form className="composer" onSubmit={submit}>
      {(pending.length > 0 || note) && (
        <div className="pendingRow">
          {pending.length > 0 && (
            <ul className="pendingList" aria-label="Attachments">
              {pending.map((p) => (
                <li key={p.key}>
                  <FileCard
                    name={p.name}
                    mime={p.state === 'ready' ? p.upload.mime : ''}
                    size={p.state === 'ready' ? p.upload.size : undefined}
                    note={p.state === 'uploading' ? { text: 'Uploading…' } : p.state === 'failed' ? { text: p.error, error: true } : undefined}
                    onRemove={() => setPending((cur) => cur.filter((x) => x.key !== p.key))}
                  />
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
      <div className={`composerPill${closed ? ' closed' : ''}${recording ? ' recording' : ''}`}>
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
          className="pillButton attachButton"
          aria-label="Attach files"
          data-tip="Attach files"
          disabled={closed}
          onClick={() => filePicker.current?.click()}
        >
          <Icon name="plus" />
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
            Message {bot.name}. Type @ to mention a file.
          </label>
          <textarea
            ref={input}
            id="composer"
            className="composerInput"
            rows={1}
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
            placeholder={recording ? 'Listening…' : placeholder}
            disabled={closed}
            autoComplete="off"
          />
        </div>
        <ModelMenu catalog={models} pick={pick} effort={effort} disabled={closed} onPick={setPick} onEffort={chooseEffort} />
        {recording || (canDictate && !hasContent) ? (
          <button
            type="button"
            className={`pillButton roundButton micButton${recording ? ' on' : ''}`}
            aria-label={recording ? 'Stop dictation' : 'Dictate'}
            aria-pressed={recording}
            data-tip={recording ? 'Stop dictation' : 'Dictate'}
            disabled={closed}
            onClick={dictate}
          >
            <Icon name="mic" size={18} />
          </button>
        ) : (
          <button
            className="pillButton roundButton sendButton"
            type="submit"
            aria-label="Send"
            data-tip={limit?.blocks ? limit.text : uploading ? 'Waiting for uploads' : 'Send'}
            disabled={!canSend}
          >
            <Icon name="arrowUp" size={18} strokeWidth={2.25} />
          </button>
        )}
      </div>
    </form>
  )
}
