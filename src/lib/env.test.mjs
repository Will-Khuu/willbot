import assert from 'node:assert/strict'
import { test } from 'node:test'
import { billingIn } from './env.ts'

test('billing variables in a settings env are found', () => {
  assert.equal(billingIn({ env: { ANTHROPIC_API_KEY: 'sk-test' } }), 'ANTHROPIC_API_KEY')
  assert.equal(billingIn({ env: { FOO: '1', CLAUDE_CODE_USE_BEDROCK: '1' } }), 'CLAUDE_CODE_USE_BEDROCK')
  assert.equal(billingIn({ env: { ANTHROPIC_BASE_URL: 'https://proxy.test' } }), 'ANTHROPIC_BASE_URL')
})

test('an apiKeyHelper bills the API too', () => {
  assert.equal(billingIn({ apiKeyHelper: '~/bin/key.sh' }), 'apiKeyHelper')
  assert.equal(billingIn({ env: { ANTHROPIC_AUTH_TOKEN: 't' }, apiKeyHelper: 'x' }), 'ANTHROPIC_AUTH_TOKEN')
})

test('plan-only settings pass', () => {
  assert.equal(billingIn({}), null)
  assert.equal(billingIn({ env: { FOO: '1', ANTHROPIC_API_KEY: '' } }), null)
})
