'use client'

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { EVERY_HOURS, OUTCOME_TEXT, dayWord, scheduleWords, type Routine, type Schedule } from '@/lib/routines'
import type { BotView } from '@/lib/types'
import { api, type RoutineInput } from './api'
import { Icon } from './icons'
import { timeOf } from './look'

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const KIND_LABELS: Record<Schedule['kind'], string> = {
  daily: 'Daily',
  weekdays: 'Weekdays (Mon–Fri)',
  weekly: 'Weekly',
  every: 'Every N hours',
}

function nextText(r: Routine): string | null {
  return r.nextRunAt && `Next ${dayWord(new Date(r.nextRunAt), new Date())} ${timeOf(r.nextRunAt)}`
}

type MenuAction = { label: string; run: () => void; danger?: boolean }

function RowMenu({ name, actions }: { name: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="rowMenu" ref={root}>
      <button
        className="iconButton small"
        aria-label={`${name} actions`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <ul id={id} className="menu" aria-label={`${name} actions`}>
          {actions.map((a) => (
            <li key={a.label}>
              <button
                className={`menuItem${a.danger ? ' danger' : ''}`}
                onClick={() => {
                  setOpen(false)
                  a.run()
                }}
              >
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Draft = { name: string; prompt: string; kind: Schedule['kind']; time: string; day: number; hours: number }
type DraftErrors = Partial<Record<'name' | 'prompt' | 'time' | 'form', string>>

function draftOf(r: Routine | null): Draft {
  const s = r?.schedule
  return {
    name: r?.name ?? '',
    prompt: r?.prompt ?? '',
    kind: s?.kind ?? 'daily',
    time: s && s.kind !== 'every' ? s.time : '18:00',
    day: s?.kind === 'weekly' ? s.day : 1,
    hours: s?.kind === 'every' ? s.hours : 2,
  }
}

function parseDraft(d: Draft): RoutineInput | DraftErrors {
  const errors: DraftErrors = {}
  if (!d.name.trim()) errors.name = 'Give the routine a name.'
  if (!d.prompt.trim()) errors.prompt = 'Say what it should do.'
  if (d.kind !== 'every' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) errors.time = 'Pick a time.'
  if (Object.keys(errors).length) return errors
  const schedule = (
    d.kind === 'every'
      ? { kind: 'every', hours: d.hours }
      : d.kind === 'weekly'
        ? { kind: 'weekly', day: d.day, time: d.time }
        : { kind: d.kind, time: d.time }
  ) as Schedule
  return { name: d.name.trim(), prompt: d.prompt.trim(), schedule }
}

function RoutineForm(props: { routine: Routine | null; onSave: (input: RoutineInput) => Promise<void>; onCancel: () => void }) {
  const id = useId()
  const [draft, setDraft] = useState(() => draftOf(props.routine))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseDraft(draft)
    if (!('schedule' in parsed)) return setErrors(parsed)
    setErrors({})
    setSaving(true)
    try {
      await props.onSave(parsed)
    } catch (err) {
      setErrors({ form: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (key: keyof DraftErrors) =>
    errors[key] && (
      <p id={`${id}-${key}-error`} className="formError">
        {errors[key]}
      </p>
    )

  return (
    <form className="stack routineForm" onSubmit={submit} noValidate>
      <label className="fieldLabel" htmlFor={`${id}-name`}>
        Name
      </label>
      <input
        id={`${id}-name`}
        className="field"
        maxLength={60}
        placeholder="Evening summary"
        value={draft.name}
        aria-invalid={!!errors.name}
        aria-describedby={errors.name ? `${id}-name-error` : undefined}
        onChange={(e) => set('name', e.target.value)}
        autoFocus
      />
      {fieldError('name')}
      <label className="fieldLabel" htmlFor={`${id}-prompt`}>
        What should it do?
      </label>
      <textarea
        id={`${id}-prompt`}
        className="field"
        rows={3}
        maxLength={4000}
        placeholder="Summarize what you did today in five bullets."
        value={draft.prompt}
        aria-invalid={!!errors.prompt}
        aria-describedby={errors.prompt ? `${id}-prompt-error` : undefined}
        onChange={(e) => set('prompt', e.target.value)}
      />
      {fieldError('prompt')}
      <label className="fieldLabel" htmlFor={`${id}-kind`}>
        Repeats
      </label>
      <select
        id={`${id}-kind`}
        className="field"
        value={draft.kind}
        onChange={(e) => set('kind', e.target.value as Schedule['kind'])}
      >
        {(Object.keys(KIND_LABELS) as Schedule['kind'][]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      {draft.kind === 'weekly' && (
        <>
          <label className="fieldLabel" htmlFor={`${id}-day`}>
            Day
          </label>
          <select id={`${id}-day`} className="field" value={draft.day} onChange={(e) => set('day', Number(e.target.value))}>
            {FULL_DAYS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}
      {draft.kind === 'every' ? (
        <>
          <label className="fieldLabel" htmlFor={`${id}-hours`}>
            How often
          </label>
          <select
            id={`${id}-hours`}
            className="field"
            value={draft.hours}
            onChange={(e) => set('hours', Number(e.target.value))}
          >
            {EVERY_HOURS.map((h) => (
              <option key={h} value={h}>
                {h === 1 ? 'Every hour' : `Every ${h} hours`}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label className="fieldLabel" htmlFor={`${id}-time`}>
            Time
          </label>
          <input
            id={`${id}-time`}
            className="field"
            type="time"
            value={draft.time}
            aria-invalid={!!errors.time}
            aria-describedby={errors.time ? `${id}-time-error` : undefined}
            onChange={(e) => set('time', e.target.value)}
          />
          {fieldError('time')}
        </>
      )}
      {errors.form && (
        <p className="formError" role="alert">
          {errors.form}
        </p>
      )}
      <div className="row">
        <button className="primaryButton" type="submit" disabled={saving}>
          {props.routine ? 'Save' : 'Add routine'}
        </button>
        <button className="secondaryButton" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function Routines({ bot, rev }: { bot: BotView; rev: number }) {
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  // 'new' for the add form, a routine id while editing it.
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRoutines(await api.routines(bot.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [bot.id])

  useEffect(() => {
    setRoutines(null)
    setEditing(null)
    setError(null)
  }, [bot.id])

  // A run changes the status, an employee's routine tools bump rev, and the
  // schedule moves on its own.
  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh, bot.status, rev])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    }
    await refresh()
  }

  return (
    <section className="panelSection" aria-labelledby="routines-label">
      <div className="sectionHead">
        <h3 className="sectionLabel" id="routines-label">
          Routines
        </h3>
        {editing === null && (
          <button className="iconButton small" aria-label="Add routine" data-tip="Add routine" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} />
          </button>
        )}
      </div>
      {routines?.length === 0 && editing !== 'new' && (
        <p className="mutedText">No routines yet. Add one to send {bot.name} a message on a schedule.</p>
      )}
      {error && (
        <p className="formError" role="alert">
          {error}
        </p>
      )}
      {editing === 'new' && (
        <RoutineForm
          routine={null}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await api.createRoutine(bot.id, input)
            setEditing(null)
            await refresh()
          }}
        />
      )}
      <ul className="routineList">
        {routines?.map((r) => (
          <li key={r.id} className="routineItem">
            {editing === r.id ? (
              <RoutineForm
                routine={r}
                onCancel={() => setEditing(null)}
                onSave={async (input) => {
                  await api.patchRoutine(r.id, input)
                  setEditing(null)
                  await refresh()
                }}
              />
            ) : (
              <div className={`routineRow${r.enabled ? '' : ' paused'}`}>
                <span className="routineIcon">
                  <Icon name={r.enabled ? 'clock' : 'pause'} size={16} />
                </span>
                <span className="routineText">
                  <span className="routineName">{r.name}</span>
                  <span className="routineWhen">{r.enabled ? scheduleWords(r.schedule) : 'Paused'}</span>
                  {r.enabled && nextText(r) && <span className="routineNext">{nextText(r)}</span>}
                  {r.lastOutcome && r.lastOutcome !== 'ran' && <span className="routineOutcome">{OUTCOME_TEXT[r.lastOutcome]}</span>}
                </span>
                <RowMenu
                  name={r.name}
                  actions={[
                    { label: 'Run now', run: () => void act(() => api.runRoutine(r.id)) },
                    { label: 'Edit', run: () => setEditing(r.id) },
                    {
                      label: r.enabled ? 'Pause' : 'Resume',
                      run: () => void act(() => api.patchRoutine(r.id, { enabled: !r.enabled })),
                    },
                    {
                      label: 'Delete',
                      danger: true,
                      run: () => {
                        if (window.confirm(`Delete the routine "${r.name}"?`)) void act(() => api.deleteRoutine(r.id))
                      },
                    },
                  ]}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="sectionNote">Routines run while will-bot is open.</p>
    </section>
  )
}
