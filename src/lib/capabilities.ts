import os from 'node:os'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { sdkEnv } from './env'
import { cachedCapabilities } from './runtime'
import type { Capabilities, ModelOption } from './types'

const CONNECT_WAIT_MS = 12_000

// Starts a session that never receives a prompt, so no model call is made.
async function probe(): Promise<Capabilities> {
  const abort = new AbortController()
  async function* idle(): AsyncGenerator<SDKUserMessage> {
    await new Promise((resolve) => abort.signal.addEventListener('abort', resolve, { once: true }))
  }
  const session = query({
    prompt: idle(),
    options: {
      cwd: os.tmpdir(),
      settingSources: ['user', 'project', 'local'],
      env: sdkEnv(),
      abortController: abort,
      canUseTool: async () => ({ behavior: 'deny', message: 'Capabilities probe.' }),
    },
  })
  const drained = (async () => {
    try {
      for await (const _ of session) {
      }
    } catch {}
  })()
  try {
    const init = await session.initializationResult()
    // claude.ai connectors are listed only seconds after start, and then
    // connect. With none set up, this waits out the deadline once per cache.
    const deadline = Date.now() + CONNECT_WAIT_MS
    let servers = await session.mcpServerStatus()
    const settled = () => servers.some((s) => s.scope === 'claudeai') && !servers.some((s) => s.status === 'pending')
    while (!settled() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      servers = await session.mcpServerStatus()
    }
    const { plugins } = await session.reloadPlugins()
    const option = (pick: (m: (typeof init.models)[number]) => boolean): ModelOption | undefined => {
      const m = init.models.find(pick)
      return m && { name: m.displayName, efforts: m.supportedEffortLevels ?? [] }
    }
    const defaultId = init.models.find((m) => m.value === 'default')?.resolvedModel
    return {
      models: {
        opus: option((m) => m.value === 'opus'),
        sonnet: option((m) => m.value === 'sonnet'),
        fable: option((m) => m.value === 'fable'),
        haiku: option((m) => m.value === 'haiku'),
        default: defaultId ? option((m) => m.value !== 'default' && m.resolvedModel === defaultId) : undefined,
      },
      plugins: plugins.filter((p) => !p.source?.endsWith('@builtin')).map((p) => p.name),
      skills: init.commands.filter((c) => !c.builtin).map((c) => c.name).toSorted(),
      connectors: servers.map((s) => ({
        name: s.name.replace(/^claude\.ai /, ''),
        status: s.status,
        tools: s.tools?.length ?? 0,
      })),
    }
  } finally {
    abort.abort()
    await drained
  }
}

export function getCapabilities(): Promise<Capabilities> {
  return cachedCapabilities(probe)
}
