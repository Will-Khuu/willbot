import { query } from '@anthropic-ai/claude-agent-sdk'
import { sdkEnv } from './env'
import { noteRateLimit } from './runtime'
import { CLASSIFICATION_SCHEMA, classifierPrompt, parseClassification, type Classification } from './router'

const CLASSIFY_TIMEOUT_MS = 8_000

// One small Haiku call with no tools, settings or saved session. Resolves null
// on any failure, timeout or abort.
export async function classify(context: string, message: string, signal: AbortSignal): Promise<Classification | null> {
  const abortController = new AbortController()
  const stop = AbortSignal.any([signal, AbortSignal.timeout(CLASSIFY_TIMEOUT_MS)])
  if (stop.aborted) return null
  stop.addEventListener('abort', () => abortController.abort(), { once: true })
  const q = query({
    prompt: classifierPrompt(context, message),
    options: {
      model: 'haiku',
      maxTurns: 1,
      settingSources: [],
      tools: [],
      strictMcpConfig: true,
      persistSession: false,
      outputFormat: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA },
      // StructuredOutput is how the answer comes back, so it is the one tool allowed.
      canUseTool: async (toolName, input) =>
        toolName === 'StructuredOutput'
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'No tools.' },
      abortController,
      env: sdkEnv(),
    },
  })
  try {
    for await (const msg of q) {
      if (msg.type === 'rate_limit_event') noteRateLimit(msg.rate_limit_info)
      if (msg.type === 'result') return msg.subtype === 'success' ? parseClassification(msg.structured_output) : null
    }
    return null
  } catch {
    return null
  } finally {
    q.close()
  }
}
