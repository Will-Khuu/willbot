'use client'

import { useEffect, useState } from 'react'
import type { RecentFile } from '@/lib/workspace'
import type { BotView } from '@/lib/types'
import { api } from './api'
import { Icon } from './icons'
import { agoOf } from './look'

type Workspace = { name: string; folder: string; files: RecentFile[] }

// The employee's latest browser screenshot, else its working folder's recent files.
// `activity` changes whenever the chat does, which refetches both.
export function Screen({ bot, activity, now }: { bot: BotView; activity: string; now: number }) {
  const [shotFailed, setShotFailed] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const showShot = bot.browser && !shotFailed

  useEffect(() => setShotFailed(false), [bot.id, bot.browser, activity])

  useEffect(() => {
    if (showShot) return
    let live = true
    api.workspace(bot.id).then(
      (w) => live && setWorkspace(w),
      () => live && setWorkspace(null),
    )
    return () => {
      live = false
    }
  }, [bot.id, bot.folder, activity, showShot])

  return (
    <figure className="screen">
      {showShot ? (
        <img
          className="screenShot"
          src={`/api/screen?botId=${encodeURIComponent(bot.id)}&v=${encodeURIComponent(activity)}`}
          alt={`${bot.name}'s latest browser screenshot`}
          onError={() => setShotFailed(true)}
        />
      ) : (
        <div className="workspaceCard">
          <div className="workspaceHead" title={workspace?.folder ?? bot.folder}>
            <Icon name="folder" size={18} />
            <span className="workspaceName">{workspace?.name ?? bot.folder.slice(bot.folder.lastIndexOf('/') + 1)}</span>
          </div>
          {workspace && workspace.files.length === 0 && <p className="mutedText">No files here yet.</p>}
          {workspace && workspace.files.length > 0 && (
            <ul className="workspaceFiles" aria-label="Recently changed files">
              {workspace.files.map((f) => (
                <li key={f.rel} className="workspaceFile">
                  <span className="workspaceFileName" title={f.rel}>
                    {f.rel}
                  </span>
                  <time className="workspaceFileTime" dateTime={f.modifiedAt}>
                    {agoOf(f.modifiedAt, now)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <figcaption className="screenCaption">{bot.name}&rsquo;s screen</figcaption>
    </figure>
  )
}
