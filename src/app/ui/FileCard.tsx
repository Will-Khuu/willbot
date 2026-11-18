import { isImageMime } from '@/lib/context'
import { Icon } from './icons'
import { sizeOf } from './look'

type Props = {
  name: string
  mime: string
  size?: number
  thumb?: string
  href?: string
  // Replaces the size line: "Uploading…" or an upload error.
  note?: { text: string; error?: boolean }
  onRemove?: () => void
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : ''
}

export function FileCard({ name, mime, size, thumb, href, note, onRemove }: Props) {
  const ext = extOf(name)
  const pdf = mime === 'application/pdf' || ext === 'PDF'
  const kind = pdf ? 'PDF' : isImageMime(mime) ? 'Image' : ext || 'File'
  const meta = note?.text ?? [kind, size === undefined ? null : sizeOf(size)].filter(Boolean).join(' · ')
  const icon = thumb ? (
    <img className="fileThumb" src={thumb} alt="" loading="lazy" />
  ) : (
    <span className={`fileIcon${pdf ? ' pdf' : ''}`} aria-hidden="true">
      <Icon name="file" size={18} />
      {ext && <span className="fileExt">{ext}</span>}
    </span>
  )
  const body = (
    <>
      {icon}
      <span className="fileText">
        <span className="fileName">{name}</span>
        <span className={`fileMeta${note?.error ? ' error' : ''}`}>{meta}</span>
      </span>
    </>
  )
  return (
    <span className={`fileCard${note?.error ? ' failed' : ''}`} title={name}>
      {href ? (
        <a className="fileLink" href={href} target="_blank" rel="noreferrer">
          {body}
        </a>
      ) : (
        body
      )}
      {onRemove && (
        <button type="button" className="fileRemove" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  )
}
