'use client'

import type { Capabilities } from '@/lib/types'
import { Icon } from './icons'

const STATUS_TEXT: Record<string, string> = { connected: 'Connected', pending: 'Connecting', failed: 'Failed', 'needs-auth': 'Needs sign-in', disabled: 'Off' }

export function Plugins({ caps, onBack }: { caps: Capabilities | null; onBack: () => void }) {
  return (
    <main className="chat pluginsView" aria-labelledby="plugins-title">
      <header className="paneHead">
        <button className="iconButton" aria-label="Back to chat" data-tip="Back" onClick={onBack}>
          <Icon name="chevronLeft" />
        </button>
        <h2 className="chatName" id="plugins-title">
          Plugins
        </h2>
      </header>
      <div className="pluginsScroll">
        <div className="pluginsInner">
          <p className="pluginsNote">Add or remove plugins in Claude Code; will-bot picks them up automatically.</p>
          {caps === null && (
            <p className="mutedText" aria-live="polite">
              Checking your Claude setup…
            </p>
          )}
          {caps && 'error' in caps && <p className="formError">Could not load your Claude setup: {caps.error}</p>}
          {caps && !('error' in caps) && (
            <>
              <section className="pluginGroup" aria-labelledby="plugins-list">
                <h3 className="sectionLabel" id="plugins-list">
                  Plugins <span className="groupCount">{caps.plugins.length}</span>
                </h3>
                {caps.plugins.length === 0 ? (
                  <p className="mutedText">No plugins installed.</p>
                ) : (
                  <ul className="pluginList">
                    {caps.plugins.map((p) => (
                      <li key={p} className="pluginRow">
                        <span className="pluginIcon">
                          <Icon name="plug" size={16} />
                        </span>
                        <span className="pluginName">{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="pluginGroup" aria-labelledby="connectors-list">
                <h3 className="sectionLabel" id="connectors-list">
                  Connectors <span className="groupCount">{caps.connectors.length}</span>
                </h3>
                {caps.connectors.length === 0 ? (
                  <p className="mutedText">No connectors set up.</p>
                ) : (
                  <ul className="pluginList">
                    {caps.connectors.map((c) => (
                      <li key={c.name} className="pluginRow">
                        <span className="pluginIcon">
                          <Icon name="spark" size={16} />
                        </span>
                        <span className="pluginName">{c.name}</span>
                        <span className={`statusPill ${c.status === 'connected' ? 'ok' : c.status === 'failed' ? 'bad' : ''}`}>
                          {STATUS_TEXT[c.status] ?? c.status}
                        </span>
                        <span className="pluginMeta">{c.tools === 1 ? '1 tool' : `${c.tools} tools`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="pluginGroup" aria-labelledby="skills-list">
                <h3 className="sectionLabel" id="skills-list">
                  Skills <span className="groupCount">{caps.skills.length}</span>
                </h3>
                {caps.skills.length === 0 ? (
                  <p className="mutedText">No skills installed.</p>
                ) : (
                  <details className="skillsDetails">
                    <summary>
                      <Icon name="chevronRight" size={14} />
                      Show {caps.skills.length} skill names
                    </summary>
                    <ul className="skillNames">
                      {caps.skills.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
