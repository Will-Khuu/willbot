import type { CSSProperties } from 'react'
import type { BotStatus } from '@/lib/types'
import { Icon, type IconName } from './icons'
import { hueOf, initialsOf } from './look'

const BADGES: Partial<Record<BotStatus, IconName>> = { working: 'more', needs_approval: 'alert', paused: 'pause' }

type Props = { id: string; name: string; size?: number; status?: BotStatus }

// Decorative: callers always name the employee and its status in text.
export function Avatar({ id, name, size = 40, status }: Props) {
  const badge = status && BADGES[status]
  return (
    <span className="avatar" style={{ '--hue': hueOf(id), '--size': `${size}px` } as CSSProperties} aria-hidden="true">
      <span className="avatarFace">{initialsOf(name)}</span>
      {badge && (
        <span className={`avatarBadge ${status}`}>
          <Icon name={badge} size={10} strokeWidth={badge === 'more' ? 4 : 3} />
        </span>
      )}
    </span>
  )
}
