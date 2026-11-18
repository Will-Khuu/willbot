import type { NextConfig } from 'next'

const config: NextConfig = {
  // The SDK spawns a bundled native binary resolved relative to its own files.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
}

export default config
