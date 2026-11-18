import type { NextConfig } from 'next'

const config: NextConfig = {
  // The SDK spawns a bundled native binary resolved relative to its own files.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
  experimental: {
    // With a proxy, Next cuts request bodies at 10 MB. A 20 MB attachment is
    // about 27 MB once base64-encoded in its JSON upload.
    proxyClientMaxBodySize: '28mb',
  },
}

export default config
