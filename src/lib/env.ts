const BILLING_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const

// Set by Next and npm for this server process, not by the user's shell. A
// `next start` NODE_ENV=production would, for one, make an employee's
// `npm install` skip devDependencies.
const SERVER_VARS = /^(NODE_ENV|NODE_OPTIONS|PORT|NEXT_.*|__NEXT_.*|TURBOPACK.*|npm_.*|INIT_CWD)$/

export function billingOverride(): string | null {
  return BILLING_VARS.find((name) => process.env[name]) ?? null
}

// The SDK replaces the CLI's environment with this, so it is the user's
// environment as their own terminal session would see it.
export function sdkEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || SERVER_VARS.test(name) || (BILLING_VARS as readonly string[]).includes(name)) continue
    env[name] = value
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'will-bot/0.1.0'
  // Session idle/running events; they change what is reported, not how the session behaves.
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1'
  // Interactive Claude Code has its task list tools; a headless session needs this to get them.
  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = '1'
  return env
}
