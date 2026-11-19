'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MODEL_LABELS } from '@/lib/router'
import type { Effort, Model, ModelCatalog } from '@/lib/types'
import { Icon } from './icons'

type Pick = NonNullable<Model>

// Fable runs only with usage credits, which this account does not have, so it
// is listed for reference and cannot be picked.
const ROWS: { key: Pick | 'fable'; label: string; locked?: string }[] = [
  { key: 'opus', label: 'Opus' },
  { key: 'sonnet', label: 'Sonnet' },
  { key: 'fable', label: 'Fable', locked: 'Requires usage credits' },
  { key: 'haiku', label: 'Haiku' },
]

const EFFORT_LABELS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

type Props = {
  catalog: ModelCatalog
  pick: Pick | null
  effort: Effort | null
  disabled: boolean
  onPick: (model: Pick | null) => void
  onEffort: (effort: Effort | null) => void
}

export function ModelMenu({ catalog, pick, effort, disabled, onPick, onEffort }: Props) {
  const [open, setOpen] = useState<null | 'models' | 'effort'>(null)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', away)
    root.current?.querySelector<HTMLElement>('[role=menuitemradio]:not([aria-disabled=true])')?.focus()
    return () => document.removeEventListener('mousedown', away)
  }, [open === null])

  const close = () => {
    setOpen(null)
    button.current?.focus()
  }
  const nameOf = (key: Pick | 'fable') => catalog[key]?.name ?? MODEL_LABELS[key as Pick] ?? 'Fable'
  const efforts = (pick ? catalog[pick] : catalog.default)?.efforts ?? []

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      return open === 'effort' ? setOpen('models') : close()
    }
    const row = ROWS[Number(e.key) - 1]
    if (open === 'models' && row && !row.locked) {
      e.preventDefault()
      onPick(row.key as Pick)
      return close()
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const menu = (e.target as HTMLElement).closest('[role=menu]')
    const items = [...(menu?.querySelectorAll<HTMLElement>(':scope > [role^=menuitem]:not([aria-disabled=true])') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return (
    <div className="modelMenu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="modelButton"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={`Model: ${pick ? nameOf(pick) : 'Auto'}${effort ? `, ${EFFORT_LABELS[effort]} effort` : ''}`}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen('models'))}
      >
        <span>{pick ? nameOf(pick) : 'Auto'}</span>
        {effort && <span className="modelButtonEffort">{EFFORT_LABELS[effort]}</span>}
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="menuPanel" role="menu" aria-label="Model">
          <MenuRadio checked={pick === null} onSelect={() => (onPick(null), close())}>
            <span>Auto</span>
          </MenuRadio>
          {ROWS.map((row, i) => (
            <MenuRadio
              key={row.key}
              checked={pick === row.key}
              locked={row.locked !== undefined}
              hint={String(i + 1)}
              onSelect={() => (onPick(row.key as Pick), close())}
            >
              <span>{nameOf(row.key)}</span>
              {row.locked && (
                <span className="menuBadge">
                  <Icon name="info" size={13} />
                  {row.locked}
                </span>
              )}
            </MenuRadio>
          ))}
          <div className="menuDivider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menuItem"
            aria-haspopup="menu"
            aria-expanded={open === 'effort'}
            aria-disabled={efforts.length === 0}
            onClick={() => efforts.length > 0 && setOpen(open === 'effort' ? 'models' : 'effort')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' && efforts.length > 0) {
                e.preventDefault()
                setOpen('effort')
              }
            }}
          >
            <span>Effort</span>
            <span className="menuHint">{efforts.length === 0 ? 'Not supported' : effort ? EFFORT_LABELS[effort] : 'Default'}</span>
            <Icon name="chevronRight" size={14} />
          </button>
          {open === 'effort' && (
            <EffortMenu
              levels={efforts}
              effort={effort}
              onSelect={(level) => {
                onEffort(level)
                close()
              }}
              onBack={() => {
                setOpen('models')
                requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-haspopup=menu].menuItem')?.focus())
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function EffortMenu(props: { levels: Effort[]; effort: Effort | null; onSelect: (e: Effort | null) => void; onBack: () => void }) {
  const self = useRef<HTMLDivElement>(null)
  useEffect(() => self.current?.querySelector<HTMLElement>('[aria-checked=true]')?.focus(), [])
  return (
    <div
      ref={self}
      className="menuPanel subMenu"
      role="menu"
      aria-label="Effort"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          props.onBack()
        }
      }}
    >
      <MenuRadio checked={props.effort === null} onSelect={() => props.onSelect(null)}>
        <span>Default</span>
      </MenuRadio>
      {props.levels.map((level) => (
        <MenuRadio key={level} checked={props.effort === level} onSelect={() => props.onSelect(level)}>
          <span>{EFFORT_LABELS[level]}</span>
        </MenuRadio>
      ))}
    </div>
  )
}

function MenuRadio(props: { checked: boolean; locked?: boolean; hint?: string; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      className="menuItem"
      aria-checked={props.checked}
      aria-disabled={props.locked || undefined}
      tabIndex={-1}
      onClick={() => !props.locked && props.onSelect()}
    >
      <span className="menuLabel">{props.children}</span>
      {props.checked ? <Icon name="check" size={16} strokeWidth={2.25} /> : props.hint && <span className="menuHint">{props.hint}</span>}
    </button>
  )
}
